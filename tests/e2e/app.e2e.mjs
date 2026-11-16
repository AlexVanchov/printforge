// End-to-end tests: the real PrintForge binary (serve mode, real Solemn
// backend, real file system in a temporary HOME) driven through the real UI
// in a real browser engine.
//
//   node tests/e2e/app.e2e.mjs [chromium|webkit] [screenshot-dir]
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const which = process.argv[2] || 'chromium';
const shots = process.argv[3] || '';
const BIN = process.env.PF_BIN || path.resolve('build/printforge');
const PORT = 9100 + Math.floor(Math.random() * 800);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-' + which + '-'));
fs.mkdirSync(path.join(HOME, 'Documents'), { recursive: true });
fs.mkdirSync(path.join(HOME, 'Downloads'), { recursive: true });
const PROJ = path.join(HOME, 'Documents', 'PrintForge');

const srv = spawn(BIN, ['--serve', String(PORT)], { env: { ...process.env, HOME }, stdio: 'ignore' });
process.on('exit', () => srv.kill());
await new Promise((r) => setTimeout(r, 500));

const browser = await (which === 'webkit' ? webkit : chromium).launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let passed = 0;
let failed = 0;
const t0 = Date.now();
async function test(name, fn) {
  const s = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - s} ms)`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n')[0]}`);
    if (shots) await page.screenshot({ path: path.join(shots, `${which}-FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
    for (let i = 0; i < 3 && (await page.$('.modal-back')); i++) await page.keyboard.press('Escape');
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: expected ${b} ± ${tol}, got ${a}`);
}
function ok(c, msg) {
  if (!c) throw new Error(msg);
}
async function settle() {
  await page.waitForFunction(() => window.printforge && !window.printforge.model.updating && !document.body.classList.contains('busy'), null, { timeout: 20000 });
  await page.waitForTimeout(80);
  await page.waitForFunction(() => !window.printforge.model.updating && !document.body.classList.contains('busy'), null, { timeout: 20000 });
}
const state = () =>
  page.evaluate(async () => {
    const m = window.printforge.model;
    const objs = [];
    for (const o of m.objects) {
      const b = await m.worldBox(o);
      objs.push({ id: o.id, kind: o.kind, hole: o.hole, name: o.name, params: o.params, dims: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3)), min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) });
    }
    return { objs, sel: m.selection.slice(), units: m.settings.units, dirty: m.dirty, undo: m.undoStack.length };
  });
async function typeInto(testid, text) {
  const el = page.locator(`[data-testid="${testid}"]`).first();
  await el.click();
  await el.fill(text);
  await el.press('Enter');
  await settle();
}
const val = (testid) => page.locator(`[data-testid="${testid}"]`).first().inputValue();
async function report() {
  await page.waitForFunction(() => window.printforge.report && !window.printforge.report.empty, null, { timeout: 15000 });
  return page.evaluate(() => window.printforge.report);
}
async function freshReport() {
  await page.evaluate(() => {
    window.printforge.report = null;
  });
  await page.evaluate(() => window.printforge.runCheck());
  return report();
}
function readStlBBox(file) {
  const t = fs.readFileSync(file, 'utf8');
  ok(t.startsWith('solid '), 'STL header');
  const re = /vertex ([-0-9.e]+) ([-0-9.e]+) ([-0-9.e]+)/g;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  let m;
  let n = 0;
  while ((m = re.exec(t))) {
    n++;
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], +m[k + 1]);
      mx[k] = Math.max(mx[k], +m[k + 1]);
    }
  }
  return { tris: n / 3, dims: mx.map((v, i) => v - mn[i]), min: mn };
}

console.log(`PrintForge E2E — ${which} — HOME=${HOME}`);

await test('boots without errors and shows the welcome dialog', async () => {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
  await page.waitForSelector('[data-testid=welcome-start]');
  eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
});

await test('welcome: choose printer, then the tour runs to the end', async () => {
  await page.selectOption('[data-testid=printer-select]', 'prusa_mk4s');
  await page.click('[data-testid=welcome-start]');
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector('.tour .btn.primary');
    await page.click('.tour .btn.primary');
    await page.waitForTimeout(120);
  }
  ok(!(await page.$('.tour')), 'tour closed');
  ok((await page.textContent('[data-testid=printer-chip]')).includes('MK4S'), 'printer chip shows MK4S');
  const settings = JSON.parse(fs.readFileSync(path.join(HOME, '.config/printforge/settings.json'), 'utf8'));
  eq(settings.printer, 'prusa_mk4s', 'saved printer');
  eq(settings.welcomed, true, 'welcomed flag saved');
});

await test('add a box from the library', async () => {
  await page.click('[data-testid=add-box]');
  await settle();
  const s = await state();
  eq(s.objs.length, 1, 'object count');
  eq(s.objs[0].dims.join(','), '20,20,20', 'default box size');
  eq(s.objs[0].min[2], 0, 'rests on bed');
  eq(await val('size-0'), '20', 'width field');
});

await test('type an exact width (50)', async () => {
  await page.click('[data-testid=size-lock]'); // unlock proportions
  await typeInto('size-0', '50');
  const s = await state();
  eq(s.objs[0].dims.join(','), '50,20,20', 'dims after width');
  eq(s.objs[0].params.width, 50, 'box width parameter changed (no distortion)');
});

await test('type sizes with units: "1in" and "2.5 cm"', async () => {
  await typeInto('size-2', '1in');
  await typeInto('size-1', '2.5 cm');
  const s = await state();
  eq(s.objs[0].dims.join(','), '50,25,25.4', 'dims');
});

await test('fractional inches: "1 1/2 in"', async () => {
  await typeInto('size-1', '1 1/2 in');
  const s = await state();
  near(s.objs[0].dims[1], 38.1, 0.001, 'depth');
  await typeInto('size-1', '25');
});

await test('bad input is rejected politely', async () => {
  await page.locator('[data-testid=size-0]').fill('abc');
  await page.locator('[data-testid=size-0]').press('Enter');
  await page.waitForSelector('.toast.warn');
  eq(await val('size-0'), '50', 'value restored');
});

await test('locked proportions scale everything together (200%)', async () => {
  await page.click('[data-testid=size-lock]'); // lock again
  await typeInto('scale-pct', '200');
  const s = await state();
  eq(s.objs[0].dims.join(','), '100,50,50.8', 'dims after 200%');
});

await test('undo and redo', async () => {
  await page.click('[data-testid=btn-undo]');
  await settle();
  eq((await state()).objs[0].dims.join(','), '50,25,25.4', 'after undo');
  await page.click('[data-testid=btn-redo]');
  await settle();
  eq((await state()).objs[0].dims.join(','), '100,50,50.8', 'after redo');
});

await test('click a dimension label in 3D and type a size', async () => {
  const label = page.locator('.vlabel.editable').first();
  await label.click();
  await page.fill('[data-testid=inline-size]', '80');
  await page.press('[data-testid=inline-size]', 'Enter');
  await settle();
  eq((await state()).objs[0].dims[0], 80, 'width via 3D label');
  await typeInto('size-0', '100');
});

await test('drag an object on the bed with the mouse (snaps to grid)', async () => {
  const before = (await state()).objs[0];
  const p = await page.evaluate((id) => {
    const v = window.printforge.viewport;
    const it = v.items.get(id);
    const b = new it.mesh.geometry.boundingBox.constructor().copy(it.mesh.geometry.boundingBox).applyMatrix4(it.mesh.matrix);
    const c = b.getCenter(b.min.clone());
    c.z = b.max.z;
    c.project(v.camera);
    const r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, before.id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(p.x + i * 8, p.y + i * 3);
  await page.mouse.up();
  await settle();
  const after = (await state()).objs[0];
  ok(Math.abs(after.min[0] - before.min[0]) > 5, 'moved in X: ' + before.min[0] + ' -> ' + after.min[0]);
  const dx = after.min[0] - before.min[0];
  near(dx, Math.round(dx), 1e-6, 'moved by whole millimetres (grid snap)');
  eq(after.min[2], 0, 'still on the bed');
  eq(after.dims.join(','), before.dims.join(','), 'size unchanged');
  await page.click('[data-testid=btn-undo]');
  await settle();
});

await test('a hole cuts the solid (print check weight drops)', async () => {
  const r1 = await freshReport();
  await page.click('[data-testid=add-cylinder]');
  await settle();
  const cyl = (await state()).objs[1];
  const box = (await state()).objs[0];
  // move the cylinder into the box center and make it a hole
  await typeInto('pos-0', String((box.min[0] + box.max[0]) / 2));
  await typeInto('pos-1', String((box.min[1] + box.max[1]) / 2));
  await page.click('[data-testid=set-hole]');
  await settle();
  ok((await state()).objs[1].hole, 'is a hole');
  const r2 = await freshReport();
  ok(r2.volume_cm3 < r1.volume_cm3 - 5, `volume dropped ${r1.volume_cm3} -> ${r2.volume_cm3}`);
  near(r1.volume_cm3 - r2.volume_cm3, (Math.PI * 100 * 20) / 1000, 0.05, 'cut volume = the 20 mm cylinder');
  ok(cyl.kind === 'cylinder', 'cylinder kind');
});

await test('group (⌘A, Group) and ungroup', async () => {
  await page.click('#viewport canvas');
  await page.keyboard.press('ControlOrMeta+a');
  await page.click('[data-testid=group]');
  await settle();
  let s = await state();
  eq(s.objs.length, 1, 'one group');
  eq(s.objs[0].kind, 'group', 'kind group');
  eq(s.objs[0].dims.join(','), '100,50,50.8', 'group keeps the box size');
  await typeInto('size-0', '50');
  s = await state();
  eq(s.objs[0].dims.join(','), '50,25,25.4', 'group scales uniformly (locked)');
  await page.click('[data-testid=ungroup]');
  await settle();
  s = await state();
  eq(s.objs.length, 2, 'two objects after ungroup');
  ok(s.objs.some((o) => o.hole), 'hole kept');
  const bx = s.objs.find((o) => !o.hole);
  eq(bx.dims.join(','), '50,25,25.4', 'box kept its scaled size');
});

await test('every ready-made part builds in the app', async () => {
  await page.click('[data-testid=tab-functional]');
  const ids = await page.$$eval('#libGrid .tile', (els) => els.map((e) => e.dataset.testid.replace('add-', '')));
  eq(ids.length, 12, 'functional parts in library');
  for (const id of ids) {
    await page.click(`[data-testid=add-${id}]`);
    await settle();
  }
  const s = await state();
  eq(s.objs.length, 14, 'objects on plate');
  for (const o of s.objs) ok(o.dims.every((d) => d > 0.5), o.kind + ' has a size');
  eq(errors.length, 0, 'console errors: ' + errors.join(' | '));
});

await test('change a part parameter (gear teeth 20 -> 30)', async () => {
  const gear = (await state()).objs.find((o) => o.kind === 'gear');
  await page.evaluate((id) => window.printforge.model.select(id), gear.id);
  await settle();
  await typeInto('param-teeth', '30');
  const g2 = (await state()).objs.find((o) => o.kind === 'gear');
  near(g2.dims[0], 64, 0.05, 'outside diameter = module * (teeth + 2)');
  eq(g2.params.teeth, 30, 'teeth param');
});

await test('functional part exact size keeps wall thickness (storage box)', async () => {
  const sb = (await state()).objs.find((o) => o.kind === 'storage_box');
  await page.evaluate((id) => window.printforge.model.select(id), sb.id);
  await settle();
  await typeInto('size-0', '120');
  const sb2 = (await state()).objs.find((o) => o.kind === 'storage_box');
  eq(sb2.dims.join(','), '120,90,60', 'scaled with lock');
  eq(sb2.params.width, 120, 'width param');
  eq(sb2.params.wall, 1.6, 'wall stays 1.6 mm');
});

await test('switch units to inches and back', async () => {
  await page.click('[data-testid=unit-in]');
  await settle();
  eq(await val('size-0'), '4.724', 'width shown in inches');
  await page.click('[data-testid=unit-mm]');
  await settle();
  eq(await val('size-0'), '120', 'width in mm');
});

await test('delete key and duplicate shortcut', async () => {
  const n = (await state()).objs.length;
  await page.click('#viewport canvas', { position: { x: 5, y: 400 } });
  await page.evaluate(() => {
    const m = window.printforge.model;
    m.select(m.objects.filter((o) => o.kind !== 'box' && o.kind !== 'cylinder').map((o) => o.id));
  });
  await page.keyboard.press('Delete');
  await settle();
  eq((await state()).objs.length, 2, 'only box + hole left');
  await page.evaluate(() => {
    const m = window.printforge.model;
    m.select(m.objects.find((o) => o.kind === 'box').id);
  });
  await page.keyboard.press('ControlOrMeta+d');
  await settle();
  eq((await state()).objs.length, 3, 'duplicated');
  await page.keyboard.press('Delete');
  await settle();
  eq((await state()).objs.length, 2, 'deleted duplicate');
  ok(n > 2, 'had many');
});

await test('print check: floating model -> one-click fix', async () => {
  const box = (await state()).objs.find((o) => o.kind === 'box');
  await page.evaluate((id) => window.printforge.model.select(id), box.id);
  await settle();
  await typeInto('pos-2', '12');
  let r = await freshReport();
  ok(r.checks.some((c) => c.id === 'floating' && c.level === 'error'), 'floating error reported');
  await page.click('[data-testid=check-toggle]').catch(() => {});
  if (!(await page.isVisible('[data-testid=fix-drop]'))) await page.click('[data-testid=check-toggle]');
  await page.click('[data-testid=fix-drop]');
  await settle();
  r = await freshReport();
  ok(!r.checks.some((c) => c.id === 'floating'), 'floating fixed');
  eq((await state()).objs.find((o) => o.kind === 'box').min[2], 0, 'on bed');
});

await test('print check: too big -> make it fit', async () => {
  const box = (await state()).objs.find((o) => o.kind === 'box');
  await page.evaluate((id) => window.printforge.model.select(id), box.id);
  await settle();
  await typeInto('size-0', '400');
  let r = await freshReport();
  ok(r.checks.some((c) => c.id === 'size' && c.level === 'error'), 'too big error');
  if (!(await page.isVisible('[data-testid=fix-fit_bed]'))) await page.click('[data-testid=check-toggle]');
  await page.click('[data-testid=fix-fit_bed]');
  await settle();
  r = await freshReport();
  const size = r.checks.find((c) => c.id === 'size');
  eq(size.level, 'ok', 'fits after fix: ' + size.title);
  ok(r.dims[0] <= 240.01 && r.dims[1] <= 200.01, 'within MK4S bed minus margins: ' + r.dims);
  await typeInto('size-0', '50');
});

await test('lay flat picks the side that needs no supports', async () => {
  await page.click('[data-testid=tab-basic]');
  await page.click('[data-testid=add-cone]');
  await settle();
  const cone = (await state()).objs.at(-1);
  await page.click('[data-testid=turn-0]');
  await settle();
  await page.click('[data-testid=turn-0]');
  await settle();
  let c = (await state()).objs.find((o) => o.id === cone.id);
  eq(c.min[2], 0, 'upside-down cone still on bed');
  await page.click('[data-testid=lay-flat]');
  await settle();
  const o = await page.evaluate((id) => window.printforge.model.byId(id).rot, cone.id);
  ok(Math.abs(o[0]) < 1e-6 && Math.abs(o[1]) < 1e-6, 'cone back upright: ' + o);
  await page.keyboard.press('Delete');
  await settle();
});

await test('measure tool shows a distance', async () => {
  await page.click('[data-testid=tool-measure]');
  const pts = await page.evaluate(() => {
    const v = window.printforge.viewport;
    const m = window.printforge.model;
    const box = m.objects.find((o) => o.kind === 'box');
    const it = v.items.get(box.id);
    const b = it.mesh.geometry.boundingBox.clone().applyMatrix4(it.mesh.matrix);
    const r = v.renderer.domElement.getBoundingClientRect();
    const proj = (x, y, z) => {
      const p = b.min.clone().set(x, y, z).project(v.camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    return [proj(b.min.x + 3, b.min.y, (b.min.z + b.max.z) / 2), proj(b.max.x - 3, b.min.y, (b.min.z + b.max.z) / 2)];
  });
  await page.mouse.click(pts[0].x, pts[0].y);
  await page.mouse.click(pts[1].x, pts[1].y);
  await page.waitForSelector('.vlabel.measure:not(.live)');
  const t = await page.textContent('.vlabel.measure');
  ok(/mm/.test(t), 'label: ' + t);
  const d = parseFloat(t);
  ok(d > 30 && d < 50, 'distance about 44 mm: ' + d);
  await page.keyboard.press('Escape');
  await page.click('[data-testid=tool-select]');
});

let exported = '';
await test('export STL to disk', async () => {
  await page.click('[data-testid=btn-export]');
  await page.fill('[data-testid=export-name]', 'e2e-print');
  await page.click('[data-testid=export-go]');
  await page.waitForSelector('[data-testid=export-path]', { timeout: 30000 });
  exported = path.join(PROJ, 'e2e-print.stl');
  ok(fs.existsSync(exported), 'file exists: ' + exported);
  const stl = readStlBBox(exported);
  ok(stl.tris >= 12, 'has triangles: ' + stl.tris);
  const r = await report();
  for (let i = 0; i < 3; i++) near(stl.dims[i], r.dims[i], 0.01, 'STL size matches print check axis ' + i);
  near(stl.min[2], 0, 0.0001, 'STL sits on z=0');
  await page.keyboard.press('Escape');
});

await test('export again asks before replacing the file', async () => {
  await page.click('[data-testid=btn-export]');
  await page.fill('[data-testid=export-name]', 'e2e-print');
  await page.click('[data-testid=export-go]');
  await page.waitForSelector('[data-testid=confirm-ok]');
  await page.click('[data-testid=confirm-ok]');
  await page.waitForSelector('[data-testid=export-path]', { timeout: 30000 });
  await page.keyboard.press('Escape');
});

await test('save project, start new, reopen from recent', async () => {
  await page.fill('[data-testid=doc-name]', 'My E2E Project');
  await page.press('[data-testid=doc-name]', 'Enter');
  await page.click('[data-testid=btn-save]');
  await page.waitForSelector('[data-testid=fb-name]');
  eq(await page.inputValue('[data-testid=fb-name]'), 'My E2E Project', 'suggested name');
  await page.click('[data-testid=fb-ok]');
  await page.waitForSelector('.toast.ok:has-text("Saved to")');
  const file = path.join(PROJ, 'My E2E Project.pforge');
  ok(fs.existsSync(file), 'project saved');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(doc.app, 'PrintForge', 'project app tag');
  eq(doc.objects.length, 2, 'objects in file');
  const before = await state();
  await page.click('[data-testid=btn-new]');
  await settle();
  eq((await state()).objs.length, 0, 'new project is empty');
  await page.click('[data-testid=btn-open]');
  await page.waitForSelector('.fb-place.recent');
  await page.click('.fb-place.recent');
  await settle();
  const after = await state();
  eq(after.objs.length, 2, 'objects restored');
  eq(after.objs.map((o) => o.dims.join(',')).join('|'), before.objs.map((o) => o.dims.join(',')).join('|'), 'same sizes');
  eq(await page.inputValue('[data-testid=doc-name]'), 'My E2E Project', 'name restored');
});

await test('import the exported STL through the file browser (decoded by Solemn)', async () => {
  await page.click('[data-testid=btn-import]');
  await page.click('[data-testid=place-printforge]');
  await page.waitForSelector('.fb-item[data-name="e2e-print.stl"]');
  await page.dblclick('.fb-item[data-name="e2e-print.stl"]');
  await settle();
  const s = await state();
  const mesh = s.objs.find((o) => o.kind === 'mesh');
  ok(mesh, 'mesh object added');
  const stl = readStlBBox(exported);
  for (let i = 0; i < 3; i++) near(mesh.dims[i], stl.dims[i], 0.01, 'imported size axis ' + i);
  const b = await page.evaluate(async (id) => (await window.printforge.model.base(window.printforge.model.byId(id))).ok, mesh.id);
  ok(b, 'imported mesh is a closed solid');
});

await test('import a binary STL in inches -> unit conversion offer', async () => {
  // a 1 x 1 x 1 cube (inches) written as binary STL
  const tris = [
    [0, 0, 0, 0, 1, 0, 1, 1, 0], [0, 0, 0, 1, 1, 0, 1, 0, 0], [0, 0, 1, 1, 0, 1, 1, 1, 1], [0, 0, 1, 1, 1, 1, 0, 1, 1],
    [0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 1, 0, 1, 0, 0, 1], [0, 1, 0, 0, 1, 1, 1, 1, 1], [0, 1, 0, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 0, 1, 1], [0, 0, 0, 0, 1, 1, 0, 1, 0], [1, 0, 0, 1, 1, 0, 1, 1, 1], [1, 0, 0, 1, 1, 1, 1, 0, 1],
  ];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((v, k) => buf.writeFloatLE(v, 84 + i * 50 + 12 + k * 4)));
  fs.writeFileSync(path.join(HOME, 'Downloads', 'inch-cube.stl'), buf);
  await page.click('[data-testid=btn-import]');
  await page.click('[data-testid=place-downloads]');
  await page.waitForSelector('.fb-item[data-name="inch-cube.stl"]');
  await page.dblclick('.fb-item[data-name="inch-cube.stl"]');
  await page.waitForSelector('[data-testid=convert-units]');
  await page.click('[data-testid=convert-units]');
  await settle();
  const cube = (await state()).objs.at(-1);
  eq(cube.dims.join(','), '25.4,25.4,25.4', 'converted to mm');
});

await test('text and name tag render real letters', async () => {
  await page.click('[data-testid=add-text]');
  await settle();
  const t1 = (await state()).objs.at(-1);
  await typeInto('param-text', 'PrintForge Rocks');
  const t2 = (await state()).objs.at(-1);
  ok(t2.dims[0] > t1.dims[0] * 2, `longer text is wider (${t1.dims[0]} -> ${t2.dims[0]})`);
  near(t2.dims[2], 3, 0.001, 'thickness');
});

await test('autosave restores work after the window is closed', async () => {
  await page.waitForTimeout(3200);
  const n = (await state()).objs.length;
  await page.reload();
  await page.waitForSelector('#splash', { state: 'detached', timeout: 30000 });
  await page.waitForSelector('[data-testid=confirm-ok]');
  await page.click('[data-testid=confirm-ok]');
  await settle();
  eq((await state()).objs.length, n, 'restored object count');
});

await test('no console errors during the whole session', async () => {
  eq(errors.length, 0, errors.join(' | '));
});

if (shots) await page.screenshot({ path: path.join(shots, `${which}-final.png`) });
await browser.close();
srv.kill();
console.log(`\n${which}: ${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
