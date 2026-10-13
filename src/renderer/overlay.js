/* BillyShot 截图覆盖层：微信式选区 + 标注编辑 */
'use strict';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');
const magCv = $('magCv');
const mctx = magCv.getContext('2d');
const toolbar = $('toolbar');
const stylebar = $('stylebar');
const editor = $('textEditor');
const sizeLabel = $('sizeLabel');
const isMac = api.platform === 'darwin';

const ACCENT = '#7c7cff';
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ffffff', '#000000'];
const SIZES = {
  rect: [2, 4, 7], ellipse: [2, 4, 7], arrow: [2, 4, 7], pen: [2, 4, 8], marker: [12, 20, 32],
  mosaic: [14, 26, 44], text: [16, 24, 36], number: [11, 15, 20],
};
const TOOL_KEYS = { r: 'rect', e: 'ellipse', a: 'arrow', p: 'pen', h: 'marker', m: 'mosaic', t: 'text', n: 'number' };
const FONT = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';

let S = null; // 当前会话
const style = {
  rect: { color: '#ff3b30', size: 0 }, ellipse: { color: '#ff3b30', size: 0 }, arrow: { color: '#ff3b30', size: 1 },
  pen: { color: '#ff3b30', size: 0 }, marker: { color: '#ffcc00', size: 1 }, mosaic: { size: 1, mode: 'brush', effect: 'pixel', brush: 32, strength: 5 },
  text: { color: '#ff3b30', size: 1 }, number: { color: '#ff3b30', size: 1 },
};

// ------------------------------------------------------------------ 图标
const I = {
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="12" rx="8.5" ry="7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19L19 5M10 5h9v9"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.2-4.6L16.5 4.1a1.9 1.9 0 0 1 2.7 0l.7.7a1.9 1.9 0 0 1 0 2.7L8.6 18.8 4 20z"/><path d="M14.5 6l3.5 3.5"/></svg>',
  marker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l-4 4h6l1.5-1.5"/><path d="M9 15l7.8-9.6a2 2 0 0 1 2.9-.2l.1.1a2 2 0 0 1-.2 2.9L10 16"/><path d="M3 21h18" opacity=".5"/></svg>',
  mosaic: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="5" height="5"/><rect x="14" y="4" width="5" height="5" opacity=".45"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="4" y="15" width="5" height="5" opacity=".45"/><rect x="15" y="15" width="5" height="5"/><rect x="9.5" y="4" width="4" height="5" opacity=".2"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 6V5h14v1M12 5v14M9 19h6"/></svg>',
  number: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.2L12.6 8v8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  record: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3" stroke-linejoin="round"/><circle cx="9.5" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5-3 1-3.5 3.5L13 18l-7-7 4.5-.5L14 7z"/><path d="M8.5 15.5L4 20"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3.5" y="13.5" width="4" height="6" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6" rx="1.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>',
  brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 17c3-6 6 2 9-4s5-3 7-6"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2"><rect x="4" y="5" width="16" height="14"/></svg>',
};

// ------------------------------------------------------------------ 会话
// 主题配色（只影响工具栏强调色）：创建时从 URL 参数拿，之后主进程推送
try { const th = new URLSearchParams(location.search).get('theme'); if (th) document.documentElement.dataset.theme = th; } catch {}
api.on('overlay:theme', (th) => { document.documentElement.dataset.theme = th || ''; });
api.on('overlay:start', async (data) => {
  try { await begin(data); } catch (e) { console.error('begin failed', e); S = null; api.send('overlay:painted', { ok: false, error: String(e && e.message || e) }); }
});
api.on('overlay:reset', () => {
  document.body.classList.add('hidden');
  closeEditor(false);
  hideUi();
  S = null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  // 给合成器一帧时间清掉旧画面
  setTimeout(() => api.send('overlay:cleared'), 30);
});

async function begin(data) {
  const { image, display, windows, cursor, mode, opts } = data;
  const t0 = performance.now();
  let bitmap, pixels;
  if (image.kind === 'raw') {
    const u8 = image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data);
    pixels = new Uint8ClampedArray(u8.buffer, u8.byteOffset, u8.byteLength);
    if (pixels[3] === 0) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    bitmap = await createImageBitmap(new ImageData(pixels, image.width, image.height));
  } else {
    const blob = new Blob([image.data], { type: 'image/png' });
    bitmap = await createImageBitmap(blob);
    const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(bitmap, 0, 0);
    pixels = tctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  }
  console.log('decode', Math.round(performance.now() - t0), 'ms');
  const cw = display.bounds.width, ch = display.bounds.height;
  S = {
    mode, opts: opts || {}, img: bitmap, pixels, W: bitmap.width, H: bitmap.height, cw, ch,
    r: bitmap.width / cw, windows: windows || [],
    phase: 'idle', sel: null, hover: null, mouse: { x: cursor.x, y: cursor.y }, drag: null,
    tool: null, shapes: [], undo: [], redo: [], selected: -1, draft: null,
    mosaicPix: null, mosaicLayer: null, mosaicDirty: false,
    rec: {
      format: (opts && opts.record && (opts.record.regionFormat || opts.record.format)) || 'mp4',
      systemAudio: !!(opts && opts.record && opts.record.systemAudio),
      mic: !!(opts && opts.record && opts.record.mic),
      camera: !!(opts && opts.present && opts.present.camera),
      quality: String((opts && opts.record && opts.record.quality) || '1080'),
      fps: Number((opts && opts.record && opts.record.fps) || 30),
    },
  };
  cv.width = S.W; cv.height = S.H;
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  updateHover();
  renderNow();
  document.body.classList.remove('hidden');
  updateMagnifier();
  setTimeout(() => api.send('overlay:painted', { ok: true }), 16);
}

// ------------------------------------------------------------------ 坐标与工具
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function norm(x1, y1, x2, y2) { return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }; }
function inRect(p, r, pad = 0) { return r && p.x >= r.x - pad && p.y >= r.y - pad && p.x <= r.x + r.w + pad && p.y <= r.y + r.h + pad; }
function evPt(e) { return { x: e.clientX, y: e.clientY }; }
function physSize(r) { return `${Math.round(r.w * S.r)} × ${Math.round(r.h * S.r)}`; }

function updateHover() {
  if (!S || S.phase !== 'idle') return;
  const p = S.mouse;
  let hit = null;
  for (const w of S.windows) { if (inRect(p, w)) { hit = w; break; } }
  S.hover = hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : { x: 0, y: 0, w: S.cw, h: S.ch };
}

function handleAt(p) {
  const s = S.sel; if (!s || S.phase !== 'selected') return null;
  const hs = [
    ['nw', s.x, s.y], ['n', s.x + s.w / 2, s.y], ['ne', s.x + s.w, s.y], ['e', s.x + s.w, s.y + s.h / 2],
    ['se', s.x + s.w, s.y + s.h], ['s', s.x + s.w / 2, s.y + s.h], ['sw', s.x, s.y + s.h], ['w', s.x, s.y + s.h / 2],
  ];
  for (const [n, x, y] of hs) if (Math.abs(p.x - x) <= 6 && Math.abs(p.y - y) <= 6) return n;
  // 边缘也可拖动（无工具时）
  if (!S.tool) {
    const t = 4;
    if (p.y >= s.y && p.y <= s.y + s.h) { if (Math.abs(p.x - s.x) <= t) return 'w'; if (Math.abs(p.x - s.x - s.w) <= t) return 'e'; }
    if (p.x >= s.x && p.x <= s.x + s.w) { if (Math.abs(p.y - s.y) <= t) return 'n'; if (Math.abs(p.y - s.y - s.h) <= t) return 's'; }
  }
  return null;
}
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

// ------------------------------------------------------------------ 渲染
let rafPending = false;
function render() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderNow(); }); }

function renderNow() {
  if (!S) return;
  const { r, cw, ch } = S;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, S.W, S.H);
  ctx.drawImage(S.img, 0, 0);
  ctx.setTransform(r, 0, 0, r, 0, 0);
  const sel = currentSel();
  if (sel) {
    if (S.mosaicDirty) rebuildMosaic();
    ctx.save();
    ctx.beginPath(); ctx.rect(sel.x, sel.y, sel.w, sel.h); ctx.clip();
    if (S.mosaicLayer && S.hasMosaic) ctx.drawImage(S.mosaicLayer, 0, 0, cw, ch);
    S.shapes.forEach((sh, i) => { if (sh.type !== 'mosaic' && !(S.editingIndex === i)) drawShape(ctx, sh); });
    if (S.draft && S.draft.type !== 'mosaic') drawShape(ctx, S.draft);
    if (S.selected >= 0 && S.shapes[S.selected]) drawSelection(ctx, S.shapes[S.selected]);
    ctx.restore();
  }
  // 遮罩
  ctx.fillStyle = 'rgba(8,8,12,0.52)';
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  const hole = sel || (S.phase === 'idle' ? S.hover : null);
  if (hole) ctx.rect(hole.x, hole.y, hole.w, hole.h);
  ctx.fill('evenodd');
  // 边框
  const lw = 1 / r * Math.max(1, Math.round(r));
  if (hole) {
    if (!sel) { ctx.fillStyle = 'rgba(124,124,255,0.08)'; ctx.fillRect(hole.x, hole.y, hole.w, hole.h); }
    ctx.strokeStyle = ACCENT;
    const bw = sel ? Math.max(lw, 1.5) : Math.max(lw, 2.5);
    ctx.lineWidth = bw;
    ctx.strokeRect(hole.x + bw / 2, hole.y + bw / 2, hole.w - bw, hole.h - bw);
  }
  if (sel && S.phase === 'selected' && !(S.drag && S.drag.type === 'create')) {
    const hr = 4;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5;
    const pts = [[sel.x, sel.y], [sel.x + sel.w / 2, sel.y], [sel.x + sel.w, sel.y], [sel.x + sel.w, sel.y + sel.h / 2],
      [sel.x + sel.w, sel.y + sel.h], [sel.x + sel.w / 2, sel.y + sel.h], [sel.x, sel.y + sel.h], [sel.x, sel.y + sel.h / 2]];
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  drawBrushCursor(ctx);
  // 尺寸标签
  const lab = sel || (S.phase === 'idle' ? S.hover : null);
  if (lab) {
    sizeLabel.textContent = physSize(lab);
    sizeLabel.style.display = 'block';
    let ly = lab.y - 24; if (ly < 2) ly = lab.y + 4;
    sizeLabel.style.left = clamp(lab.x, 2, cw - 110) + 'px';
    sizeLabel.style.top = ly + 'px';
  } else sizeLabel.style.display = 'none';
}

function currentSel() { return S.sel; }

// ------------------------------------------------------------------ 形状绘制
function drawShape(c, s) {
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  switch (s.type) {
    case 'rect': {
      const r = norm(s.x1, s.y1, s.x2, s.y2);
      c.strokeStyle = s.color; c.lineWidth = s.lw; c.lineJoin = 'miter';
      c.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'ellipse': {
      const r = norm(s.x1, s.y1, s.x2, s.y2);
      c.strokeStyle = s.color; c.lineWidth = s.lw;
      c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w / 2, 0.5), Math.max(r.h / 2, 0.5), 0, 0, Math.PI * 2); c.stroke();
      break;
    }
    case 'arrow': drawArrow(c, s.x1, s.y1, s.x2, s.y2, s.lw, s.color); break;
    case 'pen': case 'marker': {
      const pts = s.points; if (!pts.length) break;
      c.strokeStyle = s.color; c.lineWidth = s.lw;
      if (s.type === 'marker') { c.globalAlpha = 0.4; c.lineCap = 'square'; c.lineJoin = 'round'; }
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) c.lineTo(pts[0][0] + 0.1, pts[0][1] + 0.1);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      if (pts.length > 1) c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      c.stroke();
      break;
    }
    case 'text': {
      c.fillStyle = s.color; c.font = `${s.size}px ${FONT}`; c.textBaseline = 'top';
      const lines = s.text.split('\n');
      const lh = s.size * 1.25;
      // 浅色描边提升可读性
      lines.forEach((ln, i) => c.fillText(ln, s.x, s.y + i * lh + s.size * 0.1));
      break;
    }
    case 'number': {
      const rad = s.radius;
      c.fillStyle = s.color;
      c.beginPath(); c.arc(s.x, s.y, rad, 0, Math.PI * 2); c.fill();
      c.lineWidth = Math.max(1.5, rad / 8); c.strokeStyle = '#fff'; c.stroke();
      c.fillStyle = isLight(s.color) ? '#000' : '#fff';
      c.font = `bold ${Math.round(rad * 1.2)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.n), s.x, s.y + rad * 0.06);
      break;
    }
  }
  c.restore();
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}

function drawArrow(c, x1, y1, x2, y2, lw, color) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ang = Math.atan2(dy, dx);
  const headLen = Math.min(len * 0.9, 10 + lw * 3.4);
  const headHalf = headLen * 0.42;
  const shaftHalf = Math.max(1, lw * 0.75);
  const base = len - headLen;
  const pts = [[0, 0.3], [base + headLen * 0.12, shaftHalf], [base, headHalf], [len, 0], [base, -headHalf], [base + headLen * 0.12, -shaftHalf], [0, -0.3]];
  c.save();
  c.translate(x1, y1); c.rotate(ang);
  c.fillStyle = color; c.strokeStyle = color; c.lineWidth = 1; c.lineJoin = 'round';
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
  c.fill(); c.stroke();
  c.restore();
}

function shapeBox(s) {
  switch (s.type) {
    case 'rect': case 'ellipse': case 'arrow': {
      const r = norm(s.x1, s.y1, s.x2, s.y2); const p = (s.lw || 2) / 2 + 2; return { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 };
    }
    case 'pen': case 'marker': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of s.points) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
      const p = s.lw / 2 + 2; return { x: x1 - p, y: y1 - p, w: x2 - x1 + p * 2, h: y2 - y1 + p * 2 };
    }
    case 'text': {
      ctx.save(); ctx.font = `${s.size}px ${FONT}`;
      const lines = s.text.split('\n'); const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 4);
      ctx.restore();
      return { x: s.x - 3, y: s.y - 3, w: w + 6, h: lines.length * s.size * 1.25 + 6 };
    }
    case 'number': return { x: s.x - s.radius - 2, y: s.y - s.radius - 2, w: s.radius * 2 + 4, h: s.radius * 2 + 4 };
  }
  return null;
}

function drawSelection(c, s) {
  const b = shapeBox(s); if (!b) return;
  c.save();
  c.setLineDash([4 / S.r * Math.max(1, S.r), 3 / S.r * Math.max(1, S.r)]);
  c.lineWidth = 1 / S.r * Math.max(1, Math.round(S.r));
  c.strokeStyle = '#fff'; c.strokeRect(b.x, b.y, b.w, b.h);
  c.lineDashOffset = 4; c.strokeStyle = '#333'; c.strokeRect(b.x, b.y, b.w, b.h);
  c.restore();
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2 : 0; t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
}
function hitShape(p) {
  for (let i = S.shapes.length - 1; i >= 0; i--) {
    const s = S.shapes[i];
    if (s.type === 'mosaic') continue;
    const tol = Math.max(6, (s.lw || 0) / 2 + 3);
    if (s.type === 'rect') {
      const r = norm(s.x1, s.y1, s.x2, s.y2);
      const inOuter = inRect(p, r, tol), inInner = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol;
      if (inOuter && !inInner) return i;
    } else if (s.type === 'ellipse') {
      const r = norm(s.x1, s.y1, s.x2, s.y2); const rx = r.w / 2, ry = r.h / 2; if (rx < 1 || ry < 1) continue;
      const nx = (p.x - r.x - rx) / rx, ny = (p.y - r.y - ry) / ry; const d = Math.sqrt(nx * nx + ny * ny);
      if (Math.abs(d - 1) * Math.min(rx, ry) <= tol) return i;
    } else if (s.type === 'arrow') {
      if (distSeg(p, [s.x1, s.y1], [s.x2, s.y2]) <= tol + 2) return i;
    } else if (s.type === 'pen' || s.type === 'marker') {
      for (let k = 1; k < s.points.length; k++) if (distSeg(p, s.points[k - 1], s.points[k]) <= tol) return i;
      if (s.points.length === 1 && Math.hypot(p.x - s.points[0][0], p.y - s.points[0][1]) <= tol) return i;
    } else if (s.type === 'text' || s.type === 'number') {
      if (inRect(p, shapeBox(s))) return i;
    }
  }
  return -1;
}
function moveShape(s, dx, dy) {
  if ('x1' in s) { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
  if (s.points) s.points = s.points.map(([x, y]) => [x + dx, y + dy]);
  if (s.type === 'text' || s.type === 'number') { s.x += dx; s.y += dy; }
}

// ------------------------------------------------------------------ 马赛克 / 模糊
const BRUSH_MIN = 6, BRUSH_MAX = 200;
function fxKey(m) { return `${m.effect || 'pixel'}:${m.strength || 4}`; }
function effectCanvas(effect, strength) {
  S.fx = S.fx || {};
  const key = `${effect}:${strength}`;
  if (S.fx[key]) return S.fx[key];
  const c = new OffscreenCanvas(S.W, S.H);
  const g = c.getContext('2d');
  if (effect === 'blur') {
    // 高斯模糊：半径随强度增长；先铺一层原图避免边缘变透明
    const rad = Math.max(1, strength * 2.6 * S.r);
    g.drawImage(S.img, 0, 0);
    g.filter = `blur(${rad}px)`;
    g.drawImage(S.img, 0, 0);
    g.filter = 'none';
  } else {
    const block = Math.max(3, Math.round((3 + strength * 2.4) * S.r));
    const sw = Math.ceil(S.W / block), sh = Math.ceil(S.H / block);
    const small = new OffscreenCanvas(sw, sh);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'medium';
    sctx.drawImage(S.img, 0, 0, sw, sh);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, sw * block, sh * block);
  }
  S.fx[key] = c;
  return c;
}
function drawMosaicMask(l, m) {
  if (m.mode === 'rect') { const r = norm(m.x1, m.y1, m.x2, m.y2); l.fillRect(r.x, r.y, r.w, r.h); return; }
  l.lineWidth = m.lw; l.beginPath(); l.moveTo(m.points[0][0], m.points[0][1]);
  if (m.points.length === 1) l.lineTo(m.points[0][0] + 0.1, m.points[0][1]);
  for (let i = 1; i < m.points.length; i++) l.lineTo(m.points[i][0], m.points[i][1]);
  l.stroke();
}
function rebuildMosaic() {
  S.mosaicDirty = false;
  const list = S.shapes.filter((x) => x.type === 'mosaic');
  if (S.draft && S.draft.type === 'mosaic') list.push(S.draft);
  S.hasMosaic = list.length > 0;
  if (!S.hasMosaic) return;
  if (!S.mosaicLayer) { S.mosaicLayer = new OffscreenCanvas(S.W, S.H); S.mosaicTmp = new OffscreenCanvas(S.W, S.H); }
  const l = S.mosaicLayer.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, S.W, S.H);
  const t = S.mosaicTmp.getContext('2d');
  // 相邻且效果相同的笔画合并为一组，按顺序叠加
  let i = 0;
  while (i < list.length) {
    const key = fxKey(list[i]); let j = i;
    while (j < list.length && fxKey(list[j]) === key) j++;
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, S.W, S.H);
    t.setTransform(S.r, 0, 0, S.r, 0, 0);
    t.fillStyle = '#000'; t.strokeStyle = '#000'; t.lineCap = 'round'; t.lineJoin = 'round';
    for (let k = i; k < j; k++) drawMosaicMask(t, list[k]);
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-in';
    const [effect, strength] = key.split(':');
    t.drawImage(effectCanvas(effect, +strength), 0, 0);
    t.globalCompositeOperation = 'source-over';
    l.drawImage(S.mosaicTmp, 0, 0);
    i = j;
  }
}

// 笔刷类工具当前直径（CSS 像素）
function brushSize(tool) {
  if (tool === 'mosaic') return style.mosaic.mode === 'brush' ? style.mosaic.brush : 0;
  if (tool === 'pen' || tool === 'marker') return SIZES[tool][style[tool].size];
  return 0;
}
function drawBrushCursor(c) {
  if (!S || S.phase !== 'selected' || S.mode !== 'shot' || !S.tool) return;
  const d = brushSize(S.tool); if (!d) return;
  if (S.drag && S.drag.type !== 'draw') return;
  const flashing = S.sizeFlash && performance.now() - S.sizeFlash < 900;
  let p = S.mouse;
  if (!inRect(p, S.sel)) {
    if (!flashing) return;
    p = { x: S.sel.x + S.sel.w / 2, y: S.sel.y + S.sel.h / 2 };
  }
  const r = Math.max(d / 2, 1.5);
  c.save();
  c.lineWidth = 1 / S.r * Math.max(1, Math.round(S.r));
  c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke();
  c.beginPath(); c.arc(p.x, p.y, Math.max(r - c.lineWidth, 0.5), 0, Math.PI * 2);
  c.strokeStyle = 'rgba(255,255,255,0.95)'; c.stroke();
  if (S.tool === 'mosaic' && r > 8) {
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
  }
  if (S.sizeFlash && performance.now() - S.sizeFlash < 900) {
    c.font = `600 11px -apple-system, "Segoe UI", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
    const label = `${Math.round(d)} px`;
    const tw = c.measureText(label).width + 12;
    c.fillStyle = 'rgba(18,18,24,0.85)'; c.fillRect(p.x - tw / 2, p.y - r - 24, tw, 18);
    c.fillStyle = '#fff'; c.fillText(label, p.x, p.y - r - 9);
  }
  c.restore();
}
function adjustBrush(dir) {
  const t = S.tool; if (!t) return false;
  if (t === 'mosaic' && style.mosaic.mode === 'brush') {
    const cur = style.mosaic.brush;
    const step = Math.max(2, Math.round(cur * 0.12));
    style.mosaic.brush = clamp(cur + dir * step, BRUSH_MIN, BRUSH_MAX);
  } else if (SIZES[t] && style[t]) {
    style[t].size = clamp(style[t].size + dir, 0, SIZES[t].length - 1);
    applyStyleToSelected();
  } else return false;
  S.sizeFlash = performance.now();
  syncStyleControls();
  render(); setTimeout(render, 950);
  return true;
}

// ------------------------------------------------------------------ 撤销
// 没拿到键盘焦点时，主进程用全局快捷键转发 Enter / Ctrl+C
api.on('overlay:key', (k) => {
  if (!S || S.phase !== 'selected') return;
  if (k === 'Enter') { if (S.mode === 'record') startRecording(); else finish('copy'); }
  if (k === 'copy' && S.mode === 'shot') finish('copy');
});
function pushUndo() { S.undo.push(JSON.stringify(S.shapes)); S.redo = []; if (S.undo.length > 100) S.undo.shift(); refreshToolbarState(); }
function undo() {
  // 文字输入框还开着时先关掉（不提交），否则提交时会写到错的位置
  if (editor.style.display === 'block') { closeEditor(false); return; }
  if (!S.undo.length) return;
  S.drag = null; S.draft = null;
  S.redo.push(JSON.stringify(S.shapes)); S.shapes = JSON.parse(S.undo.pop()); S.selected = -1; S.mosaicDirty = true; render(); refreshToolbarState();
}
function redo() {
  if (editor.style.display === 'block') closeEditor(false);
  if (!S.redo.length) return;
  S.drag = null; S.draft = null;
  S.undo.push(JSON.stringify(S.shapes)); S.shapes = JSON.parse(S.redo.pop()); S.selected = -1; S.mosaicDirty = true; render(); refreshToolbarState();
}

// ------------------------------------------------------------------ 鼠标事件
cv.addEventListener('mousedown', (e) => {
  if (!S) return;
  closePicker();
  const p = evPt(e);
  S.mouse = p;
  if (e.button === 2) return; // 右键在 contextmenu 处理
  if (e.button !== 0) return;
  if (editor.style.display === 'block') { closeEditor(true); if (S.tool === 'text') return; }

  if (S.phase === 'idle') {
    S.drag = { type: 'pending', start: p };
    return;
  }
  if (S.phase !== 'selected') return;
  const sel = S.sel;
  const h = handleAt(p);
  if (h) { S.drag = { type: 'resize', handle: h, start: p, orig: { ...sel } }; hideUi(); return; }

  if (S.mode === 'shot' && inRect(p, sel)) {
    // 点到已有标注：选中并可拖动
    const hi = hitShape(p);
    if (hi >= 0 && (S.tool || true)) {
      const sh = S.shapes[hi];
      S.selected = hi;
      if (e.detail >= 2 && sh.type === 'text') { editText(hi); return; }
      S.drag = { type: 'moveShape', start: p, last: p, index: hi, moved: false };
      render();
      return;
    }
    S.selected = -1;
    if (S.tool) { startDraw(p, e); return; }
    if (e.detail >= 2) { finish('copy'); return; }
    S.drag = { type: 'move', start: p, orig: { ...sel } };
    return;
  }
  if (S.mode === 'record' && inRect(p, sel)) {
    S.drag = { type: 'move', start: p, orig: { ...sel } };
    return;
  }
  // 选区外：没有标注时允许重新框选
  if (!S.shapes.length) {
    S.phase = 'idle'; S.sel = null; S.tool = null; hideUi();
    S.drag = { type: 'pending', start: p };
    render();
  }
});

window.addEventListener('mousemove', (e) => {
  if (!S) return;
  const p = evPt(e);
  S.mouse = p;
  const d = S.drag;
  if (!d) {
    if (S.phase === 'idle') { updateHover(); render(); }
    else if (S.tool && brushSize(S.tool)) render();
    updateCursor(p);
    updateMagnifier();
    return;
  }
  if (d.type === 'pending') {
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3) {
      d.type = 'create';
      S.phase = 'creating';
    } else return;
  }
  if (d.type === 'create') {
    const x2 = clamp(p.x, 0, S.cw), y2 = clamp(p.y, 0, S.ch);
    S.sel = norm(d.start.x, d.start.y, x2, y2);
    render(); updateMagnifier();
    return;
  }
  if (d.type === 'move') {
    const o = d.orig;
    S.sel = { x: clamp(o.x + p.x - d.start.x, 0, S.cw - o.w), y: clamp(o.y + p.y - d.start.y, 0, S.ch - o.h), w: o.w, h: o.h };
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 2) { d.moved = true; hideUi(); }
    render();
    return;
  }
  if (d.type === 'resize') {
    const o = d.orig; let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    const px = clamp(p.x, 0, S.cw), py = clamp(p.y, 0, S.ch);
    if (d.handle.includes('w')) x1 = px; if (d.handle.includes('e')) x2 = px;
    if (d.handle.includes('n')) y1 = py; if (d.handle.includes('s')) y2 = py;
    S.sel = norm(x1, y1, x2, y2);
    render(); updateMagnifier();
    return;
  }
  if (d.type === 'moveShape') {
    if (!S.shapes[d.index]) { S.drag = null; return; }
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 2) { d.moved = true; pushUndo(); }
    if (d.moved) { moveShape(S.shapes[d.index], dx, dy); d.last = p; render(); }
    return;
  }
  if (d.type === 'draw') { continueDraw(p, e); return; }
});

window.addEventListener('mouseup', (e) => {
  if (!S || e.button !== 0) return;
  const d = S.drag; S.drag = null;
  if (!d) return;
  const p = evPt(e);
  if (d.type === 'pending') {
    // 单击：选中悬停的窗口/全屏
    S.sel = { ...(S.hover || { x: 0, y: 0, w: S.cw, h: S.ch }) };
    enterSelected();
    return;
  }
  if (d.type === 'create') {
    if (S.sel.w < 3 || S.sel.h < 3) { S.sel = { ...(S.hover || { x: 0, y: 0, w: S.cw, h: S.ch }) }; }
    enterSelected();
    return;
  }
  if (d.type === 'move' || d.type === 'resize') {
    if (S.sel.w < 2 || S.sel.h < 2) S.sel = d.orig;
    S.phase = 'selected'; showUi(); render(); updateMagnifier();
    return;
  }
  if (d.type === 'moveShape') { render(); return; }
  if (d.type === 'draw') { endDraw(p); return; }
});

cv.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!S) return;
  if (editor.style.display === 'block') { closeEditor(true); return; }
  if (S.phase === 'selected' || S.phase === 'creating') {
    if (S.tool || S.shapes.length) {
      // 第一次右键：取消工具；再次右键：重新选择
      if (S.tool) { S.tool = null; S.selected = -1; showUi(); render(); return; }
    }
    resetSelection();
    return;
  }
  cancel();
});

function resetSelection() {
  S.phase = 'idle'; S.sel = null; S.tool = null; S.shapes = []; S.undo = []; S.redo = []; S.selected = -1; S.mosaicDirty = true;
  hideUi(); updateHover(); render(); updateMagnifier();
}

function enterSelected() {
  S.sel = { x: Math.round(S.sel.x), y: Math.round(S.sel.y), w: Math.round(S.sel.w), h: Math.round(S.sel.h) };
  S.phase = 'selected';
  showUi(); render(); updateMagnifier(); updateCursor(S.mouse);
}

function updateCursor(p) {
  if (!S) return;
  let c = 'crosshair';
  if (S.phase === 'selected') {
    const h = handleAt(p);
    if (h) c = CURSORS[h];
    else if (inRect(p, S.sel)) {
      if (S.mode === 'shot' && hitShape(p) >= 0) c = 'move';
      else if (S.tool === 'text') c = 'text';
      else if (S.tool && brushSize(S.tool) >= 6) c = 'none';
      else if (S.tool) c = 'crosshair';
      else c = 'move';
    } else c = S.shapes.length ? 'default' : 'crosshair';
  }
  cv.style.cursor = c;
}

// ------------------------------------------------------------------ 绘制标注
function startDraw(p, e) {
  const t = S.tool; const st = style[t]; const sz = SIZES[t][st.size];
  const x = clamp(p.x, S.sel.x, S.sel.x + S.sel.w), y = clamp(p.y, S.sel.y, S.sel.y + S.sel.h);
  if (t === 'text') { openEditor(x, y); return; }
  if (t === 'number') {
    pushUndo();
    const n = S.shapes.filter((s) => s.type === 'number').reduce((m, s) => Math.max(m, s.n), 0) + 1;
    S.shapes.push({ type: 'number', x, y, n, radius: sz, color: st.color });
    S.selected = -1; render(); return;
  }
  if (t === 'mosaic') {
    const fx = { effect: st.effect, strength: st.strength };
    S.draft = st.mode === 'rect' ? { type: 'mosaic', mode: 'rect', x1: x, y1: y, x2: x, y2: y, ...fx } : { type: 'mosaic', mode: 'brush', lw: st.brush, points: [[x, y]], ...fx };
    S.mosaicDirty = true;
  } else if (t === 'pen' || t === 'marker') {
    S.draft = { type: t, color: st.color, lw: sz, points: [[x, y]] };
  } else {
    S.draft = { type: t, color: st.color, lw: sz, x1: x, y1: y, x2: x, y2: y };
  }
  S.drag = { type: 'draw', start: { x, y } };
  hideStyle();
  render();
}
function continueDraw(p, e) {
  const d = S.draft; if (!d) return;
  let x = p.x, y = p.y;
  if (d.points) {
    const last = d.points[d.points.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) >= 1.5) d.points.push([x, y]);
  } else {
    if (e.shiftKey) {
      const dx = x - d.x1, dy = y - d.y1;
      if (d.type === 'arrow') {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(dx, dy);
        x = d.x1 + Math.cos(ang) * len; y = d.y1 + Math.sin(ang) * len;
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dy)); x = d.x1 + Math.sign(dx || 1) * m; y = d.y1 + Math.sign(dy || 1) * m;
      }
    }
    d.x2 = x; d.y2 = y;
  }
  if (d.type === 'mosaic') S.mosaicDirty = true;
  render();
}
function endDraw() {
  const d = S.draft; S.draft = null;
  if (!d) return;
  let valid = true;
  if ('x1' in d) valid = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3;
  if (valid) { pushUndo(); S.shapes.push(d); }
  if (d.type === 'mosaic') S.mosaicDirty = true;
  showStyle(); render(); refreshToolbarState();
}

// ------------------------------------------------------------------ 文字
function openEditor(x, y, preset) {
  const st = style.text;
  const size = preset ? preset.size : SIZES.text[st.size];
  const color = preset ? preset.color : st.color;
  editor.dataset.x = x; editor.dataset.y = y; editor.dataset.size = size; editor.dataset.color = color;
  editor.value = preset ? preset.text : '';
  Object.assign(editor.style, {
    display: 'block', left: (x - 5) + 'px', top: (y - 3) + 'px', fontSize: size + 'px', color,
    maxWidth: (S.sel.x + S.sel.w - x + 4) + 'px',
  });
  autosizeEditor();
  setTimeout(() => editor.focus(), 0);
}
function autosizeEditor() {
  const size = +editor.dataset.size;
  ctx.save(); ctx.font = `${size}px ${FONT}`;
  const lines = editor.value.split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), size * 0.6);
  ctx.restore();
  editor.style.width = Math.ceil(w + size * 0.8 + 10) + 'px';
  editor.style.height = Math.ceil(lines.length * size * 1.25 + 8) + 'px';
}
editor.addEventListener('input', autosizeEditor);
editor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229) return; // 中文输入法组字中
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeEditor(true); }
});
editor.addEventListener('mousedown', (e) => e.stopPropagation());
function closeEditor(commit) {
  if (editor.style.display !== 'block') return;
  editor.style.display = 'none';
  const text = editor.value.replace(/\s+$/, '');
  const editing = S && S.editingIndex != null ? S.editingIndex : null;
  if (!S) return;
  if (commit && text) {
    const shape = { type: 'text', x: +editor.dataset.x, y: +editor.dataset.y, text, size: +editor.dataset.size, color: editor.dataset.color };
    pushUndo();
    if (editing != null) S.shapes[editing] = shape; else S.shapes.push(shape);
  } else if (editing != null && commit && !text) {
    pushUndo(); S.shapes.splice(editing, 1);
  }
  S.editingIndex = null; S.selected = -1;
  editor.blur();
  render();
}
function editText(i) {
  const s = S.shapes[i];
  S.editingIndex = i; S.selected = -1;
  openEditor(s.x, s.y, s);
  render();
}

// ------------------------------------------------------------------ 放大镜
function updateMagnifier() {
  const mag = $('mag');
  if (!S || !S.opts.magnifier || !(S.phase === 'idle' || S.phase === 'creating' || (S.drag && S.drag.type === 'resize'))) { mag.style.display = 'none'; return; }
  const p = S.mouse;
  const px = clamp(Math.floor(p.x * S.r), 0, S.W - 1), py = clamp(Math.floor(p.y * S.r), 0, S.H - 1);
  const n = 17; // 物理像素范围
  mctx.imageSmoothingEnabled = false;
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, 272, 272);
  mctx.drawImage(S.img, px - (n >> 1), py - (n >> 1), n, n, 0, 0, 272, 272);
  const cell = 272 / n;
  mctx.fillStyle = 'rgba(124,124,255,0.38)';
  mctx.fillRect(0, (n >> 1) * cell, 272, cell); mctx.fillRect((n >> 1) * cell, 0, cell, 272);
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.strokeRect((n >> 1) * cell, (n >> 1) * cell, cell, cell);
  const i = (py * S.W + px) * 4;
  const r = S.pixels[i], g = S.pixels[i + 1], b = S.pixels[i + 2];
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  S.color = { hex, rgb: `${r}, ${g}, ${b}` };
  $('magPos').textContent = `${px}, ${py}`;
  $('magHex').textContent = hex;
  $('magRgb').textContent = `RGB ${r}, ${g}, ${b}`;
  $('magSwatch').style.background = hex;
  let mx = p.x + 18, my = p.y + 22;
  const mw = 136, mh = 205;
  if (mx + mw > S.cw) mx = p.x - mw - 14;
  if (my + mh > S.ch) my = p.y - mh - 14;
  mag.style.left = mx + 'px'; mag.style.top = my + 'px'; mag.style.display = 'block';
}

// ------------------------------------------------------------------ 工具栏
function btn(icon, title, onClick, cls = '') {
  const b = document.createElement('button');
  b.className = 'tb ' + cls; b.innerHTML = icon; b.title = title;
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}
function sep() { const s = document.createElement('div'); s.className = 'sep'; return s; }
const mod = isMac ? '⌘' : 'Ctrl+';

function buildToolbar() {
  toolbar.innerHTML = '';
  if (S.mode === 'record') return buildRecordToolbar();
  const tools = [
    ['rect', I.rect, tx('矩形 (R)  按住 Shift 画正方形')], ['ellipse', I.ellipse, tx('椭圆 (E)')], ['arrow', I.arrow, tx('箭头 (A)')],
    ['pen', I.pen, tx('画笔 (P)')], ['marker', I.marker, tx('荧光笔 (H)')], ['mosaic', I.mosaic, tx('马赛克 (M)')],
    ['text', I.text, tx('文字 (T)')], ['number', I.number, tx('序号 (N)')],
  ];
  for (const [t, icon, title] of tools) {
    const b = btn(icon, title, () => selectTool(S.tool === t ? null : t));
    b.dataset.tool = t;
    toolbar.appendChild(b);
  }
  toolbar.appendChild(sep());
  const u = btn(I.undo, tx('撤销 ({mod}Z)', { mod }), undo); u.id = 'tbUndo'; toolbar.appendChild(u);
  const r = btn(I.redo, tx('重做 ({mod}Y)', { mod }), redo); r.id = 'tbRedo'; toolbar.appendChild(r);
  toolbar.appendChild(sep());
  toolbar.appendChild(btn(I.record, tx('录制这个区域'), () => switchToRecord(), 'rec'));
  toolbar.appendChild(btn(I.pin, tx('钉在屏幕上（贴图）'), () => finish('pin')));
  toolbar.appendChild(btn(I.save, tx('保存到文件 ({mod}S)', { mod }), () => finish('save')));
  toolbar.appendChild(sep());
  toolbar.appendChild(btn(I.close, tx('退出 (Esc)'), cancel, 'cancel'));
  const done = btn(`${I.ok}<span>${tx('完成')}</span>`, tx('复制到剪贴板 (Enter / 双击)'), () => finish('copy'), 'done');
  toolbar.appendChild(done);
  refreshToolbarState();
}

const QUAL_ORDER = ['source', '2160', '1440', '1080', '720'];
const QUAL_LABEL = { source: tx('原画'), 2160: '4K', 1440: '2K', 1080: '1080p', 720: '720p' };
const QUAL_BOX = { 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720], source: [1e9, 1e9] };
// 按录制核心同样的规则算出实际输出尺寸（不会超过选区本身的物理像素）
function recOutSize(q) {
  const sw = Math.max(2, Math.round(S.sel.w * S.r)), sh = Math.max(2, Math.round(S.sel.h * S.r));
  const [bl, bs] = QUAL_BOX[q] || QUAL_BOX[1080];
  const k = Math.min(1, bl / Math.max(sw, sh), bs / Math.min(sw, sh));
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return [even(sw * k), even(sh * k)];
}
function closePicker() { const m = $('picker'); if (m) m.remove(); }
function openPicker(anchor, items, current, onPick) {
  if ($('picker') && $('picker').dataset.for === anchor.id) { closePicker(); return; }
  closePicker();
  const m = document.createElement('div'); m.id = 'picker'; m.className = 'picker glass'; m.dataset.for = anchor.id;
  for (const it of items) {
    const b = document.createElement('button'); b.dataset.value = it.value;
    b.className = String(it.value) === String(current) ? 'on' : '';
    b.innerHTML = `<b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}`;
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { closePicker(); onPick(it.value); });
    m.appendChild(b);
  }
  m.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
  let top = r.top - mh - 6; if (top < 4) top = r.bottom + 6;
  m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - mw - 4)) + 'px';
  m.style.top = top + 'px';
}
function buildRecordToolbar() {
  const rcfg = S.opts.record || {};
  const seg = document.createElement('div'); seg.className = 'seg';
  for (const f of ['mp4', 'gif']) {
    const b = document.createElement('button'); b.textContent = f.toUpperCase(); b.dataset.fmt = f;
    b.className = S.rec.format === f ? 'on' : '';
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { S.rec.format = f; buildToolbar(); positionUi(); });
    seg.appendChild(b);
  }
  toolbar.appendChild(seg);
  const audioOk = S.rec.format === 'mp4';
  const sys = document.createElement('button'); sys.className = 'tog' + (S.rec.systemAudio && audioOk ? ' on' : '');
  sys.innerHTML = `${I.speaker}<span>${tx('系统声音#tb')}</span>`; sys.title = tx('GIF 不含声音');
  sys.disabled = !audioOk; if (!audioOk) sys.style.opacity = .4;
  sys.addEventListener('mousedown', (e) => e.stopPropagation());
  sys.addEventListener('click', () => { S.rec.systemAudio = !S.rec.systemAudio; buildToolbar(); positionUi(); });
  const mic = document.createElement('button'); mic.className = 'tog' + (S.rec.mic && audioOk ? ' on' : '');
  mic.innerHTML = `${I.mic}<span>${tx('麦克风#tb')}</span>`; mic.disabled = !audioOk; if (!audioOk) mic.style.opacity = .4;
  mic.addEventListener('mousedown', (e) => e.stopPropagation());
  mic.addEventListener('click', () => { S.rec.mic = !S.rec.mic; buildToolbar(); positionUi(); });
  // 摄像头圆窗（MP4 / GIF 都可以，圆窗本身就是屏幕上的窗口，会被一起录进去）
  const camb = document.createElement('button'); camb.className = 'tog' + (S.rec.camera ? ' on' : ''); camb.id = 'togCam';
  camb.innerHTML = `${I.camera}<span>${tx('摄像头#tb')}</span>`; camb.title = tx('在录制区域右下角显示摄像头画面（可拖动）');
  camb.addEventListener('mousedown', (e) => e.stopPropagation());
  camb.addEventListener('click', () => { S.rec.camera = !S.rec.camera; buildToolbar(); positionUi(); });
  toolbar.appendChild(sys); toolbar.appendChild(mic); toolbar.appendChild(camb);
  if (audioOk && S.rec.systemAudio && S.rec.mic) {
    // 系统声音 + 麦克风同时开：不戴耳机的话，喇叭的声音会被麦克风再录一次（回音 / 声音发闷）
    const w = document.createElement('span'); w.className = 'recwarn'; w.id = 'recWarn';
    w.innerHTML = `${I.headset}<span>${tx('建议戴耳机')}</span>`;
    w.title = tx('同时录系统声音和麦克风时，喇叭放出的声音会被麦克风再录一次，听起来像回音。\n戴耳机录就不会有这个问题。只想录电脑里的声音的话，关掉麦克风即可。');
    toolbar.appendChild(w);
  }
  if (S.rec.format === 'gif') {
    const info = document.createElement('span'); info.className = 'recinfo';
    info.textContent = `GIF · ${rcfg.gifFps || 12}fps`;
    toolbar.appendChild(info);
  } else {
    // 分辨率 / 帧率可以直接点开选择（选的结果会记住，和 设置 → 录屏 是同一个设置）
    const [ow, oh] = recOutSize(S.rec.quality);
    const qb = document.createElement('button'); qb.className = 'pick'; qb.id = 'pickQuality';
    qb.innerHTML = `<b>${QUAL_LABEL[S.rec.quality] || '1080p'}</b><small>${ow}×${oh}</small><i>▾</i>`;
    qb.title = tx('录制分辨率（点击选择）');
    qb.addEventListener('mousedown', (e) => e.stopPropagation());
    qb.addEventListener('click', () => openPicker(qb, QUAL_ORDER.map((q) => {
      const [w, h] = recOutSize(q); return { value: q, label: QUAL_LABEL[q], sub: `${w}×${h}` };
    }), S.rec.quality, (v) => { S.rec.quality = v; buildToolbar(); positionUi(); }));
    const fb = document.createElement('button'); fb.className = 'pick'; fb.id = 'pickFps';
    fb.innerHTML = `<b>${S.rec.fps} fps</b><i>▾</i>`; fb.title = tx('帧率（点击选择）');
    fb.addEventListener('mousedown', (e) => e.stopPropagation());
    fb.addEventListener('click', () => openPicker(fb, [24, 30, 60].map((f) => ({ value: f, label: `${f} fps`, sub: f === 60 ? tx('更流畅，文件更大') : (f === 30 ? tx('推荐') : '') })),
      S.rec.fps, (v) => { S.rec.fps = v; buildToolbar(); positionUi(); }));
    toolbar.appendChild(qb); toolbar.appendChild(fb);
  }
  toolbar.appendChild(sep());
  toolbar.appendChild(btn(I.close, tx('取消 (Esc)'), cancel, 'cancel'));
  const start = document.createElement('button'); start.className = 'startrec'; start.innerHTML = `<i></i>${tx('开始录制')}`;
  start.addEventListener('mousedown', (e) => e.stopPropagation());
  start.addEventListener('click', startRecording);
  toolbar.appendChild(start);
}

function refreshToolbarState() {
  if (!S || S.mode !== 'shot') return;
  toolbar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
  const u = $('tbUndo'), r = $('tbRedo');
  if (u) u.disabled = !S.undo.length; if (r) r.disabled = !S.redo.length;
}

function selectTool(t) {
  closeEditor(true);
  S.tool = t; S.selected = -1;
  refreshToolbarState(); showStyle(); render(); updateCursor(S.mouse);
}

function slider(label, min, max, value, onInput, fmt, key) {
  const wrap = document.createElement('label'); wrap.className = 'sl'; wrap.dataset.key = key;
  const name = document.createElement('span'); name.className = 'sl-name'; name.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = 1; r.value = value;
  const val = document.createElement('span'); val.className = 'sl-val'; val.textContent = fmt(value);
  const paint = () => { const pct = ((r.value - min) / (max - min)) * 100; r.style.setProperty('--p', pct + '%'); };
  paint();
  r.addEventListener('mousedown', (e) => e.stopPropagation());
  r.addEventListener('input', () => { const v = +r.value; val.textContent = fmt(v); paint(); onInput(v); });
  r.addEventListener('keydown', (e) => e.stopPropagation());
  r._set = (v) => { r.value = v; val.textContent = fmt(v); paint(); };
  wrap.append(name, r, val);
  return wrap;
}
function syncStyleControls() {
  if (!S || !S.tool) return;
  if (S.tool === 'mosaic') {
    const w = stylebar.querySelector('[data-key="brush"] input'); if (w) w._set(style.mosaic.brush);
  } else {
    stylebar.querySelectorAll('[data-size-idx]').forEach((b) => b.classList.toggle('on', +b.dataset.sizeIdx === style[S.tool].size));
  }
}

function showStyle() {
  stylebar.innerHTML = '';
  if (!S || !S.tool || S.mode !== 'shot' || S.phase !== 'selected') { stylebar.classList.remove('show'); return; }
  const t = S.tool; const st = style[t];
  if (t === 'mosaic') {
    for (const [m, icon, title] of [['brush', I.brush, tx('涂抹')], ['rect', I.box, tx('框选')]]) {
      const b = btn(icon, title, () => { st.mode = m; showStyle(); render(); }); if (st.mode === m) b.classList.add('active'); stylebar.appendChild(b);
    }
    stylebar.appendChild(sep());
    const seg = document.createElement('div'); seg.className = 'seg';
    for (const [e, label] of [['pixel', tx('马赛克')], ['blur', tx('模糊')]]) {
      const b = document.createElement('button'); b.textContent = label; b.className = st.effect === e ? 'on' : '';
      b.addEventListener('mousedown', (ev) => ev.stopPropagation());
      b.addEventListener('click', () => { st.effect = e; showStyle(); });
      seg.appendChild(b);
    }
    stylebar.appendChild(seg);
    stylebar.appendChild(sep());
    if (st.mode === 'brush') stylebar.appendChild(slider(tx('大小'), BRUSH_MIN, BRUSH_MAX, st.brush, (v) => { st.brush = v; S.sizeFlash = performance.now(); render(); clearTimeout(S.flashT); S.flashT = setTimeout(render, 950); }, (v) => `${v}px`, 'brush'));
    stylebar.appendChild(slider(st.effect === 'blur' ? tx('模糊') : tx('颗粒'), 1, 10, st.strength, (v) => { st.strength = v; }, (v) => String(v), 'strength'));
  }
  if (t !== 'mosaic') {
    SIZES[t].forEach((v, i) => {
      const b = document.createElement('button');
      if (t === 'text') { b.className = 'sz txt' + (st.size === i ? ' on' : ''); b.textContent = [tx('小'), tx('中'), tx('大')][i]; }
      else { b.className = 'sz' + (st.size === i ? ' on' : ''); const d = [4, 7, 11][i]; b.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`; }
      b.title = [tx('小#t'), tx('中#t'), tx('大#t')][i] + (brushSize(t) ? tx('（滚轮或 [ ] 调整）') : '');
      b.dataset.sizeIdx = i;
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', () => { st.size = i; applyStyleToSelected(); showStyle(); });
      stylebar.appendChild(b);
    });
  }
  if (t !== 'mosaic') {
    stylebar.appendChild(sep());
    const cur = document.createElement('div'); cur.className = 'curColor'; cur.style.background = st.color; stylebar.appendChild(cur);
    const grid = document.createElement('div'); grid.className = 'colors';
    for (const c of COLORS) {
      const s = document.createElement('div'); s.className = 'sw' + (c === st.color ? ' on' : ''); s.style.background = c; s.title = c;
      s.addEventListener('mousedown', (e) => e.stopPropagation());
      s.addEventListener('click', () => { st.color = c; applyStyleToSelected(); showStyle(); if (editor.style.display === 'block') { editor.style.color = c; editor.dataset.color = c; editor.focus(); } });
      grid.appendChild(s);
    }
    stylebar.appendChild(grid);
  }
  stylebar.classList.add('show');
  positionUi();
}

function applyStyleToSelected() {
  if (S.selected < 0) {
    if (editor.style.display === 'block' && S.tool === 'text') {
      const size = SIZES.text[style.text.size]; editor.dataset.size = size; editor.style.fontSize = size + 'px'; autosizeEditor(); editor.focus();
    }
    return;
  }
  const s = S.shapes[S.selected]; if (!s || s.type !== S.tool) return;
  pushUndo();
  const st = style[S.tool];
  if (s.color) s.color = st.color;
  if (s.type === 'text') s.size = SIZES.text[st.size];
  else if (s.type === 'number') s.radius = SIZES.number[st.size];
  else if (s.lw) s.lw = SIZES[s.type][st.size];
  render();
}

function hideStyle() { stylebar.classList.remove('show'); }
function hideUi() { closePicker(); toolbar.classList.remove('show'); stylebar.classList.remove('show'); }
function showUi() {
  if (!S || S.phase !== 'selected') return;
  buildToolbar();
  toolbar.classList.add('show');
  showStyle();
  positionUi();
}

function positionUi() {
  if (!S || !S.sel) return;
  const sel = S.sel; const gap = 8;
  const tw = toolbar.offsetWidth, th = toolbar.offsetHeight;
  const sw = stylebar.classList.contains('show') ? stylebar.offsetWidth : 0;
  const sh = stylebar.classList.contains('show') ? stylebar.offsetHeight + 6 : 0;
  let x = sel.x + sel.w - tw;
  let y = sel.y + sel.h + gap; let below = true;
  if (y + th + sh > S.ch - 4) {
    y = sel.y - gap - th; below = false;
    if (y - sh < 4) { y = sel.y + sel.h - th - gap; below = true; if (y < 4) y = 4; }
  }
  x = clamp(x, 4, S.cw - tw - 4);
  toolbar.style.left = x + 'px'; toolbar.style.top = y + 'px';
  if (sw) {
    const btnEl = S.tool ? toolbar.querySelector(`[data-tool="${S.tool}"]`) : null;
    let sx = btnEl ? x + btnEl.offsetLeft - 6 : x;
    sx = clamp(sx, 4, S.cw - sw - 4);
    const sy = below ? y + th + 6 : y - sh;
    stylebar.style.left = sx + 'px'; stylebar.style.top = sy + 'px';
  }
}

// ------------------------------------------------------------------ 键盘
window.addEventListener('keydown', (e) => {
  if (!S) return;
  const k = e.key;
  const ctl = e.ctrlKey || e.metaKey;
  if (k === 'Escape') { e.preventDefault(); cancel(); return; }
  if (k === 'Enter') { if (S.phase === 'selected') { e.preventDefault(); if (S.mode === 'record') startRecording(); else finish('copy'); } return; }
  if (ctl && (k === 'c' || k === 'C')) {
    if (S.phase === 'selected' && S.mode === 'shot') { e.preventDefault(); finish('copy'); }
    else if (S.color) copyColor();
    return;
  }
  if (ctl && (k === 's' || k === 'S')) { if (S.phase === 'selected' && S.mode === 'shot') { e.preventDefault(); finish('save'); } return; }
  if (ctl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctl && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (ctl && (k === 'a' || k === 'A')) { e.preventDefault(); if (!S.shapes.length) { S.sel = { x: 0, y: 0, w: S.cw, h: S.ch }; enterSelected(); } return; }
  if ((k === 'Delete' || k === 'Backspace') && S.selected >= 0) { S.drag = null; pushUndo(); S.shapes.splice(S.selected, 1); S.selected = -1; S.mosaicDirty = true; render(); return; }
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
    const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
    if (S.phase === 'selected' && S.selected >= 0) { pushUndo(); moveShape(S.shapes[S.selected], dx, dy); render(); return; }
    if (S.phase === 'selected' && !S.shapes.length) {
      if (ctl) { S.sel.w = clamp(S.sel.w + dx, 2, S.cw - S.sel.x); S.sel.h = clamp(S.sel.h + dy, 2, S.ch - S.sel.y); }
      else { S.sel.x = clamp(S.sel.x + dx, 0, S.cw - S.sel.w); S.sel.y = clamp(S.sel.y + dy, 0, S.ch - S.sel.h); }
      positionUi(); render();
    }
    return;
  }
  if (!ctl && (k === '[' || k === ']') && S.phase === 'selected') { adjustBrush(k === ']' ? 1 : -1); return; }
  if (!ctl && !e.altKey && (k === 'c' || k === 'C') && S.phase !== 'selected') { copyColor(); return; }
  if (!ctl && !e.altKey && S.phase === 'selected' && S.mode === 'shot' && TOOL_KEYS[k.toLowerCase()]) {
    const t = TOOL_KEYS[k.toLowerCase()]; selectTool(S.tool === t ? null : t); return;
  }
});

window.addEventListener('wheel', (e) => {
  if (!S || S.phase !== 'selected' || !S.tool || S.drag) return;
  if (e.target !== cv) return;
  e.preventDefault();
  adjustBrush(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

function copyColor() {
  if (!S || !S.color) return;
  api.send('overlay:copy-text', S.color.hex);
  toast(tx('已复制颜色 {hex}', { hex: S.color.hex }));
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = 'none'), 1200); }

// ------------------------------------------------------------------ 输出
function cancel() { closeEditor(false); hideUi(); api.send('overlay:cancel'); }

function exportCanvas() {
  const sel = S.sel; const r = S.r;
  const sx = clamp(Math.round(sel.x * r), 0, S.W - 1), sy = clamp(Math.round(sel.y * r), 0, S.H - 1);
  const w = Math.max(1, Math.min(S.W, Math.round((sel.x + sel.w) * r)) - sx), h = Math.max(1, Math.min(S.H, Math.round((sel.y + sel.h) * r)) - sy);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const o = out.getContext('2d');
  o.drawImage(S.img, sx, sy, w, h, 0, 0, w, h);
  o.setTransform(r, 0, 0, r, -sx, -sy);
  if (S.mosaicDirty) rebuildMosaic();
  if (S.hasMosaic && S.mosaicLayer) o.drawImage(S.mosaicLayer, 0, 0, S.cw, S.ch);
  for (const sh of S.shapes) if (sh.type !== 'mosaic') drawShape(o, sh);
  return out;
}

let pngWorker = null, pngSeq = 0;
const pngWait = new Map();
function encodePng(canvas) {
  return new Promise((resolve, reject) => {
    (async () => {
      if (!pngWorker) {
        pngWorker = new Worker('png-worker.js');
        pngWorker.onmessage = (e) => {
          const w = pngWait.get(e.data.id); if (!w) return;
          pngWait.delete(e.data.id);
          if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.png);
        };
        pngWorker.onerror = (e) => { for (const w of pngWait.values()) w.reject(new Error(e.message || 'worker error')); pngWait.clear(); pngWorker = null; };
      }
      const bitmap = await createImageBitmap(canvas);
      const id = ++pngSeq;
      pngWait.set(id, { resolve, reject });
      pngWorker.postMessage({ id, bitmap }, [bitmap]);
      setTimeout(() => { if (pngWait.has(id)) { pngWait.delete(id); reject(new Error('png worker timeout')); } }, 6000);
    })().catch(reject);
  });
}
let finishing = false;
async function finish(action) {
  if (!S || !S.sel || finishing) return;
  closeEditor(true);
  finishing = true;
  try {
    S.selected = -1;
    const out = exportCanvas();
    // PNG 在 Worker 线程编码（canvas.toBlob 依赖界面线程空闲，在无显卡加速的电脑上固定卡约 1 秒）
    let payload;
    try { payload = { png: await encodePng(out) }; } catch (e) {
      console.warn('png worker failed, fallback to raw pixels', e && e.message);
      const img = out.getContext('2d').getImageData(0, 0, out.width, out.height);
      payload = { rgba: img.data.buffer, width: out.width, height: out.height };
    }
    if (action !== 'save') hideUi();
    await api.invoke('overlay:finish', { action, ...payload, rect: { ...S.sel } });
  } catch (e) { console.error(e); toast(tx('导出失败：') + e.message); }
  finishing = false;
}

function switchToRecord() {
  closeEditor(true);
  // 录屏模式不带标注：撤销记录一起清掉，否则 Ctrl+Z 会把标注找回来
  S.mode = 'record'; S.tool = null; S.selected = -1; S.shapes = []; S.undo = []; S.redo = []; S.hasMosaic = false; S.mosaicDirty = true;
  showUi(); render();
}

function startRecording() {
  if (!S || !S.sel) return;
  const sel = S.sel;
  if (sel.w < 32 || sel.h < 32) { toast(tx('录制区域太小，至少 32 × 32')); return; }
  const audioOk = S.rec.format === 'mp4';
  hideUi();
  api.send('overlay:record', {
    rect: { x: sel.x, y: sel.y, w: sel.w, h: sel.h },
    format: S.rec.format,
    systemAudio: audioOk && S.rec.systemAudio,
    mic: audioOk && S.rec.mic,
    camera: !!S.rec.camera,
    quality: S.rec.quality,
    fps: S.rec.fps,
  });
}

window.addEventListener('blur', () => { /* 保持状态 */ });
// 音效
const SND = {};
api.on('overlay:sound', (name, vol) => {
  try {
    if (!/^[a-z_]+$/.test(name)) return;
    const a = (SND[name] = SND[name] || new Audio(`../../assets/sounds/${name}.wav`));
    a.volume = vol; a.currentTime = 0; a.play().catch(() => {});
  } catch {}
});
api.send('overlay:loaded');
