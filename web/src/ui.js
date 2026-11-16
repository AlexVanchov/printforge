// Tiny DOM helpers: element builder, toasts, modals, confirm.
import { ui as icons } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function icon(name, cls = 'ico') {
  const s = h('span', { class: cls, html: icons[name] || '' });
  return s;
}

export function btn(label, opts = {}) {
  const b = h('button', { class: 'btn ' + (opts.class || ''), title: opts.title || '', type: 'button', onclick: opts.onclick, disabled: opts.disabled, 'data-testid': opts.testid });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(h('span', { class: 'lbl' }, label));
  return b;
}

let toastRoot = null;
export function toast(msg, kind = 'info', ms = 3800) {
  if (!toastRoot) toastRoot = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, icon(kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : 'info'), h('span', {}, msg));
  toastRoot.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

const stack = [];
export function modal({ title, body, actions = [], wide = false, onClose, closable = true, cls = '' }) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal ' + (wide ? 'wide ' : '') + cls, role: 'dialog', 'aria-modal': 'true' });
  const close = (v) => {
    back.remove();
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    if (onClose) onClose(v);
  };
  const head = h('div', { class: 'modal-head' }, h('h2', {}, title || ''), closable ? h('button', { class: 'icon-btn', title: 'Close', onclick: () => close(null), html: icons.close }) : null);
  const content = h('div', { class: 'modal-body' });
  if (body) content.appendChild(body);
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    const b = btn(a.label, { class: a.primary ? 'primary' : a.danger ? 'danger' : '', icon: a.icon, testid: a.testid });
    b.addEventListener('click', () => {
      const r = a.onclick ? a.onclick() : a.value;
      if (r !== false) close(a.value !== undefined ? a.value : r);
    });
    foot.appendChild(b);
  }
  box.append(head, content);
  if (actions.length) box.appendChild(foot);
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back && closable) close(null);
  });
  root.appendChild(back);
  const api = { close, el: box, body: content, foot, closable };
  stack.push(api);
  setTimeout(() => {
    const f = box.querySelector('[autofocus], input, select, button.primary');
    if (f) f.focus();
  }, 30);
  return api;
}

export function topModal() {
  return stack[stack.length - 1] || null;
}

export function confirmBox(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      actions: [
        { label: 'Cancel', value: false },
        { label: okLabel, value: true, primary: !danger, danger, testid: 'confirm-ok' },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function choiceBox(title, message, choices) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      actions: choices.map((c) => ({ label: c.label, value: c.value, primary: c.primary, danger: c.danger, testid: c.testid })),
      onClose: (v) => resolve(v),
    });
  });
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
