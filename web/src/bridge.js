// The page <-> Solemn bridge. In the desktop app window.solemn.call is
// injected by the native webview glue; in the browser (`printforge --serve`)
// the same calls go over HTTP to the same Solemn handler.
let pending = 0;
const listeners = new Set();

export function onBusy(fn) {
  listeners.add(fn);
}

function setBusy(delta) {
  pending += delta;
  for (const fn of listeners) fn(pending > 0);
}

export function native() {
  return !!(window.solemn && window.solemn.call);
}

export async function call(name, args = {}) {
  const body = JSON.stringify(args);
  setBusy(1);
  try {
    let text;
    if (native()) {
      text = await window.solemn.call(name, body);
    } else {
      const r = await fetch('/call?name=' + encodeURIComponent(name), { method: 'POST', body });
      if (r.status === 413) return { ok: false, error: 'This model is too large for browser mode. Use the desktop app.' };
      text = await r.text();
    }
    const res = typeof text === 'string' ? JSON.parse(text) : text;
    return res || { ok: false, error: 'No answer from PrintForge.' };
  } catch (e) {
    return { ok: false, error: 'Internal error: ' + (e && e.message ? e.message : e) };
  } finally {
    setBusy(-1);
  }
}
