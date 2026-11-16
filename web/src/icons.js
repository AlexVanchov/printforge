// Inline SVG icons. UI icons are 24x24 strokes; library icons are small
// shaded drawings (top / left / right faces use .t .l .r tones).
const S = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ui = {
  new: S('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>'),
  open: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: S('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>'),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: S('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  import: S('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  export: S('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>'),
  select: S('<path d="m4 3 7 17 2.5-7.5L21 10z"/>'),
  move: S('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  rotate: S('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  measure: S('<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  home: S('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5"/>'),
  top: S('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/>'),
  front: S('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15h16"/>'),
  side: S('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M15 4v16"/>'),
  fit: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4h6v3"/>'),
  copy: S('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  group: S('<rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/>'),
  ungroup: S('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M14 7h3a2 2 0 0 1 2 2v1M7 14v3a2 2 0 0 0 2 2h1"/>'),
  hole: S('<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/>'),
  solid: S('<rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity=".25"/>'),
  mirror: S('<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>'),
  drop: S('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  center: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
  check: S('<path d="m5 12 5 5 9-10"/>'),
  ok: S('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  warn: S('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
  error: S('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: S('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  cube: S('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  up: S('<path d="m6 15 6-6 6 6"/>'),
  back: S('<path d="m15 18-6-6 6-6"/>'),
  printer: S('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 17v4h10v-4"/>'),
  edges: S('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2 2"/>'),
  scale: S('<path d="M21 3 14 10M21 3h-6M21 3v6M3 21l7-7M3 21h6M3 21v-6"/>'),
  wand: S('<path d="m15 4 5 5L9 20l-5-5zM12 7l5 5"/><path d="M5 3v4M3 5h4M19 15v4M17 17h4"/>'),
  slicer: S('<path d="M4 18h16M6 14h12M8 10h8M10 6h4"/>'),
  sparkle: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  align: S('<path d="M4 4v16M8 7h12M8 12h8M8 17h10"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
};

const P = (body) => `<svg viewBox="0 0 48 48" class="pic">${body}</svg>`;
// isometric helpers: top face, left face, right face of a block
const iso = (x, y, w, d, h) => {
  const a = 0.5;
  const top = `M${x},${y} l${w},${-w * a} l${d},${d * a} l${-w},${w * a}z`;
  const left = `M${x},${y} l${d},${d * a} v${h} l${-d},${-d * a}z`;
  const right = `M${x + d},${y + d * a} l${w},${-w * a} v${h} l${-w},${w * a}z`;
  return `<path class="l" d="${left}"/><path class="r" d="${right}"/><path class="t" d="${top}"/>`;
};

export const parts = {
  box: P(iso(8, 18, 16, 16, 16)),
  cylinder: P('<path class="r" d="M10 14v20a14 6 0 0 0 28 0V14z"/><ellipse class="t" cx="24" cy="14" rx="14" ry="6"/>'),
  sphere: P('<circle class="r" cx="24" cy="24" r="16"/><ellipse class="t" cx="19" cy="18" rx="8" ry="6" opacity=".7"/>'),
  cone: P('<path class="r" d="M24 6 10 36a14 6 0 0 0 28 0z"/><path class="l" d="M24 6 10 36a14 6 0 0 0 9 5z"/>'),
  pyramid: P('<path class="l" d="M24 6 8 32l14 9z"/><path class="r" d="M24 6l16 26-18 9z"/>'),
  torus: P('<ellipse class="r" cx="24" cy="26" rx="18" ry="11"/><ellipse class="bg" cx="24" cy="24" rx="7" ry="4"/>'),
  tube: P('<path class="r" d="M10 14v20a14 6 0 0 0 28 0V14z"/><ellipse class="t" cx="24" cy="14" rx="14" ry="6"/><ellipse class="bg" cx="24" cy="14" rx="9" ry="3.6"/>'),
  wedge: P('<path class="l" d="M8 34 8 14l16 8v20z"/><path class="t" d="M8 14l16 8 16-8-16 0z" opacity="0"/><path class="r" d="M24 42V22l16 12-0 0z"/><path class="t" d="M8 14l16 8 16 12-16-8z"/>'),
  dome: P('<path class="r" d="M8 30a16 16 0 0 1 32 0z"/><ellipse class="l" cx="24" cy="30" rx="16" ry="5"/>'),
  prism: P('<path class="t" d="M14 10h20l7 7-7 7H14l-7-7z"/><path class="r" d="M7 17v14l7 7h20l7-7V17l-7 7H14z"/>'),
  star: P('<path class="t" d="m24 5 5.6 11.5 12.6 1.8-9.1 8.9 2.1 12.6L24 33.9l-11.2 5.9 2.1-12.6-9.1-8.9 12.6-1.8z"/>'),
  heart: P('<path class="t" d="M24 41S6 30 6 17a9 9 0 0 1 18-2 9 9 0 0 1 18 2c0 13-18 24-18 24z"/>'),
  text: P('<text x="24" y="34" text-anchor="middle" class="t" font-size="26" font-weight="800" font-family="system-ui">Aa</text>'),
  storage_box: P(iso(6, 20, 20, 16, 14) + '<path class="bg" d="M10 20l16-8 12 6-16 8z"/>'),
  wall_hook: P('<path class="r" d="M12 6h6v26h14v-8h6v14H12z"/>'),
  shelf_bracket: P('<path class="r" d="M8 6h6v28h28v6H8z"/><path class="l" d="M14 16v18h18z"/>'),
  cable_clip: P('<path class="r" d="M24 10a12 12 0 1 0 6 1.6l-2 4A7.5 7.5 0 1 1 24 14.5z"/><rect class="l" x="20" y="34" width="22" height="5" rx="1"/>'),
  spacer: P('<path class="r" d="M8 20v8a16 7 0 0 0 32 0v-8z"/><ellipse class="t" cx="24" cy="20" rx="16" ry="7"/><ellipse class="bg" cx="24" cy="20" rx="5" ry="2.4"/>'),
  phone_stand: P('<path class="r" d="M6 40h36v-4H10v-6H6z"/><path class="l" d="M18 36 28 8h5L26 36z"/><rect class="t" x="11" y="14" width="12" height="20" rx="2" transform="rotate(20 17 24)" opacity=".55"/>'),
  gear: P('<path class="t" d="M21 4h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z"/><circle class="bg" cx="24" cy="24" r="5"/>'),
  knob: P('<path class="r" d="M10 18v14a14 6 0 0 0 28 0V18z"/><ellipse class="t" cx="24" cy="18" rx="14" ry="6"/><path stroke="currentColor" stroke-width="1.4" opacity=".35" d="M14 22v12M19 23v13M24 24v13M29 23v13M34 22v12"/>'),
  name_tag: P('<rect class="r" x="4" y="14" width="40" height="20" rx="5"/><circle class="bg" cx="10" cy="24" r="3"/><text x="28" y="29" text-anchor="middle" class="t" font-size="11" font-weight="800" font-family="system-ui">ABC</text>'),
  plant_pot: P('<path class="r" d="M8 12h32l-5 28H13z"/><ellipse class="t" cx="24" cy="12" rx="16" ry="4"/><ellipse class="bg" cx="24" cy="12" rx="13" ry="2.8"/><path class="l" d="M20 8c0-4 4-6 4-6s4 2 4 6"/>'),
  mount_plate: P('<path class="t" d="M4 26 24 16l20 10-20 10z"/><path class="r" d="M4 26v4l20 10v-4z"/><path class="l" d="M24 36v4l20-10v-4z"/><ellipse class="bg" cx="16" cy="25" rx="2.6" ry="1.4"/><ellipse class="bg" cx="32" cy="25" rx="2.6" ry="1.4"/><ellipse class="bg" cx="24" cy="21" rx="2.6" ry="1.4"/><ellipse class="bg" cx="24" cy="29" rx="2.6" ry="1.4"/>'),
  drawer_handle: P('<path class="r" d="M6 34V20a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v14h-6V22a2 2 0 0 0-2-2H14a2 2 0 0 0-2 2v12z"/>'),
  mesh: P('<path class="l" d="M24 4 6 14v20l18 10z"/><path class="r" d="M24 4l18 10v20L24 44z"/><path stroke="currentColor" opacity=".35" fill="none" d="M24 4v40M6 14l36 20M42 14 6 34"/>'),
  group: P(iso(6, 22, 14, 10, 12) + iso(20, 26, 12, 12, 10)),
};
