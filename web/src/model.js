// The document: objects on the plate, their geometry, history, and every
// editing operation. Rendering lives in viewport.js; this file has no DOM.
//
// Geometry pipeline per object:
//   recipe (Solemn part.build) -> manifold (kernel) -> normalized base
//   (centered in X/Y, resting on z = 0) -> world = T(pos) R(rot) S(scale)
// The printable result is   union(solids) − union(holes):  every "hole"
// object carves whatever solid it overlaps, so beginners never need booleans.
import * as THREE from 'three';
import * as K from './kernel.js';
import { call } from './bridge.js';

export const PALETTE = ['#3b82f6', '#f97316', '#10b981', '#e11d48', '#8b5cf6', '#eab308', '#14b8a6', '#64748b', '#ec4899', '#84cc16'];

const DEG = Math.PI / 180;
let idCounter = 1;
export function newId(prefix = 'o') {
  return prefix + Date.now().toString(36) + (idCounter++).toString(36);
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

export function matrixOf(obj) {
  const e = new THREE.Euler(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG, 'ZYX');
  const q = new THREE.Quaternion().setFromEuler(e);
  return new THREE.Matrix4().compose(new THREE.Vector3(...obj.pos), q, new THREE.Vector3(...obj.scale));
}

// Decompose a matrix into pos / rot (degrees, ZYX = X then Y then Z) /
// scale. Returns null if the matrix has shear (can't be expressed).
export function decompose(m) {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const back = new THREE.Matrix4().compose(p, q, s);
  for (let i = 0; i < 16; i++) if (Math.abs(back.elements[i] - m.elements[i]) > 1e-6 * Math.max(1, Math.abs(m.elements[i]))) return null;
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
  const r = (v) => {
    let d = v / DEG;
    d = Math.round(d * 1e6) / 1e6;
    if (Math.abs(d) < 1e-9) d = 0;
    return d;
  };
  const sc = (v) => Math.round(v * 1e9) / 1e9;
  return { pos: [p.x, p.y, p.z], rot: [r(e.x), r(e.y), r(e.z)], scale: [sc(s.x), sc(s.y), sc(s.z)] };
}

function matKey(m) {
  return m.elements.map((v) => Math.round(v * 1e6)).join(',');
}

// base64 <-> Float32Array (project files store imported meshes compactly)
export function f32ToB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF32(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class Model extends EventTarget {
  constructor() {
    super();
    this.objects = [];
    this.meshes = {}; // meshId -> { data: Float32Array soup, name }
    this.catalog = { parts: [], printers: [], materials: [] };
    this.settings = { units: 'mm', printer: 'bambu_a1', material: 'pla', infill: 15, layer: 0.2, walls: 2, grid: 1 };
    this.name = 'Untitled';
    this.path = '';
    this.dirty = false;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.bases = new Map(); // key -> Promise<base>
    this.display = new Map(); // obj.id -> { geometry, matrix, key, man, ghost, box }
    this.worldCache = new Map(); // key -> manifold (per refresh)
    this.version = 0;
    this.updating = null;
    this.again = false;
    this.lastUpdateMs = 0;
    this.watertight = true;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  part(kind) {
    return this.catalog.parts.find((p) => p.id === kind);
  }

  nozzle() {
    const p = this.catalog.printers.find((x) => x.id === this.settings.printer);
    return p ? p.nozzle : 0.4;
  }

  printer() {
    return this.catalog.printers.find((x) => x.id === this.settings.printer) || { id: 'generic_medium', name: 'Printer', brand: '', bx: 220, by: 220, bz: 250, nozzle: 0.4 };
  }

  // ---- lookup ---------------------------------------------------------------
  byId(id) {
    return this.objects.find((o) => o.id === id);
  }

  selected() {
    return this.selection.map((id) => this.byId(id)).filter(Boolean);
  }

  select(ids, additive = false) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (additive) {
      const s = new Set(this.selection);
      for (const id of list) s.has(id) ? s.delete(id) : s.add(id);
      this.selection = [...s];
    } else this.selection = list.filter(Boolean);
    this.emit('selection');
  }

  // ---- history ------------------------------------------------------------------
  snapshot() {
    return JSON.stringify({ objects: this.objects.map(stripTransient), name: this.name });
  }

  begin() {
    // call BEFORE a change; records the state to return to
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  }

  commit() {
    this.dirty = true;
    this.version++;
    this.emit('change');
    this.update();
  }

  restore(snap) {
    const s = JSON.parse(snap);
    this.objects = s.objects;
    this.name = s.name || this.name;
    this.selection = this.selection.filter((id) => this.byId(id));
    this.dirty = true;
    this.version++;
    this.emit('change');
    this.emit('selection');
    this.update();
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  // ---- geometry -------------------------------------------------------------------
  baseKey(obj) {
    if (obj.kind === 'mesh') return 'mesh:' + obj.mesh;
    if (obj.kind === 'group') return 'group:' + JSON.stringify(obj.children.map(structKey));
    return obj.kind + ':' + JSON.stringify(sortKeys(obj.params)) + ':' + this.nozzle();
  }

  // Build (or reuse) the normalized base geometry of an object.
  base(obj) {
    const key = this.baseKey(obj);
    let p = this.bases.get(key);
    if (!p) {
      p = this.buildBase(obj).catch((e) => {
        console.error('geometry failed', obj.kind, e);
        return { man: K.wasm().Manifold.cube([1, 1, 1], true), offset: [0, 0, 0], warnings: ['Could not build this shape: ' + e.message], info: [], ok: true };
      });
      this.bases.set(key, p);
    }
    return p;
  }

  async buildBase(obj) {
    if (obj.kind === 'mesh') {
      const m = this.meshes[obj.mesh];
      if (!m) throw new Error('missing mesh data');
      const r = K.fromSoup(m.data);
      if (r.ok) {
        const n = K.normalize(r.man);
        r.man.delete();
        return { man: n.man, offset: n.offset, warnings: [], info: [], ok: true };
      }
      // Not a closed solid: keep the raw triangles for display/export.
      const d = m.data;
      let mn = [Infinity, Infinity, Infinity];
      let mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.length; i += 3) for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], d[i + k]);
        mx[k] = Math.max(mx[k], d[i + k]);
      }
      const off = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]];
      const raw = new Float32Array(d.length);
      for (let i = 0; i < d.length; i += 3) for (let k = 0; k < 3; k++) raw[i + k] = d[i + k] + off[k];
      return { man: null, raw, offset: off, warnings: ['This mesh has holes or broken surfaces. It can be exported, but holes and groups will not cut it.'], info: [], ok: false };
    }
    if (obj.kind === 'group') {
      const solids = [];
      const holes = [];
      let ok = true;
      for (const c of obj.children) {
        const b = await this.base(c);
        if (!b.man) {
          ok = false;
          continue;
        }
        const w = K.transform(b.man, matrixOf(c).elements);
        (c.hole ? holes : solids).push(w);
      }
      let m;
      if (solids.length) {
        const u = K.unionAll(solids);
        if (holes.length) {
          const h = K.unionAll(holes);
          m = u.subtract(h);
          u.delete();
          h.delete();
        } else m = u;
      } else m = K.unionAll(holes) || K.wasm().Manifold.cube([1, 1, 1], true);
      solids.concat(holes).forEach((x) => x.delete());
      const n = K.normalize(m);
      m.delete();
      return { man: n.man, offset: n.offset, warnings: ok ? [] : ['Some broken meshes inside this group were left out.'], info: [], ok: true };
    }
    const res = await call('part.build', { id: obj.kind, values: { ...obj.params, _nozzle: this.nozzle() } });
    if (!res.ok) throw new Error(res.error);
    const raw = K.buildRecipe(res.tree);
    const n = K.normalize(raw);
    raw.delete();
    const values = { ...res.values };
    delete values._nozzle;
    return { man: n.man, offset: n.offset, warnings: res.warnings || [], info: res.info || [], ok: true, values };
  }

  // World-space manifold for an object, cached per refresh. ONLY used inside
  // refresh() (which never runs concurrently with itself).
  async world(obj) {
    const b = await this.base(obj);
    if (!b.man) return null;
    const m = matrixOf(obj);
    const key = this.baseKey(obj) + '|' + matKey(m);
    let w = this.worldCache.get(key);
    if (!w) {
      w = K.transform(b.man, m.elements);
      this.worldCache.set(key, w);
    }
    return { man: w, key, matrix: m };
  }

  // A NEW world-space manifold the caller must delete (null for broken
  // meshes). Synchronous once the base is resolved, so no concurrent refresh
  // can free anything it uses.
  async ownedWorld(obj) {
    const b = await this.base(obj);
    if (!b.man) return null;
    return K.transform(b.man, matrixOf(obj).elements);
  }

  async worldBox(obj) {
    const b = await this.base(obj);
    if (b.man) {
      const w = K.transform(b.man, matrixOf(obj).elements);
      const bb = K.bbox(w);
      w.delete();
      return bb;
    }
    return rawBox(b.raw, matrixOf(obj));
  }

  async worldDims(obj) {
    const bb = await this.worldBox(obj);
    return [0, 1, 2].map((i) => bb.max[i] - bb.min[i]);
  }

  // Recompute display geometry for every object (coalesced: concurrent calls
  // collapse into one follow-up run).
  update() {
    if (this.updating) {
      this.again = true;
      return this.updating;
    }
    this.updating = (async () => {
      do {
        this.again = false;
        const t0 = performance.now();
        try {
          await this.refresh();
        } catch (e) {
          console.error(e);
        }
        this.lastUpdateMs = performance.now() - t0;
      } while (this.again);
      this.updating = null;
      this.emit('geometry');
    })();
    return this.updating;
  }

  async refresh() {
    const oldWorld = this.worldCache;
    this.worldCache = new Map();
    // apply Solemn-resolved values (clamped/defaulted) back to params
    for (const o of this.objects) {
      const b = await this.base(o);
      if (b.values && JSON.stringify(sortKeys(b.values)) !== JSON.stringify(sortKeys(o.params))) {
        o.params = b.values;
        this.bases.set(this.baseKey(o), Promise.resolve(b));
      }
    }
    for (const o of this.objects) {
      const k = this.baseKey(o) + '|' + matKey(matrixOf(o));
      if (oldWorld.has(k)) {
        this.worldCache.set(k, oldWorld.get(k));
        oldWorld.delete(k);
      }
    }
    const holes = [];
    for (const o of this.objects) if (o.hole) {
      const w = await this.world(o);
      if (w) holes.push({ o, w });
    }
    let holeUnion = null;
    let holeKey = '';
    let holeBox = null;
    if (holes.length) {
      holeKey = holes.map((h) => h.w.key).join('&');
      const prev = this.holeUnion && this.holeUnion.key === holeKey ? this.holeUnion : null;
      if (prev) holeUnion = prev.man;
      else {
        holeUnion = K.unionAll(holes.map((h) => h.w.man));
        if (this.holeUnion) this.holeUnion.man.delete();
        this.holeUnion = { key: holeKey, man: holeUnion };
      }
      holeBox = K.bbox(holeUnion);
    } else if (this.holeUnion) {
      this.holeUnion.man.delete();
      this.holeUnion = null;
    }
    const seen = new Set();
    let watertight = true;
    for (const o of this.objects) {
      seen.add(o.id);
      const b = await this.base(o);
      const m = matrixOf(o);
      let key;
      let man = null;
      let raw = null;
      let box;
      if (!b.man) {
        watertight = false;
        key = 'raw|' + this.baseKey(o) + '|' + matKey(m);
        raw = b.raw;
        box = rawBox(raw, m);
      } else {
        const w = await this.world(o);
        box = K.bbox(w.man);
        const cut = !o.hole && holeUnion && overlaps(box, holeBox);
        key = w.key + (cut ? '#' + holeKey : '');
        const cur = this.display.get(o.id);
        if (cur && cur.key === key) {
          cur.ghost = o.hole;
          cur.box = box;
          cur.color = o.color;
          continue;
        }
        man = cut ? w.man.subtract(holeUnion) : null;
        if (man) box = man.isEmpty() ? box : K.bbox(man);
      }
      const cur = this.display.get(o.id);
      if (cur && cur.key === key) continue;
      let geometry;
      if (raw) {
        geometry = new THREE.BufferGeometry();
        const pos = new Float32Array(raw.length);
        const v = new THREE.Vector3();
        for (let i = 0; i < raw.length; i += 3) {
          v.set(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(m);
          pos[i] = v.x;
          pos[i + 1] = v.y;
          pos[i + 2] = v.z;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      } else {
        const src = man || (await this.world(o)).man;
        const a = K.meshArrays(src);
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
        geometry.setIndex(new THREE.BufferAttribute(a.index, 1));
        geometry = geometry.toNonIndexed();
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      if (cur) {
        cur.geometry.dispose();
        if (cur.man) cur.man.delete();
      }
      this.display.set(o.id, { key, geometry, matrix: m, man, ghost: o.hole, box, color: o.color, ok: b.ok });
    }
    for (const [id, d] of this.display) if (!seen.has(id)) {
      d.geometry.dispose();
      if (d.man) d.man.delete();
      this.display.delete(id);
    }
    for (const w of oldWorld.values()) w.delete();
    this.watertight = watertight;
    this.pruneBases();
  }

  pruneBases() {
    if (this.bases.size < 400) return;
    const live = new Set();
    const walk = (o) => {
      live.add(this.baseKey(o));
      if (o.children) o.children.forEach(walk);
    };
    this.objects.forEach(walk);
    for (const [k, p] of this.bases) if (!live.has(k)) {
      p.then((b) => b.man && b.man.delete());
      this.bases.delete(k);
    }
  }

  // The printable model in bed coordinates: { soup, pieces, watertight }.
  // Built from scratch with owned temporaries (safe against concurrent edits).
  async printable(onlyIds = null) {
    const objs = this.objects.slice();
    const bases = await Promise.all(objs.map((o) => this.base(o)));
    const solids = [];
    const holes = [];
    const raws = [];
    objs.forEach((o, i) => {
      const b = bases[i];
      if (!b.man) {
        if (!o.hole && (!onlyIds || onlyIds.includes(o.id))) raws.push(transformRaw(b.raw, matrixOf(o)));
        return;
      }
      if (o.hole) holes.push(K.transform(b.man, matrixOf(o).elements));
      else if (!onlyIds || onlyIds.includes(o.id)) solids.push(K.transform(b.man, matrixOf(o).elements));
    });
    let soup = new Float32Array(0);
    let pieces = 0;
    if (solids.length) {
      let u = K.unionAll(solids);
      if (holes.length) {
        const h = K.unionAll(holes);
        const cut = u.subtract(h);
        u.delete();
        h.delete();
        u = cut;
      }
      soup = K.soup(u);
      const dec = u.decompose();
      pieces = dec.length;
      dec.forEach((x) => x.delete());
      u.delete();
    }
    solids.concat(holes).forEach((x) => x.delete());
    if (raws.length) {
      const total = soup.length + raws.reduce((a, r) => a + r.length, 0);
      const all = new Float32Array(total);
      all.set(soup, 0);
      let at = soup.length;
      for (const r of raws) {
        all.set(r, at);
        at += r.length;
      }
      soup = all;
      pieces += raws.length;
    }
    return { soup, pieces, watertight: raws.length === 0 };
  }

  // ---- editing operations -------------------------------------------------------
  nextName(base) {
    let n = 1;
    const names = new Set(this.objects.map((o) => o.name));
    while (names.has(base + ' ' + n)) n++;
    return base + ' ' + n;
  }

  async add(kind, opts = {}) {
    const p = this.part(kind);
    const color = PALETTE[this.objects.filter((o) => !o.hole).length % PALETTE.length];
    const obj = {
      id: newId(),
      name: this.nextName(p ? p.name : kind),
      kind,
      params: opts.params || {},
      pos: [opts.x || 0, opts.y || 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      hole: !!opts.hole,
      color: opts.color || color,
    };
    if (opts.mesh) obj.mesh = opts.mesh;
    this.begin();
    this.objects.push(obj);
    await this.base(obj);
    if (opts.x === undefined && opts.y === undefined) await this.placeFree(obj);
    this.select(obj.id);
    this.commit();
    await this.update();
    return obj;
  }

  // Put a new object next to the others instead of on top of them.
  async placeFree(obj) {
    const others = this.objects.filter((o) => o !== obj);
    if (!others.length) return;
    const boxes = await Promise.all(others.map((o) => this.worldBox(o)));
    const mine = await this.worldBox(obj);
    const w = mine.max[0] - mine.min[0];
    const d = mine.max[1] - mine.min[1];
    const pr = this.printer();
    const candidates = [];
    for (let r = 0; r <= 12; r++) for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      candidates.push([Math.round(Math.cos(ang) * r * 12), Math.round(Math.sin(ang) * r * 12)]);
    }
    for (const [cx, cy] of candidates) {
      const box = { min: [cx - w / 2 - 3, cy - d / 2 - 3], max: [cx + w / 2 + 3, cy + d / 2 + 3] };
      if (Math.abs(cx) + w / 2 > pr.bx / 2 || Math.abs(cy) + d / 2 > pr.by / 2) continue;
      if (!boxes.some((b) => box.min[0] < b.max[0] && box.max[0] > b.min[0] && box.min[1] < b.max[1] && box.max[1] > b.min[1])) {
        obj.pos[0] += cx - (mine.min[0] + mine.max[0]) / 2;
        obj.pos[1] += cy - (mine.min[1] + mine.max[1]) / 2;
        return;
      }
    }
  }

  async setParams(obj, changes, record = true) {
    if (record) this.begin();
    const before = await this.worldBox(obj);
    obj.params = { ...obj.params, ...changes };
    await this.keepAnchor(obj, before);
    this.commit();
  }

  // After a geometry change keep the object's bottom-center where it was.
  async keepAnchor(obj, before) {
    const after = await this.worldBox(obj);
    obj.pos[0] += (before.min[0] + before.max[0]) / 2 - (after.min[0] + after.max[0]) / 2;
    obj.pos[1] += (before.min[1] + before.max[1]) / 2 - (after.min[1] + after.max[1]) / 2;
    obj.pos[2] += before.min[2] - after.min[2];
  }

  dominantLocalAxis(obj, worldAxis) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG, 'ZYX'));
    const e = m.elements; // column-major: element(row r, col c) = e[c*4+r]
    let best = 0;
    let bv = -1;
    for (let l = 0; l < 3; l++) {
      const v = Math.abs(e[l * 4 + worldAxis]);
      if (v > bv + 1e-9) {
        bv = v;
        best = l;
      }
    }
    return best;
  }

  // Make the printed size along a world axis exactly `target` mm. Bound
  // parameters (box width, gear module, wall-preserving sizes) are changed
  // when possible, otherwise the object is scaled. Iterates to exactness.
  async setWorldSize(obj, axis, target, lock) {
    if (!(target > 0)) return false;
    const before = await this.worldBox(obj);
    const cur = before.max[axis] - before.min[axis];
    if (cur <= 1e-9) return false;
    this.begin();
    const p = this.part(obj.kind);
    const bind = p ? p.bind : ['', '', ''];
    const saved = clone({ params: obj.params, scale: obj.scale, pos: obj.pos });
    const knobs = []; // {type:'param'|'scale', key|axis}
    if (lock) {
      const keys = new Set();
      for (let l = 0; l < 3; l++) {
        if (bind[l]) keys.add(bind[l]);
        else knobs.push({ type: 'scale', axis: l });
      }
      for (const k of keys) knobs.push({ type: 'param', key: k });
    } else {
      const l = this.dominantLocalAxis(obj, axis);
      if (bind[l]) knobs.push({ type: 'param', key: bind[l] });
      else knobs.push({ type: 'scale', axis: l });
    }
    const apply = (ratio) => {
      for (const k of knobs) {
        if (k.type === 'param') obj.params = { ...obj.params, [k.key]: (obj.params[k.key] || 0) * ratio };
        else obj.scale = obj.scale.map((s, i) => (i === k.axis ? s * ratio : s));
      }
    };
    const measure = async () => {
      const b = await this.worldBox(obj);
      return b.max[axis] - b.min[axis];
    };
    let now = cur;
    let ok = false;
    for (let it = 0; it < 6; it++) {
      apply(target / now);
      now = await measure();
      if (Math.abs(now - target) < 0.001) {
        ok = true;
        break;
      }
    }
    if (!ok && knobs.some((k) => k.type === 'param')) {
      // parameter hit its limit (or is not linear): scale instead
      obj.params = saved.params;
      obj.scale = saved.scale;
      const l = this.dominantLocalAxis(obj, axis);
      knobs.length = 0;
      if (lock) for (let i = 0; i < 3; i++) knobs.push({ type: 'scale', axis: i });
      else knobs.push({ type: 'scale', axis: l });
      now = await measure();
      for (let it = 0; it < 6 && Math.abs(now - target) >= 0.001; it++) {
        apply(target / now);
        now = await measure();
      }
    }
    obj.scale = obj.scale.map((s) => Math.round(s * 1e9) / 1e9);
    for (const k of Object.keys(obj.params)) if (typeof obj.params[k] === 'number') obj.params[k] = Math.round(obj.params[k] * 1e6) / 1e6;
    await this.keepAnchor(obj, before);
    this.commit();
    return Math.abs(now - target) < 0.01;
  }

  // Scale an object by a factor (uniform), keeping its anchor.
  async scaleBy(obj, f) {
    const d = await this.worldDims(obj);
    let a = 0;
    if (d[1] > d[a]) a = 1;
    if (d[2] > d[a]) a = 2;
    return this.setWorldSize(obj, a, d[a] * f, true);
  }

  // Position fields: X/Y are the center, Z is the bottom (elevation).
  async setPosition(objs, axis, value, record = true) {
    if (record) this.begin();
    for (const obj of objs) {
      const b = await this.worldBox(obj);
      const cur = axis === 2 ? b.min[2] : (b.min[axis] + b.max[axis]) / 2;
      obj.pos[axis] += value - cur;
    }
    this.commit();
  }

  async moveBy(objs, dx, dy, dz, record = true) {
    if (record) this.begin();
    for (const o of objs) {
      o.pos[0] += dx;
      o.pos[1] += dy;
      o.pos[2] += dz;
    }
    this.commit();
  }

  // Set absolute rotation, turning in place: the bounding-box center stays,
  // and an object that rested on the bed keeps resting on it.
  async setRotation(obj, rot, record = true) {
    if (record) this.begin();
    const before = await this.worldBox(obj);
    const onBed = Math.abs(before.min[2]) < 0.01;
    obj.rot = rot.map((r) => normDeg(r));
    const after = await this.worldBox(obj);
    obj.pos[0] += (before.min[0] + before.max[0]) / 2 - (after.min[0] + after.max[0]) / 2;
    obj.pos[1] += (before.min[1] + before.max[1]) / 2 - (after.min[1] + after.max[1]) / 2;
    obj.pos[2] += onBed ? -after.min[2] : (before.min[2] + before.max[2]) / 2 - (after.min[2] + after.max[2]) / 2;
    this.commit();
  }

  // Rotate about a WORLD axis by `deg` (what the quick-turn buttons do).
  async rotateWorld(objs, axis, deg, record = true) {
    if (record) this.begin();
    for (const obj of objs) {
      const R = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...[0, 1, 2].map((i) => (i === axis ? 1 : 0))), deg * DEG);
      const cur = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG, 'ZYX'));
      const e = new THREE.Euler().setFromRotationMatrix(R.multiply(cur), 'ZYX');
      await this.setRotation(obj, [e.x / DEG, e.y / DEG, e.z / DEG].map((v) => Math.round(v * 1e6) / 1e6), false);
    }
    this.commit();
  }

  // Apply an extra rotation (as in analysis' orientation suggestions:
  // degrees about X, then Y, then Z in world space).
  async applyWorldEuler(obj, rxyz) {
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rxyz[0] * DEG, rxyz[1] * DEG, rxyz[2] * DEG, 'ZYX'));
    const cur = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(obj.rot[0] * DEG, obj.rot[1] * DEG, obj.rot[2] * DEG, 'ZYX'));
    const e = new THREE.Euler().setFromRotationMatrix(R.multiply(cur), 'ZYX');
    await this.setRotation(obj, [e.x / DEG, e.y / DEG, e.z / DEG], false);
  }

  async drop(objs, record = true) {
    if (record) this.begin();
    for (const o of objs) {
      const b = await this.worldBox(o);
      o.pos[2] -= b.min[2];
    }
    this.commit();
  }

  async center(objs, record = true) {
    if (record) this.begin();
    const solids = objs.filter((o) => !o.hole);
    const boxes = await Promise.all((solids.length ? solids : objs).map((o) => this.worldBox(o)));
    const mn = [0, 1].map((i) => Math.min(...boxes.map((b) => b.min[i])));
    const mx = [0, 1].map((i) => Math.max(...boxes.map((b) => b.max[i])));
    const dx = -(mn[0] + mx[0]) / 2;
    const dy = -(mn[1] + mx[1]) / 2;
    for (const o of objs) {
      o.pos[0] += dx;
      o.pos[1] += dy;
    }
    this.commit();
  }

  async mirror(objs, axis) {
    this.begin();
    for (const o of objs) {
      const before = await this.worldBox(o);
      const c = [0, 1, 2].map((i) => (before.min[i] + before.max[i]) / 2);
      const F = new THREE.Matrix4().makeScale(...[0, 1, 2].map((i) => (i === axis ? -1 : 1)));
      const T1 = new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]);
      const T2 = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]);
      const M = T2.multiply(F).multiply(T1).multiply(matrixOf(o));
      const d = decompose(M);
      if (d) Object.assign(o, d);
    }
    this.commit();
  }

  async remove(objs) {
    if (!objs.length) return;
    this.begin();
    const ids = new Set(objs.map((o) => o.id));
    this.objects = this.objects.filter((o) => !ids.has(o.id));
    this.selection = this.selection.filter((id) => !ids.has(id));
    this.emit('selection');
    this.commit();
  }

  async duplicate(objs, offset = true) {
    if (!objs.length) return [];
    this.begin();
    const copies = [];
    const boxes = await Promise.all(objs.map((o) => this.worldBox(o)));
    const span = Math.max(...boxes.map((b) => b.max[0])) - Math.min(...boxes.map((b) => b.min[0]));
    for (const o of objs) {
      const c = clone(stripTransient(o));
      renewIds(c);
      c.name = this.nextName(o.name.replace(/ \d+$/, ''));
      if (offset) c.pos[0] += span + 5;
      this.objects.push(c);
      copies.push(c);
    }
    this.select(copies.map((c) => c.id));
    this.commit();
    return copies;
  }

  async setHole(objs, hole) {
    this.begin();
    for (const o of objs) o.hole = hole;
    this.commit();
  }

  async setColor(objs, color) {
    this.begin();
    for (const o of objs) o.color = color;
    this.commit();
  }

  async rename(obj, name) {
    this.begin();
    obj.name = name;
    this.commit();
  }

  // Combine objects into one: solids merge, holes carve them.
  async group(objs) {
    if (objs.length < 2) return null;
    this.begin();
    const bases = await Promise.all(objs.map((o) => this.base(o)));
    const solids = [];
    const holes = [];
    objs.forEach((o, i) => {
      if (bases[i].man) (o.hole ? holes : solids).push(K.transform(bases[i].man, matrixOf(o).elements));
    });
    let comp;
    if (solids.length) {
      const u = K.unionAll(solids);
      if (holes.length) {
        const h = K.unionAll(holes);
        comp = u.subtract(h);
        u.delete();
        h.delete();
      } else comp = u;
    } else comp = K.unionAll(holes);
    solids.concat(holes).forEach((x) => x.delete());
    const b = comp && !comp.isEmpty() ? K.bbox(comp) : { min: [0, 0, 0], max: [0, 0, 0] };
    if (comp) comp.delete();
    const O = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    const children = objs.map((o) => {
      const c = clone(stripTransient(o));
      c.pos = [c.pos[0] - O[0], c.pos[1] - O[1], c.pos[2] - O[2]];
      return c;
    });
    const g = {
      id: newId('g'),
      name: this.nextName('Group'),
      kind: 'group',
      params: {},
      children,
      pos: O,
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      hole: solids.length === 0,
      color: (objs.find((o) => !o.hole) || objs[0]).color,
    };
    const ids = new Set(objs.map((o) => o.id));
    const at = this.objects.findIndex((o) => ids.has(o.id));
    this.objects = this.objects.filter((o) => !ids.has(o.id));
    this.objects.splice(Math.max(0, at), 0, g);
    // keep the composite exactly where it was
    const base = await this.base(g);
    g.pos = [O[0] - base.offset[0], O[1] - base.offset[1], O[2] - base.offset[2]];
    this.select(g.id);
    this.commit();
    return g;
  }

  async ungroup(g) {
    if (!g || g.kind !== 'group') return [];
    this.begin();
    const base = await this.base(g);
    const G = matrixOf(g).multiply(new THREE.Matrix4().makeTranslation(...base.offset));
    const out = [];
    for (const c of g.children) {
      const M = G.clone().multiply(matrixOf(c));
      const d = decompose(M);
      const child = clone(c);
      if (d) Object.assign(child, d);
      else {
        // shear (non-uniform scale + rotation): bake the shape into a mesh
        const cb = await this.base(c);
        if (cb.man) {
          const w = K.transform(cb.man, M.elements);
          const n = K.normalize(w);
          const meshId = newId('m');
          this.meshes[meshId] = { data: K.soup(n.man), name: c.name };
          child.kind = 'mesh';
          child.mesh = meshId;
          child.params = {};
          child.pos = n.offset.map((v) => -v);
          child.rot = [0, 0, 0];
          child.scale = [1, 1, 1];
          w.delete();
          n.man.delete();
        }
      }
      if (g.hole && !c.hole) child.hole = true;
      out.push(child);
    }
    const at = this.objects.indexOf(g);
    this.objects.splice(at, 1, ...out);
    this.select(out.map((o) => o.id));
    this.commit();
    return out;
  }

  async align(objs, axis, mode) {
    if (objs.length < 2) return;
    this.begin();
    const boxes = await Promise.all(objs.map((o) => this.worldBox(o)));
    const lo = Math.min(...boxes.map((b) => b.min[axis]));
    const hi = Math.max(...boxes.map((b) => b.max[axis]));
    objs.forEach((o, i) => {
      const b = boxes[i];
      let d = 0;
      if (mode === 'min') d = lo - b.min[axis];
      else if (mode === 'max') d = hi - b.max[axis];
      else d = (lo + hi) / 2 - (b.min[axis] + b.max[axis]) / 2;
      o.pos[axis] += d;
    });
    this.commit();
  }

  // Bounding box of what will print (the solids; holes only if there are
  // no solids). Plate-level operations anchor on this.
  async plateBox() {
    const solids = this.objects.filter((o) => !o.hole);
    const list = solids.length ? solids : this.objects;
    const boxes = await Promise.all(list.map((o) => this.worldBox(o)));
    return { min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))), max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) };
  }

  // Scale the whole plate so one overall dimension is exactly `target`.
  async scaleAll(axis, target) {
    if (!this.objects.length) return;
    const pb = await this.plateBox();
    const f = target / (pb.max[axis] - pb.min[axis]);
    await this.scaleAllBy(f, pb.min, pb.max);
  }

  async scaleAllBy(f, lo = null, hi = null) {
    if (!lo) {
      const pb = await this.plateBox();
      lo = pb.min;
      hi = pb.max;
    }
    this.begin();
    const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
    const S = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(new THREE.Matrix4().makeScale(f, f, f)).multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
    for (const o of this.objects) {
      const d = decompose(S.clone().multiply(matrixOf(o)));
      if (d) Object.assign(o, d);
    }
    this.commit();
  }

  // ---- whole document --------------------------------------------------------
  clear() {
    this.objects = [];
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.name = 'Untitled';
    this.path = '';
    this.dirty = false;
    this.version++;
    this.emit('selection');
    this.emit('change');
    this.update();
  }

  toDoc() {
    const used = new Set();
    const walk = (o) => {
      if (o.kind === 'mesh') used.add(o.mesh);
      if (o.children) o.children.forEach(walk);
    };
    this.objects.forEach(walk);
    const meshes = {};
    for (const id of used) if (this.meshes[id]) meshes[id] = { name: this.meshes[id].name || '', f32: f32ToB64(this.meshes[id].data) };
    return {
      app: 'PrintForge',
      version: 1,
      name: this.name,
      settings: { units: this.settings.units, printer: this.settings.printer, material: this.settings.material },
      objects: this.objects.map(stripTransient),
      meshes,
    };
  }

  loadDoc(doc, path = '') {
    this.meshes = {};
    for (const [id, m] of Object.entries(doc.meshes || {})) this.meshes[id] = { name: m.name, data: b64ToF32(m.f32) };
    this.objects = (doc.objects || []).map(sanitizeObj);
    this.name = doc.name || 'Untitled';
    this.path = path;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.version++;
    this.emit('selection');
    this.emit('change');
    return this.update();
  }
}

function normDeg(d) {
  let x = ((d % 360) + 540) % 360 - 180;
  if (Math.abs(x + 180) < 1e-9) x = 180;
  return Math.round(x * 1e6) / 1e6;
}

function overlaps(a, b) {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

function transformRaw(raw, m) {
  const out = new Float32Array(raw.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < raw.length; i += 3) {
    v.set(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(m);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return out;
}

function rawBox(raw, m) {
  const v = new THREE.Vector3();
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.length; i += 3) {
    v.set(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(m);
    const a = [v.x, v.y, v.z];
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], a[k]);
      mx[k] = Math.max(mx[k], a[k]);
    }
  }
  return { min: mn, max: mx };
}

function sortKeys(o) {
  const out = {};
  for (const k of Object.keys(o || {}).sort()) out[k] = o[k];
  return out;
}

function structKey(o) {
  return { k: o.kind, p: sortKeys(o.params), m: o.mesh || '', pos: o.pos, rot: o.rot, s: o.scale, h: !!o.hole, c: o.children ? o.children.map(structKey) : undefined };
}

export function stripTransient(o) {
  const c = { id: o.id, name: o.name, kind: o.kind, params: o.params, pos: o.pos, rot: o.rot, scale: o.scale, hole: !!o.hole, color: o.color };
  if (o.mesh) c.mesh = o.mesh;
  if (o.children) c.children = o.children.map(stripTransient);
  return c;
}

function renewIds(o) {
  o.id = newId(o.kind === 'group' ? 'g' : 'o');
  if (o.children) o.children.forEach(renewIds);
}

function num3(v, d) {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && isFinite(x)) ? v.slice() : d.slice();
}

export function sanitizeObj(o) {
  const c = {
    id: typeof o.id === 'string' ? o.id : newId(),
    name: typeof o.name === 'string' ? o.name : 'Shape',
    kind: typeof o.kind === 'string' ? o.kind : 'box',
    params: o.params && typeof o.params === 'object' ? o.params : {},
    pos: num3(o.pos, [0, 0, 0]),
    rot: num3(o.rot, [0, 0, 0]),
    scale: num3(o.scale, [1, 1, 1]),
    hole: !!o.hole,
    color: typeof o.color === 'string' ? o.color : PALETTE[0],
  };
  if (c.kind === 'mesh') c.mesh = o.mesh;
  if (c.kind === 'group') c.children = (o.children || []).map(sanitizeObj);
  return c;
}
