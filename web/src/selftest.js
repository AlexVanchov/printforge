// Native self-test. Started when PRINTFORGE_SELFTEST=1: drives the real app
// inside the real native window (WKWebView on macOS, WebKitGTK on Linux),
// through the real Solemn bridge, writes PASS/FAIL lines to
// $PRINTFORGE_SELFTEST_LOG and quits with exit code 0 (all passed) or 1.
import { call } from './bridge.js';

export async function runSelfTest(app, init) {
  const m = app.model;
  const dir = init.selftest_dir || init.places.projects;
  let failures = 0;
  const log = (t) => call('test.log', { text: t });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    await m.update();
    await wait(60);
    await m.update();
  };
  const dims = async (o) => {
    const b = await m.worldBox(o);
    return [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 1000) / 1000);
  };
  const check = async (name, fn) => {
    const t0 = performance.now();
    try {
      await fn();
      await log(`PASS ${name} (${Math.round(performance.now() - t0)} ms)`);
    } catch (e) {
      failures++;
      await log(`FAIL ${name}: ${e && e.message ? e.message : e}`);
    }
  };
  const assert = (c, msg) => {
    if (!c) throw new Error(msg);
  };

  await log(`START selftest platform=${init.platform} native=${!!window.solemn} ua=${navigator.userAgent}`);
  await check('webgl2 + wasm available', async () => {
    const c = document.createElement('canvas');
    assert(!!c.getContext('webgl2'), 'no WebGL2');
    assert(typeof WebAssembly === 'object', 'no WebAssembly');
  });
  await check('bridge round trip (units.parse)', async () => {
    const r = await call('units.parse', { text: '1 1/2 in', unit: 'mm' });
    assert(r.ok && Math.abs(r.mm - 38.1) < 1e-9, JSON.stringify(r));
  });
  let box;
  await check('add box and set exact sizes', async () => {
    box = await app.addPart('box');
    await settle();
    assert((await dims(box)).join() === '20,20,20', 'default ' + (await dims(box)));
    await m.setWorldSize(box, 0, 50, false);
    await m.setWorldSize(box, 2, 25.4, false);
    await settle();
    assert((await dims(box)).join() === '50,20,25.4', 'sized ' + (await dims(box)));
  });
  await check('hole cuts the box', async () => {
    const cyl = await app.addPart('cylinder', { x: 0, y: 0, params: { diameter: 10, height: 40 } });
    await m.setPosition([cyl], 0, (await m.worldBox(box)).min[0] + 25);
    await m.setPosition([cyl], 1, 0);
    await m.setPosition([box], 1, 0);
    await m.setHole([cyl], true);
    await settle();
    const pr = await m.printable();
    assert(pr.soup.length > 12 * 9, 'cut mesh has more than 12 triangles');
  });
  for (const id of m.catalog.parts.filter((p) => p.cat === 'functional').map((p) => p.id)) {
    await check('functional part ' + id, async () => {
      const o = await app.addPart(id);
      await settle();
      const d = await dims(o);
      assert(d.every((v) => v > 0.5), 'size ' + d);
      await m.remove([o]);
    });
  }
  await check('print check runs in Solemn', async () => {
    await app.runCheck();
    const r = app.report;
    assert(r && typeof r.score === 'number', 'no report: ' + JSON.stringify(r));
    await log(`INFO report score=${r.score} grams=${r.grams} time=${r.time_text} dims=${r.dims.map((x) => x.toFixed(2))}`);
  });
  let exported = '';
  await check('export STL', async () => {
    const res = await app.doExport({ dir, name: 'selftest-export', format: 'stl', only: null });
    assert(res && res.ok, 'export failed ' + JSON.stringify(res));
    exported = res.path;
    document.querySelectorAll('.modal-back').forEach((x) => x.remove());
  });
  await check('import STL back (Solemn decoder)', async () => {
    const n = m.objects.length;
    await app.importPath(exported);
    await settle();
    assert(m.objects.length === n + 1, 'mesh not added');
    const mesh = m.objects[m.objects.length - 1];
    const b = await m.base(mesh);
    assert(b.ok, 'imported mesh is not a closed solid');
  });
  await check('save and reload project', async () => {
    m.path = dir.replace(/\/$/, '') + '/selftest.pforge';
    m.name = 'Self test';
    assert(await app.saveProject(), 'save failed');
    const n = m.objects.length;
    m.clear();
    const r = await call('project.load', { path: dir.replace(/\/$/, '') + '/selftest.pforge' });
    assert(r.ok, r.error);
    await app.loadDoc(r.doc, r.path);
    await settle();
    assert(m.objects.length === n, `objects ${m.objects.length} != ${n}`);
  });
  await check('undo / redo', async () => {
    const n = m.objects.length;
    await app.addPart('sphere');
    m.undo();
    await settle();
    assert(m.objects.length === n, 'undo');
    m.redo();
    await settle();
    assert(m.objects.length === n + 1, 'redo');
  });
  await check('settings persist', async () => {
    m.settings.grid = 0.5;
    const r = await call('settings.save', { settings: m.settings });
    assert(r.ok, r.error);
    const again = await call('app.init', {});
    assert(again.settings.grid === 0.5, 'grid not saved');
  });
  // leave a nice scene on screen for the CI screenshot
  m.clear();
  await app.addPart('storage_box', { params: { div_x: 2 } });
  await app.addPart('gear', { x: -90, y: 0 });
  await app.addPart('name_tag', { x: 0, y: -75 });
  await settle();
  app.viewport.frameAll(60);
  await app.runCheck();
  document.getElementById('checkPanel').classList.add('open');
  await wait(4000);
  await log(failures ? `DONE FAILED ${failures}` : 'DONE OK');
  await call('app.quit', { code: failures ? 1 : 0 });
}
