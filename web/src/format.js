// Display formatting. Input parsing (typed sizes like "1 1/2 in") is done by
// the Solemn `units` module through the bridge; this file only renders.
export const UNIT_FACTOR = { mm: 1, cm: 10, in: 25.4 };

export function fmtNum(x, decimals = 2) {
  if (!isFinite(x)) return '–';
  const p = Math.pow(10, decimals);
  let v = Math.round(x * p) / p;
  if (Object.is(v, -0) || Math.abs(v) < 0.5 / p) v = 0;
  return String(v);
}

export function fmtLen(mm, unit, withUnit = true) {
  const f = UNIT_FACTOR[unit] || 1;
  const d = unit === 'in' ? 3 : unit === 'cm' ? 2 : 2;
  const s = fmtNum(mm / f, d);
  return withUnit ? s + ' ' + unit : s;
}

export function fmtDims(d, unit) {
  return d.map((v) => fmtLen(v, unit, false)).join(' × ') + ' ' + unit;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function basename(p) {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function dirname(p) {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  if (i <= 0) return '/';
  return s.slice(0, i);
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function safeName(s) {
  const t = String(s).replace(/[\/\\:\x00-\x1f\x7f]/g, '-').replace(/^\.+/, '').trim();
  return t.slice(0, 120) || 'Untitled';
}
