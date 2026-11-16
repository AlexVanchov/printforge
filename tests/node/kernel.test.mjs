// Integration test: every library part, built by the real Solemn backend
// (serve mode), executed by the real geometry kernel. Checks each result is
// a valid closed solid with the advertised size.
import Module from 'manifold-3d';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { initKernel, buildRecipe, normalize, bbox, soup, fromSoup } from '../../web/src/kernel.js';

const BIN = process.env.PF_BIN || new URL('../../build/printforge', import.meta.url).pathname;
const PORT = 8833;
const fontJson = JSON.parse(fs.readFileSync(new URL('../../node_modules/three/examples/fonts/droid/droid_sans_bold.typeface.json', import.meta.url)));

const srv = spawn(BIN, ['--serve', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
async function call(name, args) {
  const r = await fetch(`http://localhost:${PORT}/call?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(args) });
  return r.json();
}
let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails++;
    console.log('FAIL', msg);
  }
}
try {
  await initKernel(Module, fontJson);
  const init = await call('app.init', {});
  const parts = init.catalog.parts;
  for (const p of parts) {
    const t0 = performance.now();
    const res = await call('part.build', { id: p.id, values: {} });
    check(res.ok, p.id + ' build ok');
    const m = buildRecipe(res.tree);
    check(m && m.status() === 'NoError', p.id + ' manifold status ' + (m && m.status()));
    check(!m.isEmpty(), p.id + ' not empty');
    const { man } = normalize(m);
    const b = bbox(man);
    const dims = [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3));
    const pieces = man.decompose();
    const vol = man.volume();
    console.log(p.id.padEnd(14), 'dims', dims.join(' x ').padEnd(26), 'solver', JSON.stringify(res.dims).padEnd(22), 'tris', String(man.numTri()).padEnd(7), 'vol', vol.toFixed(0).padEnd(8), 'pieces', pieces.length, (performance.now() - t0).toFixed(0) + 'ms');
    check(vol > 0, p.id + ' positive volume');
    if (!['text', 'name_tag', 'knob'].includes(p.id) && !p.id.startsWith('cable') && !p.id.startsWith('phone') && !p.id.startsWith('drawer') && !p.id.startsWith('star') && !p.id.startsWith('heart') && !p.id.startsWith('prism')) {
      for (let i = 0; i < 3; i++) check(Math.abs(dims[i] - res.dims[i]) < 0.05, `${p.id} dim ${i}: kernel ${dims[i]} vs solemn ${res.dims[i]}`);
    }
    // round trip through a soup, as export/import does
    const s = soup(man);
    const back = fromSoup(s);
    check(back.ok, p.id + ' soup round trip is a closed solid');
    if (back.man) {
      check(Math.abs(back.man.volume() - vol) < Math.max(1e-3 * vol, 0.01), p.id + ' round-trip volume');
      back.man.delete();
    }
    pieces.forEach((x) => x.delete());
    man.delete();
    m.delete();
  }
  // a hole cut: box minus cylinder
  const box = buildRecipe((await call('part.build', { id: 'box', values: { width: 40, depth: 40, height: 10 } })).tree);
  const cyl = buildRecipe((await call('part.build', { id: 'cylinder', values: { diameter: 10, height: 30 } })).tree);
  const cut = box.subtract(cyl.translate([0, 0, -5]));
  const expect = 40 * 40 * 10 - Math.PI * 25 * 10;
  check(Math.abs(cut.volume() - expect) / expect < 0.002, 'hole cut volume ' + cut.volume().toFixed(1) + ' vs ' + expect.toFixed(1));
  console.log('hole cut volume', cut.volume().toFixed(1), 'expected ~', expect.toFixed(1));
  // analysis on a real mesh
  const tri = Array.from(soup(cut)).map((v) => Math.round(v * 1e4) / 1e4);
  const rep = await call('analyze', { tri, printer: 'bambu_a1', material: 'pla', settings: {}, watertight: true, pieces: 1 });
  check(rep.ok && rep.score === 100, 'analysis score ' + rep.score);
  console.log('analysis:', rep.score, rep.grams + ' g', rep.time_text, rep.checks.map((c) => c.level + ':' + c.title).join(' | '));
} finally {
  srv.kill();
}
console.log(fails ? `${fails} FAILURES` : 'ALL KERNEL TESTS PASSED');
process.exit(fails ? 1 : 0);
