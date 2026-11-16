// Mesh file parsers for files dropped onto the window or opened as OBJ/3MF.
// (STL files opened from the file browser are decoded by Solemn's meshio.)
// All return a triangle soup Float32Array in millimetres.

export function parseSTL(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(new Uint8Array(buf));
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (!vals.length || vals.length % 9) throw new Error('This does not look like a valid STL file.');
  return new Float32Array(vals);
}

export function parseOBJ(text) {
  const v = [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('v ')) {
      const p = t.split(/\s+/);
      v.push([+p[1], +p[2], +p[3]]);
    } else if (t.startsWith('f ')) {
      const idx = t
        .split(/\s+/)
        .slice(1)
        .map((s) => {
          const i = parseInt(s.split('/')[0], 10);
          return i < 0 ? v.length + i : i - 1;
        });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const j of [idx[0], idx[k], idx[k + 1]]) {
          const p = v[j];
          if (!p) throw new Error('This OBJ file is damaged (a face uses a missing corner).');
          out.push(p[0], p[1], p[2]);
        }
      }
    }
  }
  if (!out.length) throw new Error('This OBJ file has no faces.');
  return new Float32Array(out);
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This system cannot unpack 3MF files. Export STL from your other app instead.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // find the end-of-central-directory record
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This 3MF file is damaged.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, local };
    p += 46 + nlen + xlen + clen;
  }
  const out = {};
  for (const [name, f] of Object.entries(files)) {
    if (!wanted(name)) continue;
    const ln = dv.getUint16(f.local + 26, true);
    const lx = dv.getUint16(f.local + 28, true);
    const start = f.local + 30 + ln + lx;
    const data = u8.subarray(start, start + f.csize);
    out[name] = f.method === 0 ? data : await inflateRaw(data);
  }
  return out;
}

function mat3mf(s) {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 ? v : null;
}

function applyM(m, x, y, z) {
  if (!m) return [x, y, z];
  return [m[0] * x + m[3] * y + m[6] * z + m[9], m[1] * x + m[4] * y + m[7] * z + m[10], m[2] * x + m[5] * y + m[8] * z + m[11]];
}

function mulM(a, b) {
  // 3MF matrices are row vectors: p' = p * M ; combined = b then a
  if (!a) return b;
  if (!b) return a;
  const A = [a[0], a[1], a[2], 0, a[3], a[4], a[5], 0, a[6], a[7], a[8], 0, a[9], a[10], a[11], 1];
  const B = [b[0], b[1], b[2], 0, b[3], b[4], b[5], 0, b[6], b[7], b[8], 0, b[9], b[10], b[11], 1];
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[r * 4 + c] += B[r * 4 + k] * A[k * 4 + c];
  return [C[0], C[1], C[2], C[4], C[5], C[6], C[8], C[9], C[10], C[12], C[13], C[14]];
}

export async function parse3MF(buf) {
  const files = await unzip(buf, (n) => /\.model$/i.test(n));
  const names = Object.keys(files);
  if (!names.length) throw new Error('This 3MF file contains no model.');
  const objects = {};
  let unit = 1;
  let build = [];
  for (const n of names) {
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(files[n]), 'application/xml');
    const model = xml.getElementsByTagName('model')[0];
    if (model && /3dmodel\.model$/i.test(n)) {
      const u = (model.getAttribute('unit') || 'millimeter').toLowerCase();
      unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[u] || 1;
      build = [...xml.getElementsByTagName('item')].map((it) => ({ id: n + '#' + it.getAttribute('objectid'), m: mat3mf(it.getAttribute('transform')) }));
    }
    for (const o of xml.getElementsByTagName('object')) {
      const id = n + '#' + o.getAttribute('id');
      const mesh = o.getElementsByTagName('mesh')[0];
      const entry = { tri: null, comps: [] };
      if (mesh) {
        const vs = [...mesh.getElementsByTagName('vertex')].map((v) => [+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z')]);
        const ts = [...mesh.getElementsByTagName('triangle')];
        const out = new Float32Array(ts.length * 9);
        ts.forEach((t, i) => {
          [t.getAttribute('v1'), t.getAttribute('v2'), t.getAttribute('v3')].forEach((k, j) => {
            const p = vs[+k];
            out.set(p, i * 9 + j * 3);
          });
        });
        entry.tri = out;
      }
      for (const c of o.getElementsByTagName('component')) {
        const path = c.getAttribute('p:path') || c.getAttributeNS && c.getAttributeNS('http://schemas.microsoft.com/3dmanufacturing/production/2015/06', 'path');
        const file = path ? path.replace(/^\//, '') : n;
        entry.comps.push({ id: file + '#' + c.getAttribute('objectid'), m: mat3mf(c.getAttribute('transform')) });
      }
      objects[id] = entry;
    }
  }
  const out = [];
  const emit = (id, m, depth) => {
    const o = objects[id];
    if (!o || depth > 16) return;
    if (o.tri) for (let i = 0; i < o.tri.length; i += 3) out.push(...applyM(m, o.tri[i], o.tri[i + 1], o.tri[i + 2]).map((v) => v * unit));
    for (const c of o.comps) emit(c.id, mulM(m, c.m), depth + 1);
  };
  if (!build.length) build = Object.keys(objects).map((id) => ({ id, m: null }));
  for (const b of build) emit(b.id, b.m, 0);
  if (!out.length) throw new Error('This 3MF file has no triangles.');
  return new Float32Array(out);
}

export async function parseFile(name, buf) {
  const n = name.toLowerCase();
  if (n.endsWith('.stl')) return parseSTL(buf);
  if (n.endsWith('.obj')) return parseOBJ(new TextDecoder().decode(new Uint8Array(buf)));
  if (n.endsWith('.3mf')) return parse3MF(buf);
  throw new Error('PrintForge can open STL, OBJ and 3MF files.');
}

export function b64ToBuf(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
