// The 3D view: printer bed, objects, selection, dragging, gizmo, dimension
// labels, measuring. Z is up (3D-printing convention); units are mm.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { matrixOf, decompose } from './model.js';
import { fmtLen, fmtNum } from './format.js';

const DEG = Math.PI / 180;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Viewport extends EventTarget {
  constructor(container, model) {
    super();
    this.el = container;
    this.model = model;
    this.tool = 'select'; // select | rotate | measure
    this.items = new Map(); // id -> { mesh, edges, geomMatrix, key }
    this.needsRender = true;
    this.dragging = null;
    this.measure = { points: [], objects: [] };
    this.labels = [];
    this.showEdges = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.el.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'gl';

    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.el.appendChild(this.overlay);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(260, -380, 300);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance = 4000;
    this.controls.minDistance = 5;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener('change', () => this.invalidate());

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.6);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.position.set(-150, -250, 450);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(300, 200, 120);
    this.scene.add(fill);

    this.bedGroup = new THREE.Group();
    this.scene.add(this.bedGroup);
    this.objGroup = new THREE.Group();
    this.scene.add(this.objGroup);
    this.helperGroup = new THREE.Group();
    this.scene.add(this.helperGroup);

    // gizmo (move arrows / rotate rings) on a proxy object
    this.proxy = new THREE.Object3D();
    this.scene.add(this.proxy);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.85);
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    this.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this.gizmoStart();
      else this.gizmoEnd();
    });
    this.gizmo.addEventListener('objectChange', () => this.gizmoChange());
    this.gizmo.addEventListener('change', () => this.invalidate());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindPointer();
    this.bindDrop();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
    this.buildBed();

    model.addEventListener('geometry', () => this.sync());
    model.addEventListener('change', () => this.syncTransforms());
    model.addEventListener('selection', () => {
      this.syncSelection();
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        this.buildBed();
        this.invalidate();
      });
    }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  invalidate() {
    this.needsRender = true;
  }

  resize() {
    const w = Math.max(this.el.clientWidth, 1);
    const h = Math.max(this.el.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  loop() {
    requestAnimationFrame(this.loop);
    const moved = this.controls.update();
    if (this.tween) this.stepTween();
    if (moved || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
    }
  }

  // ---- bed --------------------------------------------------------------------
  buildBed() {
    const pr = this.model.printer();
    this.bedGroup.clear();
    const dark = document.documentElement.classList.contains('dark') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const bedColor = new THREE.Color(cssVar('--bed', dark ? '#2a3140' : '#e8ecf2'));
    const minor = new THREE.Color(cssVar('--grid-minor', dark ? '#343c4d' : '#d6dce5'));
    const major = new THREE.Color(cssVar('--grid-major', dark ? '#46506a' : '#b8c1ce'));
    const { bx, by, bz } = pr;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), new THREE.MeshStandardMaterial({ color: bedColor, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    plate.receiveShadow = true;
    plate.position.z = -0.05;
    plate.name = 'bed';
    this.bedGroup.add(plate);
    const under = new THREE.Mesh(new THREE.BoxGeometry(bx + 6, by + 6, 3), new THREE.MeshStandardMaterial({ color: dark ? 0x1d222c : 0xcfd6e0, roughness: 0.9 }));
    under.position.z = -2.2;
    this.bedGroup.add(under);
    const pts = [];
    const majorPts = [];
    for (let x = 0; x <= bx / 2; x += 10) for (const s of x === 0 ? [1] : [1, -1]) {
      const arr = Math.round(x) % 50 === 0 ? majorPts : pts;
      arr.push(s * x, -by / 2, 0.01, s * x, by / 2, 0.01);
    }
    for (let y = 0; y <= by / 2; y += 10) for (const s of y === 0 ? [1] : [1, -1]) {
      const arr = Math.round(y) % 50 === 0 ? majorPts : pts;
      arr.push(-bx / 2, s * y, 0.01, bx / 2, s * y, 0.01);
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bedGroup.add(new THREE.LineSegments(g1, new THREE.LineBasicMaterial({ color: minor })));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
    this.bedGroup.add(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: major })));
    // build volume
    const vol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, by, bz)), new THREE.LineBasicMaterial({ color: major, transparent: true, opacity: 0.45 }));
    vol.position.z = bz / 2;
    vol.name = 'volume';
    this.volume = vol;
    this.bedGroup.add(vol);
    // axis hint at the front-left corner
    const ax = new THREE.Group();
    const mk = (dir, color) => new THREE.ArrowHelper(dir, new THREE.Vector3(-bx / 2 + 6, -by / 2 + 6, 0.2), 22, color, 5, 3);
    ax.add(mk(new THREE.Vector3(1, 0, 0), 0xe5484d));
    ax.add(mk(new THREE.Vector3(0, 1, 0), 0x30a46c));
    this.bedGroup.add(ax);
    // shadow camera covers the bed
    const s = Math.max(bx, by) * 0.8;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 2000 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.bedLabelPos = new THREE.Vector3(0, -by / 2 - 9, 0);
    this.invalidate();
  }

  setVolumeVisible(v) {
    if (this.volume) this.volume.visible = v;
    this.invalidate();
  }

  // ---- objects ----------------------------------------------------------------
  material(color, ghost, selected) {
    if (ghost) {
      return new THREE.MeshStandardMaterial({ color: selected ? 0x7c8aa5 : 0x9aa3b2, transparent: true, opacity: selected ? 0.45 : 0.32, roughness: 0.6, depthWrite: false, side: THREE.DoubleSide });
    }
    const c = new THREE.Color(color);
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.04, emissive: selected ? c.clone().multiplyScalar(0.18) : 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  }

  sync() {
    const sel = new Set(this.model.selection);
    const seen = new Set();
    for (const o of this.model.objects) {
      const d = this.model.display.get(o.id);
      if (!d) continue;
      seen.add(o.id);
      let it = this.items.get(o.id);
      if (!it || it.key !== d.key || it.ghost !== d.ghost) {
        if (it) this.disposeItem(it);
        const mesh = new THREE.Mesh(d.geometry, this.material(o.color, d.ghost, sel.has(o.id)));
        mesh.castShadow = !d.ghost;
        mesh.receiveShadow = !d.ghost;
        mesh.matrixAutoUpdate = false;
        mesh.userData.id = o.id;
        mesh.renderOrder = d.ghost ? 2 : 0;
        // feature edges (skipped for very dense meshes, where they only add noise)
        const tris = d.geometry.getAttribute('position').count / 3;
        const eg = tris > 120000 ? new THREE.BufferGeometry() : new THREE.EdgesGeometry(d.geometry, 28);
        const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: d.ghost ? 0.5 : 0.28 }));
        edges.matrixAutoUpdate = false;
        edges.visible = this.showEdges || d.ghost;
        this.objGroup.add(mesh);
        this.objGroup.add(edges);
        it = { mesh, edges, geomMatrix: d.matrix.clone(), key: d.key, ghost: d.ghost, color: o.color };
        this.items.set(o.id, it);
      } else if (it.color !== o.color) {
        it.mesh.material.dispose();
        it.mesh.material = this.material(o.color, d.ghost, sel.has(o.id));
        it.color = o.color;
      }
    }
    for (const [id, it] of this.items) if (!seen.has(id)) {
      this.disposeItem(it);
      this.items.delete(id);
    }
    this.syncTransforms();
    this.syncSelection();
  }

  disposeItem(it) {
    this.objGroup.remove(it.mesh);
    this.objGroup.remove(it.edges);
    it.mesh.material.dispose();
    it.edges.geometry.dispose();
    it.edges.material.dispose();
  }

  // Geometry is built in world space for the transform it had then; while an
  // object moves (or before its new geometry arrives) show it with the
  // relative transform  M_now · M_built^-1.
  syncTransforms() {
    const inv = new THREE.Matrix4();
    for (const o of this.model.objects) {
      const it = this.items.get(o.id);
      if (!it) continue;
      inv.copy(it.geomMatrix).invert();
      const m = matrixOf(o).multiply(inv);
      it.mesh.matrix.copy(m);
      it.edges.matrix.copy(m);
      it.mesh.matrixWorldNeedsUpdate = true;
      it.edges.matrixWorldNeedsUpdate = true;
    }
    this.updateGizmo();
    this.updateSelectionBox();
    this.invalidate();
  }

  syncSelection() {
    const sel = new Set(this.model.selection);
    for (const o of this.model.objects) {
      const it = this.items.get(o.id);
      if (!it) continue;
      const d = this.model.display.get(o.id);
      it.mesh.material.dispose();
      it.mesh.material = this.material(o.color, d ? d.ghost : o.hole, sel.has(o.id));
      it.edges.material.color.set(sel.has(o.id) ? cssVar('--accent', '#2563eb') : 0x1e293b);
      it.edges.material.opacity = sel.has(o.id) ? 0.95 : o.hole ? 0.5 : 0.28;
      it.edges.visible = this.showEdges || o.hole || sel.has(o.id);
    }
    this.updateGizmo();
    this.updateSelectionBox();
    this.invalidate();
  }

  setEdges(v) {
    this.showEdges = v;
    this.syncSelection();
  }

  // Current world bounding box of a set of objects (from the meshes on
  // screen, so it follows live drags).
  boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const it = this.items.get(id);
      if (!it) continue;
      const g = it.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox.clone().applyMatrix4(it.mesh.matrix);
      box.union(b);
    }
    return box;
  }

  updateSelectionBox() {
    this.helperGroup.clear();
    this.clearLabels('dim');
    const ids = this.model.selection;
    if (!ids.length || this.tool === 'measure') return;
    const box = this.boxOf(ids);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const accent = new THREE.Color(cssVar('--accent', '#2563eb'));
    const helper = new THREE.Box3Helper(box, accent);
    helper.material.transparent = true;
    helper.material.opacity = 0.35;
    this.helperGroup.add(helper);
    // dimension lines just outside the box
    const off = Math.max(4, Math.max(size.x, size.y) * 0.06);
    const zb = box.min.z;
    const pts = [
      [box.min.x, box.min.y - off, zb, box.max.x, box.min.y - off, zb],
      [box.max.x + off, box.min.y, zb, box.max.x + off, box.max.y, zb],
      [box.max.x + off, box.min.y - off, box.min.z, box.max.x + off, box.min.y - off, box.max.z],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    this.helperGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: accent })));
    const unit = this.model.settings.units;
    const mk = (axis, v, p) => this.addLabel('dim', p, fmtLen(v, unit), { axis, value: v, editable: true });
    mk(0, size.x, new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y - off, zb));
    mk(1, size.y, new THREE.Vector3(box.max.x + off, (box.min.y + box.max.y) / 2, zb));
    mk(2, size.z, new THREE.Vector3(box.max.x + off, box.min.y - off, (box.min.z + box.max.z) / 2));
    if (box.min.z > 0.05) this.addLabel('dim', new THREE.Vector3(box.min.x, box.min.y, box.min.z / 2), '↑ ' + fmtLen(box.min.z, unit), { cls: 'elev' });
    this.invalidate();
  }

  // ---- HTML labels anchored to 3D points ------------------------------------
  addLabel(group, pos, text, opts = {}) {
    const el = document.createElement('div');
    el.className = 'vlabel ' + (opts.cls || '') + (opts.editable ? ' editable' : '');
    el.textContent = text;
    if (opts.editable) {
      el.title = 'Click to type an exact size';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('edit-size', { detail: { axis: opts.axis, value: opts.value, el } }));
      });
    }
    this.overlay.appendChild(el);
    this.labels.push({ group, pos, el });
    return el;
  }

  clearLabels(group) {
    this.labels = this.labels.filter((l) => {
      if (l.group !== group) return true;
      l.el.remove();
      return false;
    });
  }

  placeLabels() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const vis = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2;
      l.el.style.display = vis ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // ---- picking & dragging ----------------------------------------------------------
  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pick(e) {
    this.setPointer(e);
    const meshes = [...this.items.values()].map((i) => i.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0] : null;
  }

  bedPoint(e, z = 0) {
    this.setPointer(e);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  bindPointer() {
    const dom = this.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.gizmo.dragging || this.gizmo.axis) return;
      const hit = this.pick(e);
      down = { x: e.clientX, y: e.clientY, hit, t: performance.now() };
      if (this.tool === 'measure') return;
      if (hit) {
        const id = hit.object.userData.id;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!this.model.selection.includes(id) || additive) this.model.select(id, additive);
        if (!additive) this.startDrag(e, hit);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        this.moveDrag(e);
        return;
      }
      if (this.tool === 'measure') this.measureHover(e);
      else if (!e.buttons) this.hover(e);
    });
    window.addEventListener('pointerup', (e) => {
      if (this.dragging) this.endDrag(e);
      if (down && e.target === dom) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
        if (!moved) {
          if (this.tool === 'measure') this.measureClick(e);
          else if (!down.hit && !e.shiftKey) this.model.select([]);
        }
      }
      down = null;
    });
    dom.addEventListener('dblclick', (e) => {
      const hit = this.pick(e);
      if (hit) this.dispatchEvent(new CustomEvent('focus-object', { detail: hit.object.userData.id }));
      else this.fit();
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  hover(e) {
    const hit = this.pick(e);
    const id = hit ? hit.object.userData.id : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.renderer.domElement.style.cursor = id ? 'move' : '';
      this.dispatchEvent(new CustomEvent('hover', { detail: id }));
    }
  }

  startDrag(e, hit) {
    const objs = this.model.selected();
    if (!objs.length) return;
    this.controls.enabled = false;
    const z = hit.point.z;
    const p0 = this.bedPoint(e, z);
    if (!p0) return;
    this.dragging = { z, p0, start: objs.map((o) => ({ o, pos: o.pos.slice() })), began: false, alt: e.altKey };
  }

  moveDrag(e) {
    const d = this.dragging;
    const p = this.bedPoint(e, d.z);
    if (!p) return;
    let dx = p.x - d.p0.x;
    let dy = p.y - d.p0.y;
    const step = e.shiftKey ? 0 : this.model.settings.grid || 0;
    if (step > 0) {
      dx = Math.round(dx / step) * step;
      dy = Math.round(dy / step) * step;
    }
    if (!d.began) {
      if (Math.hypot(dx, dy) < 0.001) return;
      d.began = true;
      this.model.begin();
    }
    for (const s of d.start) {
      s.o.pos[0] = s.pos[0] + dx;
      s.o.pos[1] = s.pos[1] + dy;
    }
    this.syncTransforms();
    this.dispatchEvent(new CustomEvent('live-move', { detail: { dx, dy } }));
    // keep hole cuts live when the geometry pipeline is quick
    if (this.model.lastUpdateMs < 60) this.model.update();
  }

  endDrag() {
    const d = this.dragging;
    this.dragging = null;
    this.controls.enabled = true;
    if (d && d.began) this.model.commit();
  }

  // ---- gizmo -----------------------------------------------------------------
  setTool(tool) {
    this.tool = tool;
    if (tool !== 'measure') this.clearMeasure();
    this.renderer.domElement.style.cursor = tool === 'measure' ? 'crosshair' : '';
    this.updateGizmo();
    this.updateSelectionBox();
  }

  updateGizmo() {
    const objs = this.model.selected();
    const show = objs.length > 0 && this.tool !== 'measure' && !this.gizmoDrag;
    if (!show) {
      if (!this.gizmoDrag) this.gizmo.detach();
      this.invalidate();
      return;
    }
    if (this.gizmoDrag) return;
    const box = this.boxOf(objs.map((o) => o.id));
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    this.proxy.position.copy(c);
    this.proxy.quaternion.identity();
    this.proxy.updateMatrixWorld();
    this.gizmo.setMode(this.tool === 'rotate' ? 'rotate' : 'translate');
    this.gizmo.setRotationSnap(this.model.settings.snapAngle === 0 ? null : 15 * DEG);
    this.gizmo.setTranslationSnap(this.model.settings.grid || null);
    this.gizmo.attach(this.proxy);
  }

  gizmoStart() {
    const objs = this.model.selected();
    this.gizmoDrag = {
      objs,
      start: objs.map((o) => ({ o, m: matrixOf(o), onBed: false })),
      pos: this.proxy.position.clone(),
      quat: this.proxy.quaternion.clone(),
    };
    for (const s of this.gizmoDrag.start) {
      const it = this.items.get(s.o.id);
      if (it) {
        const b = this.boxOf([s.o.id]);
        s.onBed = Math.abs(b.min.z) < 0.02;
      }
    }
    this.model.begin();
  }

  gizmoChange() {
    const g = this.gizmoDrag;
    if (!g) return;
    if (this.gizmo.mode === 'translate') {
      const d = this.proxy.position.clone().sub(g.pos);
      for (const s of g.start) {
        const p = new THREE.Vector3().setFromMatrixPosition(s.m);
        s.o.pos = [p.x + d.x, p.y + d.y, p.z + d.z];
      }
    } else {
      const q = this.proxy.quaternion.clone().multiply(g.quat.clone().invert());
      const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const c = g.pos;
      const T = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      for (const s of g.start) {
        const dd = decompose(T.clone().multiply(s.m));
        if (dd) {
          s.o.pos = dd.pos;
          s.o.rot = dd.rot;
        }
      }
    }
    this.syncTransforms();
    this.dispatchEvent(new CustomEvent('live-move', { detail: {} }));
  }

  async gizmoEnd() {
    const g = this.gizmoDrag;
    this.gizmoDrag = null;
    if (!g) return;
    if (this.gizmo.mode === 'rotate') {
      // turning something that sat on the bed keeps it on the bed
      for (const s of g.start) if (s.onBed) {
        const b = await this.model.worldBox(s.o);
        s.o.pos[2] -= b.min[2];
      }
    }
    this.model.commit();
    this.updateGizmo();
  }

  // ---- measuring -----------------------------------------------------------------
  snapPoint(hit) {
    // snap to the nearest triangle corner when close on screen
    const p = hit.point.clone();
    if (!hit.face) return p;
    const mesh = hit.object;
    const pos = mesh.geometry.getAttribute('position');
    const r = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (v) => {
      const s = v.clone().project(this.camera);
      return new THREE.Vector2(((s.x + 1) / 2) * r.width, ((1 - s.y) / 2) * r.height);
    };
    const hp = toScreen(p);
    let best = null;
    let bd = 10;
    for (const idx of [hit.face.a, hit.face.b, hit.face.c]) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld);
      const dd = toScreen(v).distanceTo(hp);
      if (dd < bd) {
        bd = dd;
        best = v;
      }
    }
    return best || p;
  }

  measurePointAt(e) {
    const hit = this.pick(e);
    if (hit) return this.snapPoint(hit);
    return this.bedPoint(e, 0);
  }

  measureHover(e) {
    const p = this.measurePointAt(e);
    if (!this.measureCursor) {
      this.measureCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: cssVar('--accent', '#2563eb'), depthTest: false }));
      this.measureCursor.renderOrder = 10;
      this.scene.add(this.measureCursor);
    }
    this.measureCursor.visible = !!p;
    if (p) {
      this.measureCursor.position.copy(p);
      const s = this.camera.position.distanceTo(p) * 0.006;
      this.measureCursor.scale.setScalar(s);
    }
    if (this.measure.points.length === 1 && p) this.drawMeasure(this.measure.points[0], p, true);
    this.invalidate();
  }

  measureClick(e) {
    const p = this.measurePointAt(e);
    if (!p) return;
    if (this.measure.points.length >= 2) this.clearMeasure();
    this.measure.points.push(p);
    if (this.measure.points.length === 2) {
      this.drawMeasure(this.measure.points[0], this.measure.points[1], false);
      const [a, b] = this.measure.points;
      this.dispatchEvent(new CustomEvent('measured', { detail: { a, b, d: a.distanceTo(b) } }));
    } else this.drawMeasure(p, p, true);
  }

  drawMeasure(a, b, live) {
    for (const o of this.measure.objects) {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
    }
    this.measure.objects = [];
    this.clearLabels('measure');
    const color = cssVar('--accent', '#2563eb');
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 9;
    this.scene.add(line);
    this.measure.objects.push(line);
    for (const p of [a, b]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(this.camera.position.distanceTo(p) * 0.005, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      s.position.copy(p);
      s.renderOrder = 10;
      this.scene.add(s);
      this.measure.objects.push(s);
    }
    if (a.distanceTo(b) > 0.001) {
      const unit = this.model.settings.units;
      const d = b.clone().sub(a);
      const txt = fmtLen(a.distanceTo(b), unit) + `  (X ${fmtLen(Math.abs(d.x), unit, false)} · Y ${fmtLen(Math.abs(d.y), unit, false)} · Z ${fmtLen(Math.abs(d.z), unit, false)})`;
      this.addLabel('measure', a.clone().add(b).multiplyScalar(0.5), txt, { cls: 'measure' + (live ? ' live' : '') });
    }
    this.invalidate();
  }

  clearMeasure() {
    for (const o of this.measure.objects) {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
    }
    this.measure = { points: [], objects: [] };
    this.clearLabels('measure');
    if (this.measureCursor) this.measureCursor.visible = false;
    this.invalidate();
  }

  // ---- library drag & drop -----------------------------------------------------
  bindDrop() {
    this.el.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer.types || [])].includes('text/x-printforge-part')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.el.addEventListener('drop', (e) => {
      const kind = e.dataTransfer.getData('text/x-printforge-part');
      if (!kind) return;
      e.preventDefault();
      const p = this.bedPoint(e, 0);
      this.dispatchEvent(new CustomEvent('drop-part', { detail: { kind, x: p ? p.x : 0, y: p ? p.y : 0 } }));
    });
  }

  // ---- camera -------------------------------------------------------------------
  sceneBox() {
    const ids = this.model.objects.map((o) => o.id);
    const b = this.boxOf(ids);
    if (b.isEmpty()) {
      const pr = this.model.printer();
      return new THREE.Box3(new THREE.Vector3(-pr.bx / 2, -pr.by / 2, 0), new THREE.Vector3(pr.bx / 2, pr.by / 2, 30));
    }
    return b;
  }

  setView(name, animate = true) {
    const dirs = {
      iso: [0.55, -0.8, 0.62],
      top: [0, -0.0001, 1],
      front: [0, -1, 0.0001],
      back: [0, 1, 0.0001],
      right: [1, 0, 0.0001],
      left: [-1, 0, 0.0001],
      bottom: [0, 0.0001, -1],
    };
    const d = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    const box = this.model.selection.length ? this.boxOf(this.model.selection) : this.sceneBox();
    this.frame(box, d, animate);
  }

  fit(animate = true) {
    const d = this.camera.position.clone().sub(this.controls.target).normalize();
    const box = this.model.selection.length ? this.boxOf(this.model.selection) : this.sceneBox();
    this.frame(box, d, animate);
  }

  // Keep the given objects in view: re-frame only if one is off screen.
  ensureVisible(ids, minRadius = 70) {
    const box = this.boxOf(ids);
    if (box.isEmpty()) return;
    const v = new THREE.Vector3();
    let off = false;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v.set(x, y, z).project(this.camera);
      if (Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.92 || v.z > 1) off = true;
    }
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = this.camera.position.distanceTo(box.getCenter(new THREE.Vector3()));
    if (off || size / dist < 0.04) this.frameAll(minRadius);
  }

  frameAll(minRadius = 70) {
    const d = this.camera.position.clone().sub(this.controls.target).normalize();
    this.frame(this.sceneBox(), d, true, minRadius);
  }

  frame(box, dir, animate, minRadius = 25) {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, minRadius);
    const dist = r / Math.sin((this.camera.fov * DEG) / 2) * 1.15;
    const to = c.clone().add(dir.clone().multiplyScalar(dist));
    if (!animate) {
      this.camera.position.copy(to);
      this.controls.target.copy(c);
      this.controls.update();
      this.invalidate();
      return;
    }
    this.tween = { t0: performance.now(), from: this.camera.position.clone(), to, tf: this.controls.target.clone(), tt: c };
  }

  stepTween() {
    const tw = this.tween;
    const k = Math.min(1, (performance.now() - tw.t0) / 380);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.camera.position.lerpVectors(tw.from, tw.to, e);
    this.controls.target.lerpVectors(tw.tf, tw.tt, e);
    this.invalidate();
    if (k >= 1) this.tween = null;
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

export { fmtNum };
