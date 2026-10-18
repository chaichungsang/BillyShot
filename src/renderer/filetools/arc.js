'use strict';
// 动作弧。几何由主进程算好后传进来；这个文件只负责画和点。
const $ = (id) => document.getElementById(id);
const tr = (s) => (s && typeof tx === 'function' ? tx(s) : (s || ''));

const GLYPH = {
  'image.convert': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h8M10 3.5 12.5 6 10 8.5M14 12H6M8 9.5 5.5 12 8 14.5"/></svg>',
  'image.compress': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"><path d="M5 3v4M9 3v4M13 3v4M4 9h10M6 9l3 5 3-5"/></svg>',
  'image.resize': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"><path d="M4 7V4h3M14 7V4h-3M4 11v3h3M14 11v3h-3"/></svg>',
  'video.mp4': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6"><rect x="2.5" y="4" width="9" height="10" rx="1.5"/><path d="M11.5 7.5 15.5 5.5v7l-4-2"/></svg>',
  'video.compress': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"><path d="M4 5h10M4 13h10M7 5l2 3 2-3M7 13l2-3 2 3"/></svg>',
  'video.trim': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"><path d="M6 3v12M12 3v12M3 6h3M12 6h3M3 12h3M12 12h3"/></svg>',
  'video.gif': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="13" height="10" rx="1.4"/><path d="M6 4v10M12 4v10M2.5 7.2h3.5M12 7.2h3.5M2.5 10.8h3.5M12 10.8h3.5"/></svg>',
  'pdf.make': '<svg viewBox="0 0 18 18" fill="none" stroke="#E8C97A" stroke-width="1.6"><path d="M5 2.5h5l3 3V15.5H5z"/><path d="M10 2.5V6h3"/></svg>',
};

let state = null;
let active = 0;
let extraTimer = null;

function polar(angle, r) {
  const a = (angle * Math.PI) / 180;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function fillTip(title, detail) {
  const tip = $('tip');
  tip.innerHTML = '';
  if (title) { const b = document.createElement('b'); b.textContent = tr(title); tip.appendChild(b); }
  if (detail) { const s = document.createElement('span'); s.textContent = tr(detail); tip.appendChild(s); }
  tip.hidden = false;
  return tip;
}
function showTip(x, y, title, detail) {
  if (!title && !detail) { $('tip').hidden = true; return; }
  const tip = fillTip(title, detail);
  tip.style.left = Math.max(8, x + 18) + 'px';
  tip.style.top = Math.max(8, y - 8) + 'px';
}

function hideTip() { $('tip').hidden = true; }

function renderArc(payload) {
  state = payload;
  const stage = $('stage');
  const keys = payload.model.keys;
  const hub = $('hub');
  hub.hidden = false;
  hub.style.left = payload.hubx + 'px';
  hub.style.top = payload.huby + 'px';
  hub.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = payload.badge || (payload.model.group === 'video' ? 'MOV' : payload.model.group === 'pdf' ? 'PDF' : 'PNG');
  const sm = document.createElement('small');
  sm.textContent = payload.sub || '';
  hub.appendChild(b); hub.appendChild(sm);

  const svg = $('spokes');
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  const arc = keys.length > 1 ? arcPath(payload) : '';
  const lines = keys.map((k, i) => {
    const p = polar(payload.angles[i], payload.radius);
    const x2 = payload.hubx + p.x;
    const y2 = payload.huby + p.y;
    const hot = i === active;
    return `<line x1="${payload.hubx}" y1="${payload.huby}" x2="${x2}" y2="${y2}" stroke="${hot ? 'rgba(232,201,122,.85)' : 'rgba(212,168,75,.28)'}" stroke-width="1" ${hot ? '' : 'stroke-dasharray="2 3"'} />`;
  }).join('');
  svg.innerHTML = arc + lines;

  const box = $('keys');
  box.innerHTML = '';
  keys.forEach((k, i) => {
    const p = polar(payload.angles[i], payload.radius);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key pop' + (k.grey ? ' grey' : '') + (k.dashed ? ' dashed' : '') + (i === active ? ' on' : '');
    btn.style.left = (payload.hubx + p.x) + 'px';
    btn.style.top = (payload.huby + p.y) + 'px';
    btn.style.animationDelay = (i * 20) + 'ms';
    btn.dataset.index = String(i);
    const face = document.createElement('span');
    face.className = 'face';
    face.innerHTML = `<span class="num">${k.slot}</span><span class="glyph">${GLYPH[k.action] || ''}</span>`;
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = tr(k.label);
    btn.appendChild(face); btn.appendChild(cap);
    if (k.dashed) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ring.setAttribute('class', 'dash');
      ring.setAttribute('viewBox', '0 0 76 76');
      ring.innerHTML = '<circle cx="38" cy="38" r="37" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-dasharray="2.2 3.2"/>';
      btn.appendChild(ring);
    }
    btn.addEventListener('mouseenter', () => focusKey(i, true));
    btn.addEventListener('focus', () => focusKey(i, true));
    btn.addEventListener('click', (e) => { e.stopPropagation(); activate(i); });
    box.appendChild(btn);
  });
  if (payload.forceExtra || payload.hoverKey != null) focusKey(payload.hoverKey || 0, false);
  const warn = $('warn');
  if (payload.warning) { warn.hidden = false; warn.textContent = tr(payload.warning); }
  else warn.hidden = true;
  if (payload.tipId) showPresetTip(payload.tipId);
}

function arcPath(payload) {
  const a0 = payload.angles[0];
  const a1 = payload.angles[payload.angles.length - 1];
  const p0 = polar(a0, payload.radius);
  const p1 = polar(a1, payload.radius);
  const x0 = payload.hubx + p0.x, y0 = payload.huby + p0.y;
  const x1 = payload.hubx + p1.x, y1 = payload.huby + p1.y;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `<path d="M${x0},${y0} A${payload.radius},${payload.radius} 0 ${large} 1 ${x1},${y1}" fill="none" stroke="rgba(212,168,75,.28)" stroke-width="1"/>`;
}

function focusKey(i, fromHover) {
  if (!state) return;
  active = i;
  document.querySelectorAll('.key').forEach((el, n) => el.classList.toggle('on', n === i));
  const k = state.model.keys[i];
  clearTimeout(extraTimer);
  const delay = state.forceExtra || !fromHover ? 0 : 300;
  if (delay === 0) renderExtra();
  else extraTimer = setTimeout(renderExtra, delay);
  if (k && (k.reason || k.detail)) {
    const el = document.querySelectorAll('.key')[i];
    const r = el.getBoundingClientRect();
    showTip(r.right, r.top, k.reason, k.detail);
  } else if (!fromHover) hideTip();
  else if (!(k && k.reason)) hideTip();
}

function renderExtra() {
  const host = $('extra');
  host.innerHTML = '';
  if (!state) return;
  const k = state.model.keys[active];
  if (!k) return;
  const btn = document.querySelectorAll('.key')[active];
  if (!btn) return;
  const rect = { x: parseFloat(btn.style.left), y: parseFloat(btn.style.top) };
  if (k.action === 'image.resize' && (k.pills || k.custom)) {
    const col = document.createElement('div');
    col.className = 'col';
    col.style.left = rect.x + 'px';
    col.style.top = '0px';
    col.style.transform = 'translateX(-50%)';
    const items = [...(k.pills || [])];
    if (k.custom) items.push(k.custom);
    items.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sub' + (p.grey ? ' grey' : '');
      b.textContent = tr(p.label);
      b.disabled = !!p.grey;
      b.addEventListener('mouseenter', () => showPresetTipAt(b, p));
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (p.grey) return;
        if (p.mode === 'custom') send('filetools:panel', { kind: 'resize' });
        else send('filetools:run', { action: 'image.resize', options: { mode: p.mode, value: p.value } });
      });
      col.appendChild(b);
    });
    host.appendChild(col);
    const cap = btn.querySelector('.cap');
    const stage = $('stage').getBoundingClientRect();
    const capBox = cap.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(cap).fontSize) || 11;
    const baseline = (capBox.top - stage.top) + fontSize * 0.8;
    col.style.top = (baseline + 10) + 'px';
  } else if (k.action === 'image.convert' && k.pills && k.pills.length) {
    const row = document.createElement('div');
    row.className = 'pills';
    row.style.left = (rect.x - 20) + 'px';
    row.style.top = (rect.y + 48) + 'px';
    k.pills.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sub';
      b.textContent = '→ ' + p.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        send('filetools:run', { action: 'image.convert', options: { format: p.format } });
      });
      row.appendChild(b);
    });
    host.appendChild(row);
  }
}

function showPresetTipAt(el, p) {
  if (!p.reason) { hideTip(); return; }
  const tip = fillTip(p.reason, '');
  const col = el.closest('.col').getBoundingClientRect();
  const row = el.getBoundingClientRect();
  const stage = $('stage').getBoundingClientRect();
  tip.style.left = (col.right - stage.left + 12) + 'px';
  tip.style.top = Math.max(8, row.top - stage.top + (row.height - tip.offsetHeight) / 2) + 'px';
}

function showPresetTip(id) {
  const k = state && state.model.keys.find((x) => x.action === 'image.resize');
  if (!k) return;
  active = state.model.keys.indexOf(k);
  focusKey(active, true);
  const items = [...(k.pills || []), k.custom].filter(Boolean);
  const p = items.find((x) => x.id === id);
  const buttons = document.querySelectorAll('#extra .sub');
  const idx = items.indexOf(p);
  if (p && buttons[idx]) showPresetTipAt(buttons[idx], p);
}

function activate(i) {
  const k = state.model.keys[i];
  if (!k) return;
  if (k.grey && !(k.clickable || k.dashed || k.action === 'video.gif')) return;
  if (k.action === 'video.gif' && k.route === 'trim') {
    send('filetools:panel', { kind: 'trim', gif: true, start: (k.trim && k.trim.start) || 0, end: (k.trim && k.trim.end) || 15, confirm: k.confirm || '剪切并转 GIF' });
    return;
  }
  if (k.action === 'image.compress') { send('filetools:panel', { kind: 'compress-image' }); return; }
  if (k.action === 'video.compress') { send('filetools:panel', { kind: 'compress-video' }); return; }
  if (k.action === 'video.trim') { send('filetools:panel', { kind: 'trim', gif: false }); return; }
  if (k.action === 'image.resize' || k.action === 'image.convert') { focusKey(i, true); return; }
  if (k.grey) return;
  send('filetools:run', { action: k.action, options: {} });
}

function send(ch, payload) {
  if (window.api && api.send) api.send(ch, Object.assign({ files: state && state.files }, payload));
}

document.addEventListener('keydown', (e) => {
  if (!state) return;
  const n = state.model.keys.length;
  if (e.key === 'Escape') { e.preventDefault(); send('filetools:close-arc'); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusKey((active + 1) % n); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusKey((active - 1 + n) % n); return; }
  if (e.key === 'Enter') { e.preventDefault(); activate(active); return; }
  const num = Number(e.key);
  if (num >= 1 && num <= n) { e.preventDefault(); focusKey(num - 1); activate(num - 1); }
});

document.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer.files || [])].map((f) => (api && api.pathForFile ? api.pathForFile(f) : '')).filter(Boolean);
  if (!files.length || !state) return;
  const dx = e.clientX - state.hubx;
  const dy = e.clientY - state.huby;
  send('filetools:drop', { files, dx, dy, angles: state.angles });
});

window.renderArc = renderArc;
if (window.api && api.on) api.on('filetools:arc', renderArc);
