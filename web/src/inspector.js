// The right-hand panel: everything about the selection, editable with exact
// numbers. Lengths accept "25", "2.5 cm", "1 1/2 in", "1in + 5mm" (parsed by
// the Solemn units module).
import { h, icon, btn, toast } from './ui.js';
import { parts as partIcons } from './icons.js';
import { fmtLen, fmtNum, UNIT_FACTOR } from './format.js';
import { PALETTE } from './model.js';
import { call } from './bridge.js';

const AXES = ['X', 'Y', 'Z'];
const SIZE_NAMES = ['Width', 'Depth', 'Height'];

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.model = app.model;
    this.token = 0;
    this.lock = true;
    this.pendingRender = false;
    this.root.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.pendingRender && !this.root.contains(document.activeElement)) this.render();
      }, 0);
    });
    this.model.addEventListener('selection', () => this.render(true));
    this.model.addEventListener('geometry', () => this.render());
  }

  busy() {
    const a = document.activeElement;
    return (a && this.root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) || this.sliding;
  }

  async render(force = false) {
    if (!force && this.busy()) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    const token = ++this.token;
    const objs = this.model.selected();
    let content;
    if (objs.length === 0) content = await this.renderPlate();
    else if (objs.length === 1) content = await this.renderOne(objs[0]);
    else content = await this.renderMany(objs);
    if (token !== this.token) return;
    const scroll = this.root.scrollTop;
    this.root.replaceChildren(content);
    this.root.scrollTop = scroll;
  }

  unit() {
    return this.model.settings.units;
  }

  // A length field. Commits through Solemn's parser; arrows nudge.
  lenField(mm, onCommit, { testid, min = -Infinity, step } = {}) {
    const unit = this.unit();
    const input = h('input', { class: 'num', type: 'text', inputmode: 'decimal', value: fmtLen(mm, unit, false), 'data-testid': testid, spellcheck: 'false', autocomplete: 'off' });
    let original = input.value;
    let busy = false;
    const commit = async () => {
      const text = input.value.trim();
      if (busy || text === original) return;
      busy = true;
      const prev = original;
      original = text;
      try {
        await commitLen(text, prev);
      } finally {
        busy = false;
      }
    };
    const commitLen = async (text, prev) => {
      const r = await call('units.parse', { text, unit });
      if (!r.ok) {
        toast(r.error, 'warn');
        input.value = prev;
        original = prev;
        input.classList.add('bad');
        setTimeout(() => input.classList.remove('bad'), 900);
        return;
      }
      if (r.mm < min) {
        toast('Please enter a value of at least ' + fmtLen(min, unit) + '.', 'warn');
        input.value = prev;
        original = prev;
        return;
      }
      input.blur();
      await onCommit(r.mm);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        input.value = original;
        input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const st = (step || (unit === 'in' ? 0.0625 * 25.4 : 1)) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        const cur = parseFloat(input.value.replace(',', '.'));
        if (isFinite(cur)) {
          const next = cur * (UNIT_FACTOR[unit] || 1) + (e.key === 'ArrowUp' ? st : -st);
          if (next >= min) {
            input.value = fmtLen(next, unit, false);
            commit();
          }
        }
      }
    });
    input.addEventListener('blur', () => commit());
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    return input;
  }

  numField(value, onCommit, { testid, min = -Infinity, max = Infinity, step = 1, decimals = 2 } = {}) {
    const input = h('input', { class: 'num', type: 'text', inputmode: 'decimal', value: fmtNum(value, decimals), 'data-testid': testid, spellcheck: 'false' });
    let original = input.value;
    const commit = async () => {
      const text = input.value.trim();
      if (text === original) return;
      const v = parseFloat(text.replace(',', '.'));
      if (!isFinite(v)) {
        toast('Please type a number.', 'warn');
        input.value = original;
        return;
      }
      original = text;
      input.blur();
      await onCommit(Math.min(max, Math.max(min, v)));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        input.value = original;
        input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const v = parseFloat(input.value) || 0;
        input.value = fmtNum(Math.min(max, Math.max(min, v + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1))), decimals);
        commit();
      }
    });
    input.addEventListener('blur', () => commit());
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    return input;
  }

  section(title, ...children) {
    return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
  }

  row(label, ...children) {
    return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'ctl' }, ...children));
  }

  // ---- nothing selected: the plate ----------------------------------------------
  async renderPlate() {
    const m = this.model;
    const pr = m.printer();
    const mat = m.catalog.materials.find((x) => x.id === m.settings.material) || { name: 'PLA', note: '' };
    const wrap = h('div', { class: 'insp' });
    wrap.appendChild(h('div', { class: 'insp-head' }, icon('printer', 'big-ico'), h('div', {}, h('div', { class: 'title' }, 'Your print plate'), h('div', { class: 'sub' }, m.objects.length ? m.objects.length + (m.objects.length === 1 ? ' object' : ' objects') : 'Empty'))));
    wrap.appendChild(
      this.section(
        'Printer & material',
        h('div', { class: 'kv' }, h('span', {}, 'Printer'), h('b', {}, pr.brand + ' ' + pr.name)),
        h('div', { class: 'kv' }, h('span', {}, 'Bed size'), h('b', {}, fmtLen(pr.bx, this.unit(), false) + ' × ' + fmtLen(pr.by, this.unit(), false) + ' × ' + fmtLen(pr.bz, this.unit()))),
        h('div', { class: 'kv' }, h('span', {}, 'Material'), h('b', {}, mat.name)),
        mat.note ? h('p', { class: 'note' }, mat.note) : null,
        btn('Change printer or material', { icon: 'settings', class: 'wide', onclick: () => this.app.openSettings() })
      )
    );
    if (m.objects.length) {
      const boxes = await Promise.all(m.objects.map((o) => m.worldBox(o)));
      const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
      const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
      const dims = hi.map((v, i) => v - lo[i]);
      wrap.appendChild(
        this.section(
          'Whole model size',
          h('p', { class: 'note' }, 'Type an exact size to scale everything on the plate together.'),
          ...[0, 1, 2].map((a) =>
            this.row(
              SIZE_NAMES[a],
              this.lenField(dims[a], async (mm) => {
                await m.scaleAll(a, mm);
                toast('Scaled the whole model.', 'ok');
              }, { testid: 'plate-size-' + a, min: 0.1 }),
              h('span', { class: 'unit' }, this.unit())
            )
          ),
          h('div', { class: 'btns' }, btn('Fit to bed', { icon: 'fit', onclick: () => this.app.fixAction('fit_bed') }), btn('Center on bed', { icon: 'center', onclick: () => this.app.fixAction('center') }))
        )
      );
    }
    wrap.appendChild(
      this.section(
        'Quick tips',
        h(
          'ul',
          { class: 'tips' },
          h('li', {}, h('b', {}, 'Add shapes'), ' from the left. Click one, or drag it onto the plate.'),
          h('li', {}, h('b', {}, 'Holes'), ' cut away from anything they touch: make a shape a hole to drill, slot or hollow.'),
          h('li', {}, h('b', {}, 'Exact sizes:'), ' click a size label in the 3D view or type in the panel. "1 1/2 in" works too.'),
          h('li', {}, h('b', {}, 'Print check'), ' (bottom right) tells you if it will print and fixes problems in one click.')
        )
      )
    );
    return wrap;
  }

  // ---- one object -------------------------------------------------------------------
  async renderOne(o) {
    const m = this.model;
    const unit = this.unit();
    const part = m.part(o.kind);
    const base = await m.base(o);
    const box = await m.worldBox(o);
    const dims = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
    const wrap = h('div', { class: 'insp' });
    const pic = h('span', { class: 'pic-wrap', html: partIcons[o.kind] || (o.kind === 'group' ? partIcons.group : partIcons.mesh) });
    const name = h('input', { class: 'name-input', value: o.name, 'data-testid': 'obj-name', spellcheck: 'false' });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    name.addEventListener('change', () => m.rename(o, name.value.trim() || o.name));
    const kindLabel = o.kind === 'group' ? 'Group' : o.kind === 'mesh' ? 'Imported model' : part ? part.name + (part.cat === 'functional' ? ' · ready-made part' : '') : o.kind;
    wrap.appendChild(h('div', { class: 'insp-head' }, pic, h('div', { class: 'grow' }, name, h('div', { class: 'sub' }, kindLabel))));

    // solid / hole
    const seg = h(
      'div',
      { class: 'seg big', role: 'group' },
      h('button', { class: !o.hole ? 'on' : '', 'data-testid': 'set-solid', onclick: () => o.hole && m.setHole([o], false) }, icon('solid'), 'Solid'),
      h('button', { class: o.hole ? 'on' : '', 'data-testid': 'set-hole', onclick: () => !o.hole && m.setHole([o], true) }, icon('hole'), 'Hole')
    );
    wrap.appendChild(h('div', { class: 'solid-hole' }, seg, h('p', { class: 'note' }, o.hole ? 'This hole cuts away from every solid it touches.' : 'Make it a hole to cut it out of other shapes.')));

    // size
    const lockBtn = h('button', { class: 'icon-btn lock ' + (this.lock ? 'on' : ''), title: this.lock ? 'Proportions locked: all sizes change together' : 'Proportions unlocked: sizes change independently', 'data-testid': 'size-lock', html: '' });
    lockBtn.appendChild(icon(this.lock ? 'lock' : 'unlock'));
    lockBtn.addEventListener('click', () => {
      this.lock = !this.lock;
      this.render(true);
    });
    const sizeRows = [0, 1, 2].map((a) =>
      this.row(
        SIZE_NAMES[a] + ' (' + AXES[a] + ')',
        this.lenField(dims[a], async (mm) => {
          const ok = await m.setWorldSize(o, a, mm, this.lock);
          if (!ok) toast('Could not reach that size exactly.', 'warn');
        }, { testid: 'size-' + a, min: 0.05 }),
        h('span', { class: 'unit' }, unit)
      )
    );
    const pct = this.numField(100, async (v) => {
      if (v > 0) await m.scaleBy(o, v / 100);
    }, { testid: 'scale-pct', min: 1, max: 10000, decimals: 1 });
    wrap.appendChild(this.section(h('span', { class: 'sec-title' }, 'Size', lockBtn), ...sizeRows, this.row('Scale by', pct, h('span', { class: 'unit' }, '%'))));

    // position
    const posVals = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
    const posRows = [0, 1, 2].map((a) => this.row(a === 2 ? 'Lift (Z)' : AXES[a] + ' center', this.lenField(posVals[a], (mm) => m.setPosition([o], a, mm), { testid: 'pos-' + a }), h('span', { class: 'unit' }, unit)));
    wrap.appendChild(this.section('Position', ...posRows, h('div', { class: 'btns' }, btn('Drop to bed', { icon: 'drop', onclick: () => m.drop([o]), testid: 'drop' }), btn('Center', { icon: 'center', onclick: () => m.center([o]) }))));

    // rotation
    const rotRows = [0, 1, 2].map((a) => this.row('Turn ' + AXES[a], this.numField(o.rot[a], (v) => m.setRotation(o, o.rot.map((r, i) => (i === a ? v : r))), { testid: 'rot-' + a, step: 15, decimals: 2 }), h('span', { class: 'unit' }, '°')));
    const quick = h('div', { class: 'btns three' }, ...[0, 1, 2].map((a) => btn(AXES[a] + ' 90°', { icon: 'rotate', title: 'Turn 90° around ' + AXES[a], onclick: () => m.rotateWorld([o], a, 90), testid: 'turn-' + a })));
    wrap.appendChild(this.section('Rotation', ...rotRows, quick, btn('Lay flat (best side down)', { icon: 'wand', class: 'wide', onclick: () => this.app.autoOrient([o]), testid: 'lay-flat' })));

    // parameters
    if (part && part.params.length) {
      const ps = h('div', { class: 'params' });
      for (const p of part.params) ps.appendChild(this.paramEditor(o, p));
      const msgs = [];
      for (const w of base.warnings || []) msgs.push(h('div', { class: 'msg warn' }, icon('warn'), h('span', {}, w)));
      for (const w of base.info || []) msgs.push(h('div', { class: 'msg info' }, icon('info'), h('span', {}, w)));
      if (part.tip) msgs.push(h('div', { class: 'msg tip' }, icon('sparkle'), h('span', {}, part.tip)));
      wrap.appendChild(this.section(part.cat === 'functional' ? 'Part settings' : 'Shape settings', ps, ...msgs));
    } else if (base.warnings && base.warnings.length) {
      wrap.appendChild(this.section('Notes', ...base.warnings.map((w) => h('div', { class: 'msg warn' }, icon('warn'), h('span', {}, w)))));
    }

    // color
    if (!o.hole) wrap.appendChild(this.section('Color', this.colorPicker([o])));

    // actions
    const acts = h(
      'div',
      { class: 'btns' },
      btn('Duplicate', { icon: 'copy', onclick: () => m.duplicate([o]), testid: 'duplicate' }),
      btn('Mirror', { icon: 'mirror', title: 'Mirror left-right (hold Shift for front-back)', onclick: (e) => m.mirror([o], e.shiftKey ? 1 : 0) }),
      o.kind === 'group' ? btn('Ungroup', { icon: 'ungroup', onclick: () => m.ungroup(o), testid: 'ungroup' }) : null,
      btn('Delete', { icon: 'trash', class: 'danger-ghost', onclick: () => m.remove([o]), testid: 'delete' })
    );
    wrap.appendChild(this.section('', acts));
    return wrap;
  }

  paramEditor(o, p) {
    const m = this.model;
    const unit = this.unit();
    const val = o.params[p.key] !== undefined ? o.params[p.key] : p.default;
    const label = h('label', { title: p.help }, p.label, p.help ? h('span', { class: 'help', title: p.help }, '?') : null);
    let ctl;
    const set = (v) => m.setParams(o, { [p.key]: v });
    if (p.kind === 'bool') {
      ctl = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!val, 'data-testid': 'param-' + p.key, onchange: (e) => set(e.target.checked) }), h('span', { class: 'slider' }));
    } else if (p.kind === 'choice') {
      ctl = h('select', { 'data-testid': 'param-' + p.key, onchange: (e) => set(e.target.value) }, ...p.choices.map((c) => h('option', { value: c, selected: c === val }, c)));
    } else if (p.kind === 'text') {
      ctl = h('input', { type: 'text', value: val, maxlength: '60', 'data-testid': 'param-' + p.key, spellcheck: 'false' });
      ctl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ctl.blur();
      });
      ctl.addEventListener('change', () => set(ctl.value));
    } else {
      const isLen = p.kind === 'mm';
      const field = isLen
        ? this.lenField(val, (mm) => set(Math.min(p.max, Math.max(p.min, mm))), { testid: 'param-' + p.key, step: p.step })
        : this.numField(val, (v) => set(p.kind === 'count' ? Math.round(v) : v), { testid: 'param-' + p.key, min: p.min, max: p.max, step: p.step, decimals: p.kind === 'count' ? 0 : 2 });
      const suffix = isLen ? unit : p.kind === 'deg' ? '°' : p.kind === 'pct' ? '%' : '';
      const range = p.max - p.min;
      let slider = null;
      if (range > 0 && (p.kind !== 'mm' || range <= 400)) {
        slider = h('input', { type: 'range', min: p.min, max: p.kind === 'mm' ? Math.min(p.max, Math.max(p.min + range * 0.25, val * 3)) : p.max, step: p.step || 1, value: val, class: 'range' });
        let started = false;
        let last = 0;
        slider.addEventListener('pointerdown', () => {
          this.sliding = true;
          started = false;
        });
        slider.addEventListener('input', () => {
          const v = parseFloat(slider.value);
          field.value = isLen ? fmtLen(v, unit, false) : fmtNum(v, 2);
          if (!started) {
            m.begin();
            started = true;
          }
          const now = performance.now();
          if (now - last > 50) {
            last = now;
            m.params_live = true;
            o.params = { ...o.params, [p.key]: v };
            m.commit();
          }
        });
        slider.addEventListener('change', async () => {
          const v = parseFloat(slider.value);
          o.params = { ...o.params, [p.key]: v };
          if (!started) m.begin();
          m.commit();
          this.sliding = false;
          await m.update();
          this.render(true);
        });
      }
      ctl = h('div', { class: 'param-num' }, slider, h('div', { class: 'with-unit' }, field, suffix ? h('span', { class: 'unit' }, suffix) : null));
    }
    return h('div', { class: 'param ' + p.kind }, label, ctl);
  }

  colorPicker(objs) {
    const m = this.model;
    const cur = objs[0].color;
    const wrap = h('div', { class: 'swatches' });
    for (const c of PALETTE) {
      wrap.appendChild(h('button', { class: 'swatch' + (c === cur ? ' on' : ''), style: { background: c }, title: c, onclick: () => m.setColor(objs, c) }));
    }
    const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#3b82f6', title: 'Custom color' });
    custom.addEventListener('change', () => m.setColor(objs, custom.value));
    wrap.appendChild(h('label', { class: 'swatch custom', title: 'Custom color' }, custom, '+'));
    return h('div', {}, wrap, h('p', { class: 'note' }, 'Colors help you tell parts apart. STL files carry shape only.'));
  }

  // ---- several objects -------------------------------------------------------------
  async renderMany(objs) {
    const m = this.model;
    const wrap = h('div', { class: 'insp' });
    wrap.appendChild(h('div', { class: 'insp-head' }, h('span', { class: 'pic-wrap', html: partIcons.group }), h('div', {}, h('div', { class: 'title' }, objs.length + ' objects selected'), h('div', { class: 'sub' }, objs.filter((o) => o.hole).length + ' holes, ' + objs.filter((o) => !o.hole).length + ' solids'))));
    wrap.appendChild(
      this.section(
        'Combine',
        h('p', { class: 'note' }, 'Grouping welds the solids together and cuts the holes out of them, making one part you can move and size as a whole.'),
        btn('Group into one part', { icon: 'group', class: 'primary wide', onclick: () => m.group(objs), testid: 'group' })
      )
    );
    const al = (axis, mode, label, ic) => btn(label, { icon: ic, onclick: () => m.align(objs, axis, mode), title: 'Align ' + label });
    wrap.appendChild(
      this.section(
        'Align',
        h('div', { class: 'align-grid' }, h('span', {}, 'Left-right'), al(0, 'min', 'Left', 'align'), al(0, 'mid', 'Center', 'center'), al(0, 'max', 'Right', 'align'), h('span', {}, 'Front-back'), al(1, 'min', 'Front', 'align'), al(1, 'mid', 'Middle', 'center'), al(1, 'max', 'Back', 'align'), h('span', {}, 'Up-down'), al(2, 'min', 'Bottom', 'align'), al(2, 'mid', 'Middle', 'center'), al(2, 'max', 'Top', 'align'))
      )
    );
    wrap.appendChild(
      this.section(
        '',
        h('div', { class: 'seg big' }, h('button', { onclick: () => m.setHole(objs, false) }, icon('solid'), 'All solid'), h('button', { onclick: () => m.setHole(objs, true) }, icon('hole'), 'All holes')),
        h('div', { class: 'btns' }, btn('Duplicate', { icon: 'copy', onclick: () => m.duplicate(objs) }), btn('Drop to bed', { icon: 'drop', onclick: () => m.drop(objs) }), btn('Delete', { icon: 'trash', class: 'danger-ghost', onclick: () => m.remove(objs) }))
      )
    );
    if (objs.some((o) => !o.hole)) wrap.appendChild(this.section('Color', this.colorPicker(objs.filter((o) => !o.hole))));
    return wrap;
  }
}
