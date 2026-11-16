// Boot: start the geometry kernel, ask Solemn for settings + catalog, then
// build the app. Assets (wasm, font) are embedded by tools/build.mjs.
import Module from 'manifold-3d';
import { initKernel } from './kernel.js';
import { call } from './bridge.js';
import { App } from './app.js';

function b64ToBytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

async function boot() {
  const splash = document.getElementById('splash');
  const msg = document.getElementById('splashMsg');
  try {
    // Files dropped outside the drop zones must never navigate the window away.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    msg.textContent = 'Starting the geometry engine…';
    await initKernel(Module, window.__PF_FONT__, b64ToBytes(window.__PF_WASM__));
    msg.textContent = 'Loading your settings…';
    const init = await call('app.init', {});
    if (!init.ok) throw new Error(init.error || 'Could not talk to PrintForge.');
    const app = new App(init);
    window.printforge = app;
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 400);
    await app.start();
    if (init.selftest) {
      const { runSelfTest } = await import('./selftest.js');
      runSelfTest(app, init);
    }
  } catch (e) {
    console.error(e);
    msg.textContent = 'PrintForge could not start: ' + (e && e.message ? e.message : e);
    splash.classList.add('failed');
    call('test.log', { text: 'BOOT FAIL ' + (e && e.stack ? e.stack : e) }).then(() => call('app.quit', { code: 3 }));
  }
}

window.addEventListener('error', (e) => {
  call('test.log', { text: 'JS ERROR ' + e.message + ' @' + e.filename + ':' + e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  call('test.log', { text: 'JS REJECTION ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason) });
});

boot();
