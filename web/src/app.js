// Application shell: toolbar, library, print check, dialogs, files,
// keyboard. Owns the Model, Viewport and Inspector.
import { h, icon, btn, toast, modal, confirmBox, choiceBox, isTyping, topModal } from './ui.js';
import { ui as uiIcons, parts as partIcons } from './icons.js';
import { call, native, onBusy } from './bridge.js';
import { Model, newId } from './model.js';
import { Viewport } from './viewport.js';
import { Inspector } from './inspector.js';
import { fmtLen, fmtNum, fmtDims, escapeHtml, basename, dirname, stripExt, safeName } from './format.js';
import { parseFile, b64ToBuf } from './importers.js';
import * as K from './kernel.js';
import * as THREE from 'three';
import { matrixOf, decompose } from './model.js';

const SLICERS = ['Bambu Studio', 'OrcaSlicer', 'PrusaSlicer', 'UltiMaker Cura'];

export class App {
  constructor(init) {
    this.init = init;
    this.model = new Model();
    const m = this.model;
    m.catalog = init.catalog;
    m.settings = { ...m.settings, ...init.settings };
    this.places = init.places;
    this.platform = init.platform;
    this.report = null;
    this.libTab = 'basic';
    this.clipboard = null;

    this.buildChrome();
    this.viewport = new Viewport(document.getElementById('viewport'), m);
    this.inspector = new Inspector(document.getElementById('inspector'), this);
    this.viewport.setEdges(m.settings.edges !== false);

    m.addEventListener('change', () => {
      this.updateChrome();
      this.scheduleCheck();
      this.scheduleAutosave();
    });
    m.addEventListener('geometry', () => this.scheduleCheck());
    m.addEventListener('selection', () => this.updateChrome());
    this.viewport.addEventListener('edit-size', (e) => this.editSizeInline(e.detail));
    this.viewport.addEventListener('drop-part', (e) => this.addPart(e.detail.kind, { x: snap(e.detail.x, m.settings.grid), y: snap(e.detail.y, m.settings.grid) }));
    this.viewport.addEventListener('measured', (e) => this.setStatus('Distance: ' + fmtLen(e.detail.d, m.settings.units) + '. Click again to start a new measurement, Esc to finish.'));
    this.viewport.addEventListener('hover', (e) => {
      if (this.viewport.tool === 'select') this.setStatus(e.detail ? 'Drag to move · Shift-drag to move freely · Double-click to zoom to it' : this.defaultHint());
    });
    this.bindKeys();
    this.bindFileDrop();
    onBusy((b) => document.body.classList.toggle('busy', b));
    this.updateChrome();
    this.renderLibrary();
    this.inspector.render(true);
    this.setStatus(this.defaultHint());
    this.viewport.setView('iso', false);
  }

  async start() {
    const restored = await this.offerRestore();
    if (!restored && !this.model.settings.welcomed && !this.init.selftest) this.welcome();
    this.updateChrome();
  }

  // ---- chrome ----------------------------------------------------------------------
  buildChrome() {
    const tb = document.getElementById('topbar');
    const tool = (name, ic, title, testid) => {
      const b = h('button', { class: 'tool', title, 'data-tool': name, 'data-testid': testid, onclick: () => this.setTool(name) }, icon(ic), h('span', { class: 'lbl' }, title.split(' (')[0]));
      return b;
    };
    tb.replaceChildren(
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: '<svg viewBox="0 0 32 32"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="var(--accent)"/><path d="M16 2 29 9.5 16 17 3 9.5z" fill="#fff" opacity=".35"/><path d="M9 20h14M11 16.5h10M13 13h6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>' }), h('span', { class: 'word' }, 'PrintForge')),
      h('input', { id: 'docName', class: 'docname', value: this.model.name, title: 'Project name', spellcheck: 'false', 'data-testid': 'doc-name' }),
      h('div', { class: 'tb-group' }, this.tbBtn('new', 'New project (⌘N)', () => this.newProject(), 'btn-new'), this.tbBtn('open', 'Open project (⌘O)', () => this.openProject(), 'btn-open'), this.tbBtn('save', 'Save project (⌘S)', () => this.saveProject(), 'btn-save')),
      h('div', { class: 'tb-group' }, this.tbBtn('undo', 'Undo (⌘Z)', () => this.model.undo(), 'btn-undo'), this.tbBtn('redo', 'Redo (⇧⌘Z)', () => this.model.redo(), 'btn-redo')),
      h('div', { class: 'tb-group' }, this.tbBtn('import', 'Import STL / OBJ / 3MF (⌘I)', () => this.importDialog(), 'btn-import', 'Import')),
      h('div', { class: 'tb-group tools' }, tool('select', 'move', 'Move (V)', 'tool-select'), tool('rotate', 'rotate', 'Rotate (R)', 'tool-rotate'), tool('measure', 'measure', 'Measure (M)', 'tool-measure')),
      h('div', { class: 'spacer' }),
      h('button', { id: 'printerChip', class: 'chip', title: 'Printer and material', onclick: () => this.openSettings(), 'data-testid': 'printer-chip' }),
      h('div', { class: 'seg units', id: 'unitsSeg' }, ...['mm', 'in'].map((u) => h('button', { 'data-unit': u, 'data-testid': 'unit-' + u, onclick: () => this.setUnits(u) }, u))),
      this.tbBtn('help', 'Help and shortcuts (?)', () => this.help(), 'btn-help'),
      this.tbBtn('settings', 'Settings', () => this.openSettings(), 'btn-settings'),
      h('button', { class: 'btn primary export', onclick: () => this.exportDialog(), 'data-testid': 'btn-export', title: 'Export for your slicer (⌘E)' }, icon('export'), h('span', { class: 'lbl' }, 'Export STL'))
    );
    const name = document.getElementById('docName');
    name.addEventListener('change', () => {
      const v = name.value.trim() || 'Untitled';
      this.model.name = v;
      this.model.dirty = true;
      this.updateChrome();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });

    // viewport toolbar
    const vb = document.getElementById('viewbar');
    const vbtn = (ic, title, fn, testid) => h('button', { class: 'icon-btn', title, onclick: fn, 'data-testid': testid, html: uiIcons[ic] });
    vb.replaceChildren(
      vbtn('home', 'Home view', () => this.viewport.setView('iso'), 'view-home'),
      vbtn('top', 'Top view', () => this.viewport.setView('top'), 'view-top'),
      vbtn('front', 'Front view', () => this.viewport.setView('front'), 'view-front'),
      vbtn('side', 'Side view', () => this.viewport.setView('right'), 'view-side'),
      vbtn('fit', 'Zoom to fit (F)', () => this.viewport.fit(), 'view-fit'),
      h('span', { class: 'sep' }),
      vbtn('edges', 'Show edges', () => {
        this.model.settings.edges = !this.viewport.showEdges;
        this.viewport.setEdges(this.model.settings.edges);
        this.saveSettings();
      }, 'view-edges')
    );

    // status bar
    const sb = document.getElementById('statusbar');
    const grid = h('select', { id: 'gridSel', title: 'Snap moves to this grid', 'data-testid': 'grid' }, ...[0, 0.1, 0.5, 1, 2, 5, 10].map((g) => h('option', { value: g, selected: g === this.model.settings.grid }, g === 0 ? 'Off' : fmtLen(g, 'mm'))));
    grid.addEventListener('change', () => {
      this.model.settings.grid = parseFloat(grid.value);
      this.viewport.updateGizmo();
      this.saveSettings();
    });
    sb.replaceChildren(h('span', { id: 'status', class: 'status' }), h('span', { class: 'spacer' }), h('label', { class: 'grid-lbl' }, 'Snap ', grid), h('span', { id: 'objCount', class: 'count' }), h('span', { class: 'mode' }, native() ? 'Solemn · native' : 'Solemn · browser'));

    // library tabs
    const lib = document.getElementById('library');
    const search = h('input', { type: 'search', placeholder: 'Search shapes and parts…', class: 'lib-search', 'data-testid': 'lib-search' });
    search.addEventListener('input', () => this.renderLibrary(search.value));
    const tabs = h('div', { class: 'seg lib-tabs' }, h('button', { 'data-tab': 'basic', onclick: () => this.setLibTab('basic'), 'data-testid': 'tab-basic' }, 'Basic shapes'), h('button', { 'data-tab': 'functional', onclick: () => this.setLibTab('functional'), 'data-testid': 'tab-functional' }, 'Ready-made parts'));
    lib.replaceChildren(h('div', { class: 'lib-top' }, search, tabs), h('div', { id: 'libGrid', class: 'lib-grid' }), h('div', { class: 'lib-foot' }, h('p', {}, 'Click to add, or drag onto the plate.'), btn('Import a model file', { icon: 'import', class: 'wide', onclick: () => this.importDialog() })));
    this.searchBox = search;

    // empty-plate hint
    document.getElementById('emptyHint').replaceChildren(h('div', { class: 'eh-card' }, icon('cube', 'eh-ico'), h('h2', {}, 'Let’s make something'), h('p', {}, 'Pick a shape or a ready-made part on the left. Change its size by typing exact numbers, combine shapes, cut holes, then export an STL for your slicer.'), h('div', { class: 'eh-actions' }, btn('Add a box', { icon: 'plus', class: 'primary', onclick: () => this.addPart('box'), testid: 'eh-box' }), btn('Storage box', { onclick: () => this.addPart('storage_box') }), btn('Name tag', { onclick: () => this.addPart('name_tag') }), btn('Import a file', { icon: 'import', onclick: () => this.importDialog() }))));

    // print check panel
    const cp = document.getElementById('checkPanel');
    cp.replaceChildren(
      h('button', { class: 'cp-head', 'data-testid': 'check-toggle', onclick: () => cp.classList.toggle('open') }, h('span', { id: 'cpScore', class: 'score' }, '–'), h('span', { class: 'cp-title' }, h('b', {}, 'Print check'), h('span', { id: 'cpSummary' }, 'Add a shape to begin')), icon('up', 'chev')),
      h('div', { id: 'cpBody', class: 'cp-body' })
    );
  }

  tbBtn(ic, title, fn, testid, label) {
    return h('button', { class: 'icon-btn' + (label ? ' with-label' : ''), title, onclick: fn, 'data-testid': testid }, icon(ic), label ? h('span', { class: 'lbl' }, label) : null);
  }

  updateChrome() {
    const m = this.model;
    const pr = m.printer();
    const mat = m.catalog.materials.find((x) => x.id === m.settings.material);
    const chip = document.getElementById('printerChip');
    chip.replaceChildren(icon('printer'), h('span', {}, pr.brand + ' ' + pr.name + ' · ' + (mat ? mat.name : '')));
    for (const b of document.querySelectorAll('#unitsSeg button')) b.classList.toggle('on', b.dataset.unit === m.settings.units);
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === this.viewport?.tool);
    for (const b of document.querySelectorAll('.lib-tabs button')) b.classList.toggle('on', b.dataset.tab === this.libTab);
    const name = document.getElementById('docName');
    if (document.activeElement !== name) name.value = m.name;
    document.title = (m.dirty ? '• ' : '') + m.name + ' — PrintForge';
    document.querySelector('[data-testid="btn-undo"]').disabled = !m.undoStack.length;
    document.querySelector('[data-testid="btn-redo"]').disabled = !m.redoStack.length;
    document.getElementById('emptyHint').classList.toggle('show', m.objects.length === 0);
    const n = m.objects.length;
    document.getElementById('objCount').textContent = n + (n === 1 ? ' object' : ' objects') + (m.selection.length ? ' · ' + m.selection.length + ' selected' : '');
  }

  setStatus(t) {
    const s = document.getElementById('status');
    if (s) s.textContent = t;
  }

  defaultHint() {
    return 'Left-drag: orbit · Right-drag: pan · Scroll: zoom · Click a shape to select it';
  }

  setTool(t) {
    this.viewport.setTool(t);
    this.updateChrome();
    if (t === 'measure') this.setStatus('Measure: click two points on your model (corners snap). Esc to finish.');
    else if (t === 'rotate') this.setStatus('Rotate: drag a colored ring. Turns snap to 15°. Things on the bed stay on the bed.');
    else this.setStatus(this.defaultHint());
  }

  async setUnits(u) {
    this.model.settings.units = u;
    this.updateChrome();
    this.viewport.updateSelectionBox();
    this.inspector.render(true);
    this.renderCheck();
    this.saveSettings();
  }

  saveSettings() {
    clearTimeout(this.saveSettingsT);
    this.saveSettingsT = setTimeout(() => call('settings.save', { settings: this.model.settings }), 250);
  }

  // ---- library ------------------------------------------------------------------------
  setLibTab(t) {
    this.libTab = t;
    this.searchBox.value = '';
    this.renderLibrary();
    this.updateChrome();
  }

  renderLibrary(q = '') {
    const grid = document.getElementById('libGrid');
    const query = q.trim().toLowerCase();
    const parts = this.model.catalog.parts.filter((p) => (query ? (p.name + ' ' + p.desc).toLowerCase().includes(query) : p.cat === this.libTab));
    grid.replaceChildren(
      ...parts.map((p) => {
        const tile = h('button', { class: 'tile', draggable: 'true', title: p.desc, 'data-testid': 'add-' + p.id, onclick: () => this.addPart(p.id) }, h('span', { class: 'tile-pic', html: partIcons[p.id] || partIcons.box }), h('span', { class: 'tile-name' }, p.name));
        tile.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/x-printforge-part', p.id);
          e.dataTransfer.effectAllowed = 'copy';
        });
        return tile;
      })
    );
    if (!parts.length) grid.appendChild(h('p', { class: 'note pad' }, 'No shapes match “' + q + '”.'));
    document.querySelector('.lib-tabs').style.display = query ? 'none' : '';
  }

  async addPart(kind, opts = {}) {
    const p = this.model.part(kind);
    const o = await this.model.add(kind, opts);
    await this.model.update();
    if (this.model.objects.length === 1) this.viewport.frame(this.viewport.sceneBox(), new THREE.Vector3(0.55, -0.8, 0.62).normalize(), true, 70);
    else this.viewport.ensureVisible([o.id]);
    this.setStatus((p ? p.name : 'Shape') + ' added. Drag it to move, or type exact sizes on the right.');
    return o;
  }

  // ---- inline size editing from the 3D labels ----------------------------------------
  editSizeInline({ axis, el }) {
    const m = this.model;
    const objs = m.selected();
    if (!objs.length) return;
    const unit = m.settings.units;
    const r = el.getBoundingClientRect();
    const host = document.getElementById('stage').getBoundingClientRect();
    const input = h('input', { class: 'inline-size', value: el.textContent.replace(/\s*(mm|in|cm)$/, ''), 'data-testid': 'inline-size' });
    input.style.left = r.left - host.left + r.width / 2 + 'px';
    input.style.top = r.top - host.top + r.height / 2 + 'px';
    document.getElementById('stage').appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (apply) => {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      if (!apply) return;
      const res = await call('units.parse', { text, unit });
      if (!res.ok) return toast(res.error, 'warn');
      if (res.mm <= 0) return toast('Sizes must be bigger than zero.', 'warn');
      if (objs.length === 1) await m.setWorldSize(objs[0], axis, res.mm, this.inspector.lock);
      else {
        // scale a multi-selection together
        const boxes = await Promise.all(objs.map((o) => m.worldBox(o)));
        const lo = Math.min(...boxes.map((b) => b.min[axis]));
        const hi = Math.max(...boxes.map((b) => b.max[axis]));
        const f = res.mm / (hi - lo);
        for (const o of objs) await m.scaleBy(o, f);
      }
      toast('Size set to ' + fmtLen(res.mm, unit) + '.', 'ok', 2000);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---- print check --------------------------------------------------------------------
  scheduleCheck() {
    clearTimeout(this.checkT);
    this.checkT = setTimeout(() => this.runCheck(), 450);
  }

  async runCheck() {
    const m = this.model;
    const version = m.version;
    if (!m.objects.length) {
      this.report = null;
      this.renderCheck();
      return;
    }
    if (m.objects.every((o) => o.hole)) {
      this.report = { empty: true, onlyHoles: true };
      this.renderCheck();
      return;
    }
    const pr = await m.printable();
    if (version !== m.version) return;
    // 0.01 mm is plenty for print-readiness maths and keeps the payload small
    const tri = Array.from(pr.soup, (v) => Math.round(v * 100) / 100);
    if (!native() && tri.length * 7 > 950000) {
      this.report = { tooBig: true };
      this.renderCheck();
      return;
    }
    const res = await call('analyze', { tri, printer: m.settings.printer, material: m.settings.material, settings: { infill: m.settings.infill, layer: m.settings.layer, walls: m.settings.walls }, watertight: pr.watertight, pieces: pr.pieces });
    if (version !== m.version) return;
    this.report = res.ok ? res : { failed: res.error || 'The check could not run.' };
    this.renderCheck();
  }

  renderCheck() {
    const r = this.report;
    const score = document.getElementById('cpScore');
    const sum = document.getElementById('cpSummary');
    const body = document.getElementById('cpBody');
    const panel = document.getElementById('checkPanel');
    const unit = this.model.settings.units;
    panel.classList.remove('good', 'meh', 'bad');
    if (!r || r.empty) {
      score.textContent = '–';
      sum.textContent = r && r.onlyHoles ? 'Only holes so far — add a solid' : 'Add a shape to begin';
      body.replaceChildren(h('p', { class: 'note pad' }, 'As you design, PrintForge checks that your model fits your printer, sits flat on the bed, and needs as little support as possible.'));
      return;
    }
    if (r.failed) {
      score.textContent = '!';
      sum.textContent = 'Could not check this model';
      body.replaceChildren(h('p', { class: 'note pad' }, r.failed));
      return;
    }
    if (r.tooBig) {
      score.textContent = '…';
      sum.textContent = 'Too detailed to check in browser mode';
      body.replaceChildren(h('p', { class: 'note pad' }, 'Use the desktop app for very detailed models.'));
      return;
    }
    score.textContent = r.score;
    const bad = r.checks.filter((c) => c.level === 'error' || c.level === 'warn').length;
    if (bad > (this.lastBad || 0)) panel.classList.add('open');
    this.lastBad = bad;
    panel.classList.add(r.score >= 90 ? 'good' : r.score >= 60 ? 'meh' : 'bad');
    const problems = r.checks.filter((c) => c.level === 'error' || c.level === 'warn').length;
    sum.textContent = problems === 0 ? 'Ready to print' : problems + (problems === 1 ? ' thing to check' : ' things to check');
    const stats = h(
      'div',
      { class: 'stats' },
      stat('Size', fmtDims(r.dims, unit)),
      stat('Weight', fmtNum(r.grams, 1) + ' g'),
      stat('Print time', '≈ ' + r.time_text),
      stat('Filament', fmtNum(r.meters, 2) + ' m · $' + fmtNum(r.cost, 2))
    );
    const list = h(
      'ul',
      { class: 'checks', 'data-testid': 'checks' },
      ...r.checks.map((c) =>
        h(
          'li',
          { class: 'chk ' + c.level, 'data-check': c.id },
          icon(c.level === 'ok' ? 'ok' : c.level === 'error' ? 'error' : c.level === 'warn' ? 'warn' : 'info'),
          h('div', { class: 'grow' }, h('b', {}, c.title), h('p', {}, c.detail)),
          c.action ? btn(fixLabel(c.action), { class: 'small primary', onclick: () => this.fixAction(c.action), testid: 'fix-' + c.action }) : null
        )
      )
    );
    body.replaceChildren(stats, list, h('p', { class: 'note tiny' }, 'Estimates for ' + r.printer + ', ' + r.material + ', ' + this.model.settings.infill + '% infill, ' + this.model.settings.layer + ' mm layers. Your slicer gives the exact numbers.'));
  }

  async fixAction(action) {
    const m = this.model;
    const all = m.objects;
    if (!all.length) return;
    if (action === 'drop') {
      // rest the printable part (the solids) on the bed; holes move along
      const solids = all.filter((o) => !o.hole);
      const boxes = await Promise.all((solids.length ? solids : all).map((o) => m.worldBox(o)));
      const z = Math.min(...boxes.map((b) => b.min[2]));
      await m.moveBy(all, 0, 0, -z);
      toast('Moved down onto the bed.', 'ok');
    } else if (action === 'center') {
      await m.center(all);
      toast('Centered on the bed.', 'ok');
    } else if (action === 'fit_bed') {
      const pb = await m.plateBox();
      const dims = [0, 1, 2].map((i) => pb.max[i] - pb.min[i]);
      const r = await call('sizing.fit', { dims, printer: m.settings.printer, margin: 5 });
      if (r.ok) {
        if (r.rotate) await this.rotatePlate([0, 0, 90]);
        if (r.factor < 0.9999) await m.scaleAllBy(r.factor);
        await m.center(m.objects, true);
        toast(r.factor < 0.9999 ? 'Scaled to ' + fmtNum(r.factor * 100, 1) + '% so it fits your bed.' : 'Turned to fit the bed.', 'ok');
      }
    } else if (action === 'rotate_bed') {
      await this.rotatePlate([0, 0, 90]);
      await m.center(m.objects);
      toast('Turned 90° to fit the bed.', 'ok');
    } else if (action === 'orient') {
      if (!this.report || !this.report.orientations) return;
      const best = this.report.orientations[this.report.best];
      await this.rotatePlate(best.rot);
      toast('Laid it “' + best.name + '” — less support needed.', 'ok');
    } else if (action === 'repair') {
      await this.repairMeshes();
    }
    this.viewport.fit();
  }

  // Rotate everything on the plate as one rigid piece, then rest it on the bed.
  async rotatePlate(rot) {
    const m = this.model;
    m.begin();
    const pb = await m.plateBox();
    const c = [0, 1, 2].map((i) => (pb.min[i] + pb.max[i]) / 2);
    const D = Math.PI / 180;
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0] * D, rot[1] * D, rot[2] * D, 'ZYX'));
    const T = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
    for (const o of m.objects) {
      const d = decompose(T.clone().multiply(matrixOf(o)));
      if (d) Object.assign(o, d);
    }
    const z = (await m.plateBox()).min[2];
    for (const o of m.objects) o.pos[2] -= z;
    m.commit();
  }

  async autoOrient(objs) {
    const m = this.model;
    const pr = await m.printable(objs.map((o) => o.id));
    const tri = Array.from(pr.soup, (v) => Math.round(v * 1000) / 1000);
    const r = await call('analyze', { tri, printer: m.settings.printer, material: m.settings.material, settings: {}, watertight: true, pieces: 1 });
    if (!r.ok || r.empty) return;
    const best = r.orientations[r.best];
    if (r.best === 0) {
      toast('It already lies on its best side.', 'ok');
      return;
    }
    m.begin();
    for (const o of objs) await m.applyWorldEuler(o, best.rot);
    await m.drop(objs, false);
    toast('Laid “' + best.name + '”.', 'ok');
  }

  async repairMeshes() {
    const m = this.model;
    const broken = [];
    for (const o of m.objects) {
      const b = await m.base(o);
      if (!b.man) broken.push(o);
    }
    if (!broken.length) return;
    const choice = await choiceBox('Repair model', 'This model has gaps in its surface. PrintForge can wrap it in a closed skin (a "convex hull"). That always prints, but fills in hollows and dents. Most slicers can also repair it themselves when you export as-is.', [
      { label: 'Cancel', value: null },
      { label: 'Wrap it (convex hull)', value: 'hull', primary: true },
    ]);
    if (choice !== 'hull') return;
    m.begin();
    for (const o of broken) {
      const data = m.meshes[o.mesh].data;
      const pts = [];
      for (let i = 0; i < data.length; i += 3) pts.push([data[i], data[i + 1], data[i + 2]]);
      const hull = K.wasm().Manifold.hull(pts);
      const id = newId('m');
      m.meshes[id] = { data: K.soup(hull), name: m.meshes[o.mesh].name };
      hull.delete();
      o.mesh = id;
    }
    m.commit();
    toast('Repaired.', 'ok');
  }

  // ---- files -----------------------------------------------------------------------------
  // A friendly in-app file browser (the native window has no file dialogs).
  fileBrowser({ title, mode = 'open', exts = [], dir, name = '', okLabel }) {
    return new Promise((resolve) => {
      let cur = dir || this.places.projects;
      let chosen = null;
      const list = h('div', { class: 'fb-list', 'data-testid': 'fb-list' });
      const pathEl = h('div', { class: 'fb-path' });
      const nameIn = mode === 'save' ? h('input', { class: 'fb-name', value: name, 'data-testid': 'fb-name', spellcheck: 'false' }) : null;
      const placeBtns = h('div', { class: 'fb-places' });
      const places = [
        ['PrintForge', this.places.projects],
        ['Desktop', this.places.desktop],
        ['Documents', this.places.documents],
        ['Downloads', this.places.downloads],
        ['Home', this.places.home],
      ].filter((p) => p[1]);
      for (const [label, p] of places) placeBtns.appendChild(h('button', { class: 'fb-place', onclick: () => load(p), 'data-testid': 'place-' + label.toLowerCase() }, icon('folder'), label));
      const recent = (this.model.settings.recent || []).filter((r) => exts.some((e) => r.toLowerCase().endsWith(e)));
      if (mode === 'open' && recent.length) {
        placeBtns.appendChild(h('div', { class: 'fb-sub' }, 'Recent'));
        for (const r of recent) placeBtns.appendChild(h('button', { class: 'fb-place recent', title: r, onclick: () => finish(r) }, icon('file'), stripExt(basename(r))));
      }
      const finish = (p) => {
        md.close(p);
      };
      const load = async (d) => {
        const r = await call('fs.list', { dir: d, exts: mode === 'folder' ? ['.__none__'] : exts });
        if (!r.ok) {
          toast(r.error, 'warn');
          return;
        }
        cur = r.dir;
        chosen = null;
        pathEl.replaceChildren(h('button', { class: 'icon-btn', title: 'Up one folder', onclick: () => load(dirname(cur)), html: uiIcons.back, 'data-testid': 'fb-up' }), h('span', { class: 'fb-cur', title: cur }, cur));
        list.replaceChildren(
          ...r.entries.map((e) => {
            const row = h('button', { class: 'fb-item ' + (e.dir ? 'dir' : 'file'), 'data-name': e.name }, icon(e.dir ? 'folder' : 'file'), h('span', {}, e.name));
            row.addEventListener('click', () => {
              list.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
              row.classList.add('sel');
              if (e.dir) chosen = null;
              else {
                chosen = cur.replace(/\/$/, '') + '/' + e.name;
                if (nameIn) nameIn.value = stripExt(e.name);
              }
            });
            row.addEventListener('dblclick', () => (e.dir ? load(cur.replace(/\/$/, '') + '/' + e.name) : finish(cur.replace(/\/$/, '') + '/' + e.name)));
            return row;
          })
        );
        if (!r.entries.length) list.appendChild(h('p', { class: 'note pad' }, mode === 'folder' ? 'No folders here.' : 'Nothing here to open. Look in another folder.'));
      };
      const body = h('div', { class: 'fb' }, placeBtns, h('div', { class: 'fb-main' }, pathEl, list, nameIn ? h('label', { class: 'fb-name-row' }, 'File name', nameIn) : null));
      const md = modal({
        title,
        body,
        wide: true,
        actions: [
          { label: 'Cancel', value: null },
          {
            label: okLabel || (mode === 'save' ? 'Save' : mode === 'folder' ? 'Choose this folder' : 'Open'),
            primary: true,
            testid: 'fb-ok',
            onclick: () => {
              if (mode === 'folder') return cur;
              if (mode === 'save') {
                const n = safeName(nameIn.value);
                return { dir: cur, name: n };
              }
              if (!chosen) {
                toast('Pick a file first.', 'warn');
                return false;
              }
              return chosen;
            },
          },
        ],
        onClose: (v) => resolve(v),
      });
      load(cur);
    });
  }

  async confirmDiscard() {
    if (!this.model.dirty || !this.model.objects.length) return true;
    const v = await choiceBox('Unsaved changes', 'Do you want to save “' + this.model.name + '” first?', [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Don’t save', value: 'discard', danger: true, testid: 'discard' },
      { label: 'Save', value: 'save', primary: true },
    ]);
    if (v === 'save') return this.saveProject();
    return v === 'discard';
  }

  async newProject() {
    if (!(await this.confirmDiscard())) return;
    this.model.clear();
    call('autosave.clear', {});
    this.viewport.setView('iso');
    toast('New project.', 'info', 1800);
  }

  async openProject(path) {
    if (!(await this.confirmDiscard())) return;
    const p = path || (await this.fileBrowser({ title: 'Open a project', mode: 'open', exts: ['.pforge'] }));
    if (!p) return;
    const r = await call('project.load', { path: p });
    if (!r.ok) return toast(r.error, 'error');
    await this.loadDoc(r.doc, p);
    toast('Opened ' + this.model.name + '.', 'ok');
  }

  async loadDoc(doc, path) {
    const s = doc.settings || {};
    if (s.printer && this.model.catalog.printers.some((x) => x.id === s.printer)) this.model.settings.printer = s.printer;
    if (s.material) this.model.settings.material = s.material;
    if (s.units) this.model.settings.units = s.units;
    this.viewport.buildBed();
    await this.model.loadDoc(doc, path);
    this.updateChrome();
    this.inspector.render(true);
    this.viewport.setView('iso');
    this.refreshSettingsAfterLoad();
  }

  refreshSettingsAfterLoad() {
    this.saveSettings();
    const m = this.model;
    const p = m.settings.recent || [];
    if (m.path) m.settings.recent = [m.path, ...p.filter((x) => x !== m.path)].slice(0, 8);
  }

  async saveProject(asNew = false) {
    const m = this.model;
    let path = m.path;
    if (!path || asNew) {
      const r = await this.fileBrowser({ title: 'Save project', mode: 'save', exts: ['.pforge'], name: m.name, dir: path ? dirname(path) : this.places.projects });
      if (!r) return false;
      path = r.dir.replace(/\/$/, '') + '/' + r.name + '.pforge';
      if (path !== m.path) {
        const ex = await call('fs.exists', { path });
        if (ex.ok && ex.exists && !(await confirmBox('Replace file?', '“' + r.name + '.pforge” already exists. Replace it?', 'Replace', true))) return false;
      }
      if (m.name === 'Untitled') m.name = r.name;
    }
    const res = await call('project.save', { path, doc: m.toDoc() });
    if (!res.ok) {
      toast(res.error, 'error');
      return false;
    }
    m.path = path;
    m.dirty = false;
    this.refreshSettingsAfterLoad();
    call('autosave.clear', {});
    this.updateChrome();
    toast('Saved to ' + basename(path) + '.', 'ok');
    return true;
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveT);
    this.autosaveT = setTimeout(() => {
      if (this.model.dirty && this.model.objects.length) call('autosave.save', { doc: { ...this.model.toDoc(), path: this.model.path } });
    }, 2500);
  }

  async offerRestore() {
    if (this.init.selftest) return false;
    const r = await call('autosave.load', {});
    if (!r.ok || !r.doc || !r.doc.objects || !r.doc.objects.length) return false;
    const yes = await confirmBox('Restore your work?', 'PrintForge closed while “' + (r.doc.name || 'Untitled') + '” had unsaved changes. Do you want to continue where you left off?', 'Restore');
    if (!yes) {
      call('autosave.clear', {});
      return false;
    }
    await this.loadDoc(r.doc, r.doc.path || '');
    this.model.dirty = true;
    this.updateChrome();
    return true;
  }

  // ---- import ---------------------------------------------------------------------------
  async importDialog() {
    const p = await this.fileBrowser({ title: 'Import a 3D model', mode: 'open', exts: ['.stl', '.obj', '.3mf'], dir: this.places.downloads || this.places.projects });
    if (!p) return;
    await this.importPath(p);
  }

  async importPath(p) {
    const r = await call('import.read', { path: p });
    if (!r.ok) return toast(r.error, 'error');
    let soup;
    try {
      if (r.kind === 'soup') {
        const parts = r.data.split(',');
        soup = new Float32Array(parts.length);
        for (let i = 0; i < parts.length; i++) soup[i] = parseInt(parts[i], 10) * r.scale;
      } else soup = await parseFile(p, b64ToBuf(r.data));
    } catch (e) {
      return toast(e.message, 'error');
    }
    await this.addMesh(soup, stripExt(basename(p)));
  }

  async addMesh(soup, name) {
    const m = this.model;
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], soup[i + k]);
      mx[k] = Math.max(mx[k], soup[i + k]);
    }
    const dims = [0, 1, 2].map((k) => mx[k] - mn[k]);
    const g = await call('sizing.guess', { dims });
    let factor = 1;
    if (g.ok && g.unit !== 'mm' && g.message) {
      const label = { in: 'Convert from inches', m: 'Convert from metres', um: 'Convert from micrometres' }[g.unit] || 'Convert';
      const v = await choiceBox('Check the size', g.message, [
        { label: 'Keep as is', value: 1 },
        { label: label + ' (×' + fmtNum(g.factor, 4) + ')', value: g.factor, primary: g.sure, testid: 'convert-units' },
      ]);
      factor = v || 1;
    }
    if (factor !== 1) for (let i = 0; i < soup.length; i++) soup[i] *= factor;
    const id = newId('m');
    m.meshes[id] = { data: soup, name };
    const o = await m.add('mesh', { mesh: id });
    m.objects[m.objects.length - 1].name = name || 'Imported model';
    const b = await m.base(o);
    if (!b.man) toast('Imported, but the model has gaps in its surface. See Print check.', 'warn', 6000);
    else toast('Imported ' + (name || 'model') + ' (' + fmtDims(dims.map((d) => d * factor), m.settings.units) + ').', 'ok');
    this.viewport.fit();
    this.inspector.render(true);
  }

  bindFileDrop() {
    // Files dropped from Finder / the desktop.
    const stage = document.body;
    stage.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer.types || [])].includes('Files')) {
        e.preventDefault();
        document.body.classList.add('dropping');
      }
    });
    stage.addEventListener('dragleave', (e) => {
      if (e.target === document.body || !e.relatedTarget) document.body.classList.remove('dropping');
    });
    stage.addEventListener('drop', async (e) => {
      document.body.classList.remove('dropping');
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) {
        if (f.name.toLowerCase().endsWith('.pforge')) {
          try {
            const doc = JSON.parse(await f.text());
            if (doc.app !== 'PrintForge') throw new Error('not a project');
            if (await this.confirmDiscard()) await this.loadDoc(doc, '');
          } catch (err) {
            toast('That is not a PrintForge project.', 'error');
          }
          continue;
        }
        try {
          const soup = await parseFile(f.name, await f.arrayBuffer());
          await this.addMesh(soup, stripExt(f.name));
        } catch (err) {
          toast(f.name + ': ' + err.message, 'error');
        }
      }
    });
  }

  // ---- export ----------------------------------------------------------------------------
  async exportDialog() {
    const m = this.model;
    if (!m.objects.some((o) => !o.hole)) return toast('Add a solid shape first — there is nothing to print yet.', 'warn');
    let dir = m.settings.export_dir || this.places.projects;
    const nameIn = h('input', { value: safeName(m.name === 'Untitled' ? 'my-print' : m.name), 'data-testid': 'export-name', spellcheck: 'false' });
    const fmt = h('select', { 'data-testid': 'export-format' }, h('option', { value: 'stl' }, 'STL — works in every slicer'), h('option', { value: 'obj' }, 'OBJ'));
    const what = h('select', { 'data-testid': 'export-what' }, h('option', { value: 'all' }, 'Everything on the plate'), m.selection.length ? h('option', { value: 'sel' }, 'Only the selected objects') : null);
    const dirEl = h('span', { class: 'path', title: dir }, dir);
    const changeDir = btn('Change…', {
      icon: 'folder',
      onclick: async () => {
        const d = await this.fileBrowser({ title: 'Choose a folder', mode: 'folder', dir });
        if (d) {
          dir = d;
          dirEl.textContent = d;
          dirEl.title = d;
        }
      },
    });
    const r = this.report;
    const summary = r && !r.empty && !r.tooBig && !r.failed ? h('div', { class: 'export-summary' }, h('span', { class: 'score ' + (r.score >= 90 ? 'good' : r.score >= 60 ? 'meh' : 'bad') }, r.score), h('div', {}, h('b', {}, r.checks.some((c) => c.level === 'error') ? 'Some problems need fixing first' : 'Looks printable'), h('p', {}, fmtDims(r.dims, m.settings.units) + ' · ≈ ' + r.time_text + ' · ' + fmtNum(r.grams, 1) + ' g'))) : null;
    const body = h('div', { class: 'form' }, summary, h('label', {}, 'File name', nameIn), h('label', {}, 'Format', fmt), h('label', {}, 'What to export', what), h('div', { class: 'folder-row' }, h('span', { class: 'lbl' }, 'Folder'), dirEl, changeDir));
    const md = modal({
      title: 'Export for your slicer',
      body,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Export',
          primary: true,
          icon: 'export',
          testid: 'export-go',
          onclick: () => {
            this.doExport({ dir, name: safeName(nameIn.value), format: fmt.value, only: what.value === 'sel' ? m.selection.slice() : null });
          },
        },
      ],
    });
    return md;
  }

  async doExport({ dir, name, format, only }) {
    const m = this.model;
    const path = dir.replace(/\/$/, '') + '/' + name + '.' + format;
    const ex = await call('fs.exists', { path });
    if (ex.ok && ex.exists && !(await confirmBox('Replace file?', '“' + name + '.' + format + '” already exists in this folder. Replace it?', 'Replace', true))) return;
    const pr = await m.printable(only);
    if (!pr.soup.length) return toast('Nothing to export: the selection has no solid parts.', 'warn');
    const tri = Array.from(pr.soup, (v) => Math.round(v * 10000) / 10000);
    const res = await call('export', { dir, name, format, tri });
    if (!res.ok) return toast(res.error, 'error');
    m.settings.export_dir = dir;
    this.saveSettings();
    this.lastExport = res.path;
    const slicerBtns = this.platform === 'mac' ? h('div', { class: 'slicers' }, h('p', { class: 'note' }, 'Or open it with:'), ...SLICERS.map((s) => btn(s, { class: 'small', onclick: async () => {
      const r = await call('os.open_with', { app: s, path: res.path });
      if (!r.ok) toast(r.error, 'warn');
    } }))) : null;
    modal({
      title: 'Exported!',
      cls: 'success',
      body: h('div', { class: 'export-done' }, icon('ok', 'big-ok'), h('p', {}, 'Saved ', h('b', {}, basename(res.path)), ' (' + fmtNum(res.bytes / 1024, 0) + ' KB) to'), h('p', { class: 'path', 'data-testid': 'export-path' }, dirname(res.path)), h('p', { class: 'note' }, 'Next: open it in your slicer, pick your filament, and press slice.'), slicerBtns),
      actions: [
        { label: 'Show in folder', icon: 'folder', onclick: () => void call('os.open', { path: res.path, reveal: true }).then((r) => !r.ok && toast(r.error, 'warn')) },
        { label: 'Open in slicer', icon: 'slicer', primary: true, onclick: () => void call('os.open', { path: res.path }).then((r) => !r.ok && toast(r.error, 'warn')) },
      ],
    });
    return res;
  }

  // ---- settings, welcome, help ----------------------------------------------------------------
  printerSelect(value) {
    const sel = h('select', { 'data-testid': 'printer-select' });
    const brands = [...new Set(this.model.catalog.printers.map((p) => p.brand))];
    for (const b of brands) {
      const g = h('optgroup', { label: b });
      for (const p of this.model.catalog.printers.filter((x) => x.brand === b)) g.appendChild(h('option', { value: p.id, selected: p.id === value }, p.brand + ' ' + p.name + '  (' + p.bx + '×' + p.by + '×' + p.bz + ')'));
      sel.appendChild(g);
    }
    return sel;
  }

  materialSelect(value) {
    return h('select', { 'data-testid': 'material-select' }, ...this.model.catalog.materials.map((x) => h('option', { value: x.id, selected: x.id === value }, x.name)));
  }

  openSettings() {
    const s = this.model.settings;
    const pr = this.printerSelect(s.printer);
    const mt = this.materialSelect(s.material);
    const note = h('p', { class: 'note' });
    const showNote = () => {
      const x = this.model.catalog.materials.find((q) => q.id === mt.value);
      note.textContent = x ? x.note + ' Nozzle ' + x.nozzle_temp + ' °C, bed ' + x.bed_temp + ' °C.' : '';
    };
    mt.addEventListener('change', showNote);
    showNote();
    const infill = h('input', { type: 'number', min: 0, max: 100, step: 5, value: s.infill });
    const layer = h('select', {}, ...[0.08, 0.12, 0.16, 0.2, 0.24, 0.28].map((v) => h('option', { value: v, selected: Math.abs(v - s.layer) < 1e-6 }, v + ' mm' + (v === 0.2 ? ' (standard)' : v < 0.16 ? ' (fine)' : v > 0.2 ? ' (fast)' : ''))));
    const walls = h('input', { type: 'number', min: 1, max: 8, step: 1, value: s.walls });
    const units = h('select', {}, h('option', { value: 'mm', selected: s.units === 'mm' }, 'Millimetres (mm)'), h('option', { value: 'in', selected: s.units === 'in' }, 'Inches (in)'));
    modal({
      title: 'Settings',
      body: h(
        'div',
        { class: 'form' },
        h('label', {}, 'My printer', pr),
        h('label', {}, 'Filament', mt),
        note,
        h('label', {}, 'Units', units),
        h('div', { class: 'form-sub' }, 'Used for the weight, cost and time estimates:'),
        h('div', { class: 'cols3' }, h('label', {}, 'Infill %', infill), h('label', {}, 'Layer height', layer), h('label', {}, 'Walls', walls))
      ),
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Save',
          primary: true,
          testid: 'settings-save',
          onclick: () => {
            const changedPrinter = s.printer !== pr.value;
            s.printer = pr.value;
            s.material = mt.value;
            s.units = units.value;
            s.infill = Math.max(0, Math.min(100, parseFloat(infill.value) || 15));
            s.layer = parseFloat(layer.value) || 0.2;
            s.walls = Math.max(1, Math.min(8, parseInt(walls.value, 10) || 2));
            this.saveSettings();
            if (changedPrinter) {
              this.viewport.buildBed();
              this.model.bases.clear();
              this.model.update();
            }
            this.updateChrome();
            this.inspector.render(true);
            this.scheduleCheck();
            this.viewport.updateSelectionBox();
          },
        },
      ],
    });
  }

  welcome() {
    const s = this.model.settings;
    const pr = this.printerSelect(s.printer);
    const mt = this.materialSelect(s.material);
    const units = h('div', { class: 'seg big' }, ...['mm', 'in'].map((u) => h('button', { class: s.units === u ? 'on' : '', onclick: (e) => {
      s.units = u;
      units.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    } }, u === 'mm' ? 'Millimetres' : 'Inches')));
    modal({
      title: 'Welcome to PrintForge',
      cls: 'welcome',
      closable: false,
      body: h(
        'div',
        { class: 'form' },
        h('p', { class: 'lead' }, 'Design your own 3D prints in minutes — no 3D experience needed. First, tell us about your printer so we can check that everything you make will print.'),
        h('label', {}, 'Which printer do you have?', pr),
        h('label', {}, 'Which filament do you use most?', mt),
        h('div', { class: 'lbl-block' }, 'How do you like to measure?', units),
        h('p', { class: 'note' }, 'Not sure? Pick “Generic · Medium printer”. You can change all of this later in Settings.')
      ),
      actions: [
        {
          label: 'Start designing',
          primary: true,
          testid: 'welcome-start',
          onclick: () => {
            s.printer = pr.value;
            s.material = mt.value;
            s.welcomed = true;
            this.saveSettings();
            this.viewport.buildBed();
            this.updateChrome();
            this.inspector.render(true);
            this.viewport.setView('iso');
            setTimeout(() => this.tour(), 300);
          },
        },
      ],
    });
  }

  tour() {
    const steps = [
      ['#library', 'Shapes and parts', 'Click any shape to put it on the plate. “Ready-made parts” are useful things like boxes, hooks and gears that you can adjust.'],
      ['#inspector', 'Exact sizes', 'Select a shape and type the exact size you want. You can type “25”, “2.5 cm” or “1 1/2 in”. Lock keeps the proportions.'],
      ['#checkPanel', 'Print check', 'Always watching: does it fit, does it sit flat, does it need supports? Fix problems with one click.'],
      ['[data-testid="btn-export"]', 'Export', 'When you are happy, export an STL and open it in your slicer.'],
    ];
    let i = 0;
    const tip = h('div', { class: 'tour' });
    document.body.appendChild(tip);
    const show = () => {
      if (i >= steps.length) {
        tip.remove();
        document.querySelectorAll('.tour-target').forEach((x) => x.classList.remove('tour-target'));
        return;
      }
      const [sel, title, text] = steps[i];
      const target = document.querySelector(sel);
      document.querySelectorAll('.tour-target').forEach((x) => x.classList.remove('tour-target'));
      if (target) target.classList.add('tour-target');
      const r = target ? target.getBoundingClientRect() : { left: 200, top: 200, width: 0, height: 0, right: 200, bottom: 200 };
      tip.replaceChildren(h('div', { class: 'tour-step' }, `${i + 1} / ${steps.length}`), h('b', {}, title), h('p', {}, text), h('div', { class: 'tour-btns' }, btn('Skip', { onclick: () => ((i = steps.length), show()) }), btn(i === steps.length - 1 ? 'Done' : 'Next', { class: 'primary', onclick: () => (i++, show()) })));
      const tw = 300;
      const th = tip.offsetHeight || 180;
      let left = r.right + 14;
      if (left + tw > window.innerWidth - 10) left = r.left - tw - 14;
      if (left < 10) left = Math.max(10, Math.min(window.innerWidth - tw - 10, r.right - tw));
      let top = sel.includes('export') ? r.bottom + 12 : sel === '#checkPanel' ? r.bottom - th : r.top + 20;
      top = Math.max(60, Math.min(window.innerHeight - th - 10, top));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    show();
  }

  help() {
    const k = (keys, what) => h('tr', {}, h('td', {}, ...keys.split(' ').map((x) => h('kbd', {}, x))), h('td', {}, what));
    modal({
      title: 'How PrintForge works',
      wide: true,
      body: h(
        'div',
        { class: 'help' },
        h(
          'div',
          { class: 'help-cols' },
          h(
            'div',
            {},
            h('h3', {}, 'The basics'),
            h('ol', {}, h('li', {}, 'Add shapes or ready-made parts from the left.'), h('li', {}, 'Move them by dragging. Set exact sizes on the right or by clicking the size labels.'), h('li', {}, 'Make a shape a ', h('b', {}, 'Hole'), ' to cut it out of whatever it touches.'), h('li', {}, 'Select several and ', h('b', {}, 'Group'), ' them to make one part.'), h('li', {}, 'Watch the ', h('b', {}, 'Print check'), ', then ', h('b', {}, 'Export STL'), ' and open it in your slicer.')),
            h('h3', {}, 'Good to know'),
            h('ul', {}, h('li', {}, 'Sizes accept 25, 25mm, 2.5 cm, 1in, 3/4", 1 1/2 in, even 1in + 5mm.'), h('li', {}, 'Walls thinner than two nozzle widths (0.8 mm on most printers) print poorly.'), h('li', {}, 'Holes for screws: ready-made parts add the right clearance for you.'), h('li', {}, 'Surfaces leaning more than 45° need supports. “Lay flat” finds the best side down.'), h('li', {}, 'Your work is auto-saved and restored if the app closes unexpectedly.'))
          ),
          h(
            'div',
            {},
            h('h3', {}, 'Shortcuts'),
            h(
              'table',
              { class: 'keys' },
              k('⌘ N', 'New project'),
              k('⌘ O', 'Open project'),
              k('⌘ S', 'Save (⇧⌘S save as)'),
              k('⌘ E', 'Export STL'),
              k('⌘ I', 'Import a model'),
              k('⌘ Z', 'Undo (⇧⌘Z redo)'),
              k('⌘ D', 'Duplicate'),
              k('⌘ G', 'Group (⇧⌘G ungroup)'),
              k('⌘ C ⌘ V', 'Copy / paste'),
              k('⌘ A', 'Select all'),
              k('⌫', 'Delete'),
              k('H', 'Toggle solid / hole'),
              k('V R M', 'Move / Rotate / Measure tool'),
              k('← → ↑ ↓', 'Nudge (⇧ ×10, ⌥ 0.1)'),
              k('PgUp PgDn', 'Raise / lower'),
              k('D', 'Drop to bed'),
              k('F', 'Zoom to fit'),
              k('1 2 3 4', 'Home / top / front / side view'),
              k('Esc', 'Deselect, finish measuring')
            )
          )
        ),
        h('p', { class: 'note' }, 'PrintForge ' + this.init.version + ' · built with the Solemn programming language · geometry by Manifold.')
      ),
    });
  }

  // ---- keyboard ---------------------------------------------------------------------------
  bindKeys() {
    document.addEventListener('keydown', async (e) => {
      const m = this.model;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (topModal()) {
        if (e.key === 'Escape' && topModal().closable) topModal().close(null);
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        return this.saveProject(e.shiftKey);
      }
      if (mod && key === 'o') {
        e.preventDefault();
        return this.openProject();
      }
      if (mod && key === 'n') {
        e.preventDefault();
        return this.newProject();
      }
      if (mod && key === 'e') {
        e.preventDefault();
        return this.exportDialog();
      }
      if (mod && key === 'i') {
        e.preventDefault();
        return this.importDialog();
      }
      if (isTyping(e)) return;
      const sel = m.selected();
      if (mod && key === 'z') {
        e.preventDefault();
        return e.shiftKey ? m.redo() : m.undo();
      }
      if (mod && key === 'y') {
        e.preventDefault();
        return m.redo();
      }
      if (mod && key === 'a') {
        e.preventDefault();
        return m.select(m.objects.map((o) => o.id));
      }
      if (mod && key === 'd') {
        e.preventDefault();
        return m.duplicate(sel);
      }
      if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) return sel.filter((o) => o.kind === 'group').forEach((g) => m.ungroup(g));
        return m.group(sel);
      }
      if (mod && key === 'c') {
        if (sel.length) {
          e.preventDefault();
          this.copy();
        }
        return;
      }
      if (mod && key === 'v') {
        if (this.clipboard) {
          e.preventDefault();
          this.paste();
        }
        return;
      }
      if (mod) return;
      if (e.key === 'Escape') {
        if (this.viewport.tool !== 'select') this.setTool('select');
        else m.select([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return m.remove(sel);
      }
      if (e.key === '?') return this.help();
      if (key === 'v') return this.setTool('select');
      if (key === 'r') return this.setTool('rotate');
      if (key === 'm') return this.setTool('measure');
      if (key === 'f') return this.viewport.fit();
      if (key === '1') return this.viewport.setView('iso');
      if (key === '2') return this.viewport.setView('top');
      if (key === '3') return this.viewport.setView('front');
      if (key === '4') return this.viewport.setView('right');
      if (!sel.length) return;
      if (key === 'h') return m.setHole(sel, !sel[0].hole);
      if (key === 'd') return m.drop(sel);
      const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (m.settings.grid >= 1 ? m.settings.grid : 1);
      const nudge = { arrowleft: [-step, 0, 0], arrowright: [step, 0, 0], arrowup: [0, step, 0], arrowdown: [0, -step, 0], pageup: [0, 0, step], pagedown: [0, 0, -step] }[key];
      if (nudge) {
        e.preventDefault();
        return m.moveBy(sel, ...nudge);
      }
    });
    // Menu-driven copy/paste (macOS Edit menu) fires DOM events.
    document.addEventListener('copy', (e) => {
      if (isTyping(e) || !this.model.selection.length) return;
      e.preventDefault();
      this.copy();
    });
    document.addEventListener('paste', (e) => {
      if (isTyping(e) || !this.clipboard) return;
      e.preventDefault();
      this.paste();
    });
  }

  copy() {
    const t = Date.now();
    if (this.lastCopy && t - this.lastCopy < 150) return;
    this.lastCopy = t;
    this.clipboard = JSON.parse(JSON.stringify(this.model.selected()));
    toast('Copied ' + this.clipboard.length + (this.clipboard.length === 1 ? ' object.' : ' objects.'), 'info', 1500);
  }

  async paste() {
    const t = Date.now();
    if (this.lastPaste && t - this.lastPaste < 150) return;
    this.lastPaste = t;
    const m = this.model;
    m.begin();
    const ids = [];
    for (const o of this.clipboard) {
      const c = JSON.parse(JSON.stringify(o));
      const fix = (x) => {
        x.id = newId(x.kind === 'group' ? 'g' : 'o');
        if (x.children) x.children.forEach(fix);
      };
      fix(c);
      c.pos[0] += 10;
      c.pos[1] += 10;
      c.name = m.nextName(c.name.replace(/ \d+$/, ''));
      m.objects.push(c);
      ids.push(c.id);
    }
    m.select(ids);
    m.commit();
  }
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', {}, label), h('b', {}, value));
}

function fixLabel(a) {
  return { drop: 'Put on bed', center: 'Center it', fit_bed: 'Make it fit', rotate_bed: 'Turn it', orient: 'Lay it better', repair: 'Repair' }[a] || 'Fix';
}

function snap(v, g) {
  return g > 0 ? Math.round(v / g) * g : v;
}
