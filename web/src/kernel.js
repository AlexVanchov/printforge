// Geometry kernel: executes PrintForge recipes (built by the Solemn `parts`
// module) with manifold-3d, which guarantees watertight, printable meshes.
// Works in the browser (wasm embedded as base64) and in Node (tests).
//
// Memory: manifold objects live in the WASM heap and must be deleted. Every
// function here returns a NEW manifold the caller owns and deletes any
// intermediates it created.
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';

let W = null; // the initialized wasm module
let font = null;
let capRatio = 0.72; // capital-letter height / font size, measured at init

export function kernelReady() {
  return W !== null;
}

export async function initKernel(factory, fontJson, wasmBinary) {
  const opts = {};
  if (wasmBinary) {
    opts.wasmBinary = wasmBinary;
    opts.locateFile = () => 'manifold.wasm';
  }
  W = await factory(opts);
  W.setup();
  if (fontJson) {
    font = new Font(fontJson);
    const shapes = font.generateShapes('H', 100);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of shapes) {
      for (const p of s.getPoints(4)) {
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
    }
    if (y1 > y0) capRatio = (y1 - y0) / 100;
  }
  return W;
}

export function wasm() {
  return W;
}

// Circle resolution: ~0.5 mm chords, 24..180 segments. Smooth prints without
// exploding triangle counts.
export function segs(r) {
  const n = Math.round((2 * Math.PI * Math.max(r, 0.01)) / 0.5);
  return Math.max(24, Math.min(180, n + (4 - (n % 4)) % 4));
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function ccw(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

function roundedRect(x0, y0, x1, y1, r) {
  const { CrossSection } = W;
  const w = x1 - x0;
  const h = y1 - y0;
  const rr = Math.max(0, Math.min(r || 0, w / 2 - 0.01, h / 2 - 0.01));
  if (rr <= 0.01) return CrossSection.square([w, h]).translate([x0, y0]);
  const core = CrossSection.square([w - 2 * rr, h - 2 * rr]).translate([x0 + rr, y0 + rr]);
  const out = core.offset(rr, 'Round', 2, segs(rr));
  core.delete();
  return out;
}

// Text outlines as one CrossSection, centered on the origin, capital
// letters `size` mm tall.
function textSection(text, size) {
  const { CrossSection } = W;
  if (!font || !text || !text.trim()) return null;
  const fsize = size / capRatio;
  const shapes = font.generateShapes(text, fsize);
  const parts = [];
  for (const s of shapes) {
    const ext = s.extractPoints(6);
    const outer = ext.shape.map((p) => [p.x, p.y]);
    if (outer.length < 3) continue;
    const polys = [ccw(outer)];
    for (const h of ext.holes) {
      const hp = h.map((p) => [p.x, p.y]);
      if (hp.length >= 3) polys.push(ccw(hp).reverse());
    }
    parts.push(new CrossSection(polys, 'Positive'));
  }
  if (!parts.length) return null;
  const all = CrossSection.union(parts);
  parts.forEach((p) => p.delete());
  const b = all.bounds();
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const centered = all.translate([-cx, -cy]);
  all.delete();
  return centered;
}

function buildPrimitive(n) {
  const { Manifold, CrossSection } = W;
  switch (n.t) {
    case 'box': {
      const [x, y, z] = n.s;
      if (n.rall > 0.01) {
        const r = Math.min(n.rall, x / 2, y / 2, z / 2);
        const s = Manifold.sphere(r, segs(r));
        const pts = [];
        for (const px of [r, x - r]) for (const py of [r, y - r]) for (const pz of [r, z - r]) pts.push(s.translate([px, py, pz]));
        const h = Manifold.hull(pts);
        pts.forEach((p) => p.delete());
        s.delete();
        return h;
      }
      if (n.r > 0.01) {
        const cs = roundedRect(0, 0, x, y, n.r);
        const m = cs.extrude(z);
        cs.delete();
        return m;
      }
      return Manifold.cube([x, y, z], false);
    }
    case 'cyl': {
      const r1 = Math.max(n.r1 || 0, 0);
      const r2 = n.r2 === undefined ? r1 : Math.max(n.r2, 0);
      const fn = n.fn > 2 ? Math.round(n.fn) : segs(Math.max(r1, r2));
      if (r1 <= 0 && r2 <= 0) return Manifold.cube([0.01, 0.01, 0.01]);
      if (r1 <= 0) {
        // Manifold needs a positive bottom radius: build upside down.
        const c = Manifold.cylinder(n.h, r2, 0, fn, false);
        const f = c.mirror([0, 0, 1]).translate([0, 0, n.h]);
        c.delete();
        return f;
      }
      return Manifold.cylinder(n.h, r1, r2, fn, false);
    }
    case 'sphere':
      return Manifold.sphere(n.r, segs(n.r));
    case 'torus': {
      const c = CrossSection.circle(n.r, segs(n.r)).translate([n.R, 0]);
      const m = c.revolve(segs(n.R + n.r));
      c.delete();
      return m;
    }
    case 'poly': {
      const pts = ccw(n.pts);
      const cs = new CrossSection([pts], 'Positive');
      const top = n.top === undefined ? 1 : n.top;
      const m = top === 1 ? cs.extrude(n.h) : cs.extrude(n.h, 0, 0, [top, top]);
      cs.delete();
      return m;
    }
    case 'text': {
      const cs = textSection(n.text, n.size);
      if (!cs) return Manifold.cube([0.01, 0.01, 0.01]);
      const m = cs.extrude(n.h);
      cs.delete();
      return m;
    }
    case 'tag': {
      const cs = textSection(n.text, n.size);
      let x0 = -10;
      let x1 = 10;
      let y0 = -n.size / 2;
      let y1 = n.size / 2;
      if (cs) {
        const b = cs.bounds();
        x0 = b.min[0];
        x1 = b.max[0];
        y0 = Math.min(b.min[1], -n.size / 2);
        y1 = Math.max(b.max[1], n.size / 2);
        cs.delete();
      }
      const pad = n.pad;
      const hole = n.hole || 0;
      const left = x0 - pad - (hole > 0 ? hole + pad * 0.8 : 0);
      let plate = roundedRect(left, y0 - pad, x1 + pad, y1 + pad, n.r);
      if (hole > 0) {
        const c = CrossSection.circle(hole / 2, segs(hole / 2)).translate([left + pad * 0.6 + hole / 2, (y0 + y1) / 2]);
        const p2 = plate.subtract(c);
        plate.delete();
        c.delete();
        plate = p2;
      }
      const m = plate.extrude(n.h);
      plate.delete();
      return m;
    }
    default:
      return null;
  }
}

export function buildRecipe(n) {
  const { Manifold } = W;
  let m = buildPrimitive(n);
  if (!m) {
    const kids = (n.c || []).map(buildRecipe).filter(Boolean);
    if (!kids.length) return null;
    if (n.t === 'union') m = kids.length === 1 ? kids[0].translate([0, 0, 0]) : Manifold.union(kids);
    else if (n.t === 'diff') {
      if (kids.length === 1) m = kids[0].translate([0, 0, 0]);
      else {
        const cut = Manifold.union(kids.slice(1));
        m = kids[0].subtract(cut);
        cut.delete();
      }
    } else if (n.t === 'inter') m = kids.length === 1 ? kids[0].translate([0, 0, 0]) : Manifold.intersection(kids);
    else if (n.t === 'hull') m = Manifold.hull(kids);
    else m = Manifold.union(kids);
    kids.forEach((k) => k.delete());
  }
  if (n.rot) {
    const r = m.rotate(n.rot);
    m.delete();
    m = r;
  }
  if (n.tr) {
    const t = m.translate(n.tr);
    m.delete();
    m = t;
  }
  return m;
}

// Move so the bounding box is centered in X/Y and rests on z = 0.
export function normalize(m) {
  const b = m.boundingBox();
  const off = [-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]];
  return { man: m.translate(off), offset: off };
}

export function bbox(m) {
  const b = m.boundingBox();
  return { min: [...b.min], max: [...b.max] };
}

// Triangle soup (Float32Array, 9 floats per triangle) from a manifold.
export function soup(m) {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const out = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) {
    const v = tv[i] * np;
    out[i * 3] = vp[v];
    out[i * 3 + 1] = vp[v + 1];
    out[i * 3 + 2] = vp[v + 2];
  }
  return out;
}

// Indexed positions for rendering (shared vertices; normals are computed
// flat by the renderer from the non-indexed copy).
export function meshArrays(m) {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const nv = vp.length / np;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = vp[i * np];
    pos[i * 3 + 1] = vp[i * np + 1];
    pos[i * 3 + 2] = vp[i * np + 2];
  }
  return { pos, index: new Uint32Array(mesh.triVerts) };
}

// A manifold from a triangle soup (imported files). Vertices are welded
// first; returns { man, ok } where ok=false means the surface has holes or
// is otherwise not a closed solid (man is then null).
export function fromSoup(tri) {
  const { Manifold, Mesh } = W;
  const n = tri.length / 3;
  // weld identical positions (quantized to 1e-5 mm)
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = tri[i * 3];
    const y = tri[i * 3 + 1];
    const z = tri[i * 3 + 2];
    const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
    let k = map.get(key);
    if (k === undefined) {
      k = pos.length / 3;
      map.set(key, k);
      pos.push(x, y, z);
    }
    idx[i] = k;
  }
  // drop degenerate triangles
  const tris = [];
  for (let t = 0; t < n / 3; t++) {
    const a = idx[t * 3];
    const b = idx[t * 3 + 1];
    const c = idx[t * 3 + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  try {
    const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(pos), triVerts: new Uint32Array(tris) });
    mesh.merge();
    const man = new Manifold(mesh);
    if (man.status() !== 'NoError' || man.isEmpty()) {
      man.delete();
      return { man: null, ok: false };
    }
    return { man, ok: true };
  } catch (e) {
    return { man: null, ok: false };
  }
}

// Column-major 4x4 (three.js Matrix4.elements) -> manifold Mat4.
export function transform(m, elements) {
  return m.transform(Array.from(elements));
}

export function unionAll(list) {
  const { Manifold } = W;
  if (!list.length) return null;
  if (list.length === 1) return list[0].translate([0, 0, 0]);
  return Manifold.union(list);
}

export function textMetrics() {
  return { capRatio };
}
