'use strict';

const L = window.NotchLogic;
const q = new URLSearchParams(location.search);
const role = q.get('role') || 'hit';
document.body.dataset.role = role;

const $ = (id) => document.getElementById(id);
const send = (ch, ...args) => { try { if (window.api && window.api.send) window.api.send(ch, ...args); } catch {} };

const ICONS = {
  shot: '<svg viewBox="0 0 22 22" fill="none" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 7V4.5a2 2 0 0 1 2-2H7M15 2.5h2.5a2 2 0 0 1 2 2V7M19.5 15v2.5a2 2 0 0 1-2 2H15M7 19.5H4.5a2 2 0 0 1-2-2V15"/><path d="M8 11h6M11 8v6"/></svg>',
  record: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="17" height="14" rx="2" stroke="#E8C97A" stroke-width="1.6" stroke-dasharray="3 2.4"/><circle cx="11" cy="11" r="3.2" fill="#E8C97A"/></svg>',
  recordFull: '<svg viewBox="0 0 22 22" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="18" height="12.5" rx="2" stroke="#E8C97A" stroke-width="1.6"/><path d="M8 19.5h6M11 16v3.5" stroke="#E8C97A" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="9.75" r="2.8" fill="#E8C97A"/></svg>',
};

function tx(key, vars) {
  try { if (typeof window.tx === 'function') return window.tx(key, vars); } catch {}
  let s = String(key).split('#')[0];
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

function timeHtml(ms) {
  const text = L ? L.formatElapsed(ms) : '0:00:00';
  const slot = L ? L.timerSlotText(ms) : '0:00:00';
  return `<span class="time-slot" aria-hidden="true">${slot}</span><span class="time-val">${text}</span>`;
}

function spoken(ms) {
  if (!L) return tx('{m} 分 {s} 秒', { m: 0, s: 0 });
  const p = L.spokenParts(ms);
  return tx(p.key, p.vars);
}

function stopName(ms) {
  return tx('停止录制，已录 {time}', { time: spoken(ms) });
}

function paintTime(ms) {
  const html = timeHtml(ms);
  for (const id of ['earTime', 'chinTime', 'pillTime']) {
    const el = $(id);
    if (el && el.dataset.ms !== String(ms)) { el.dataset.ms = String(ms); el.innerHTML = html; }
  }
  const label = stopName(ms);
  const live = tx('正在录制，已录 {time}', { time: spoken(ms) });
  $('stopBtn').setAttribute('aria-label', label);
  $('pillStop').setAttribute('aria-label', label);
  $('hit').setAttribute('aria-label', live);
  $('chin').setAttribute('aria-label', live);
  $('pillTime').setAttribute('aria-label', live);
}

function paintKeys(items) {
  const root = $('keys');
  const sig = (items || []).map((it) => `${it.id}|${it.label}|${it.accel}`).join('\n');
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.textContent = '';
  for (const it of items || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key';
    b.dataset.id = it.id;
    b.setAttribute('aria-label', it.label);
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.innerHTML = ICONS[it.id] || '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = it.label;
    b.append(ico, name);
    if (it.accel) {
      const a = document.createElement('span');
      a.className = 'accel';
      a.textContent = it.accel;
      b.appendChild(a);
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); send('notch:cmd', it.id); });
    root.appendChild(b);
  }
}

function screenLine(st) {
  if (st.screenRaw) return st.screenRaw;
  if (st.screenKey) return tx(st.screenKey);
  return '';
}

function apply(st) {
  if (!st) return;
  const show = st.show || 'idle';
  document.body.dataset.show = show;
  document.body.dataset.placement = st.placement || 'chin';
  document.body.dataset.notchW = st.notchW || '';
  document.body.dataset.notchH = st.notchH || '';
  if (st.motion) $('panel').dataset.motion = st.motion;
  else if (show === 'idle') $('panel').dataset.motion = '';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('reduce-motion');
  }
  paintKeys(st.items || []);
  paintTime(st.elapsed || 0);
  const mode = tx(st.full ? '全屏' : '区域');
  $('stopTitle').textContent = tx('录制中 · {mode}', { mode });
  const qText = (L && st.quality) ? tx(L.qualityText(st.quality)) : '';
  const bits = [qText, screenLine(st)].filter(Boolean);
  $('stopSub').textContent = bits.join(' · ');
  $('stopWord').textContent = tx('停止');
  $('pillWord').textContent = tx('停止');
}

$('hit').addEventListener('click', () => send('notch:press'));
$('chin').addEventListener('click', () => send('notch:press'));
$('stopBtn').addEventListener('click', (e) => { e.stopPropagation(); send('notch:cmd', 'stop'); });
$('pillStop').addEventListener('click', (e) => { e.stopPropagation(); send('notch:cmd', 'stop'); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') send('notch:collapse'); });

if (window.api && window.api.on) {
  window.api.on('notch:state', apply);
} else if (q.get('preview')) {
  mountPreview(q.get('preview'));
}

function mountPreview(which) {
  document.body.classList.add('preview');
  document.body.dataset.role = 'preview';
  const notes = {
    idle: ['空闲。BillyShot 这一层没有像素，热区只有刘海矩形。', '硬件剪影是预览用的，不是 BillyShot 画的。'],
    hover: ['悬停。三个键与菜单前三项同序：截图、录制区域、录制全屏。', '面板在菜单栏下方，宽 300 × 高 104。'],
    recording: ['录制中。红点在左耳 34pt，计时在刘海下方的下巴（默认，避开右侧状态图标）。', '计时槽按 H:MM:SS 预留，这里是 0:12:34。'],
    stop: ['悬停或点击耳朵后的一步停止。红色只出现在圆点和停止方块。', '点一次走现有的停止 / 保存流程。'],
    pill: ['无刘海或外接屏。胶囊 166 × 30，在菜单栏下方 6pt，停止键常驻。', '空闲时这一层什么都不画。'],
  };
  const pair = notes[which] || notes.idle;
  $('mockSub').textContent = pair[0];
  $('mockNote').textContent = pair[1];
  const stage = $('mockScreen');
  const layer = $('mockLayer');
  const W = 880;
  const notchW = 186;
  const notchH = 32;
  const nx = Math.round((W - notchW) / 2);
  const elapsed = (12 * 60 + 34) * 1000;
  const items = [
    { id: 'shot', label: tx('截图'), accel: '⌃⌘A' },
    { id: 'record', label: tx('录制区域'), accel: '⌃⌘R' },
    { id: 'recordFull', label: tx('录制全屏'), accel: '⌃⇧⌘R' },
  ];
  const base = {
    placement: 'chin', notchW, notchH, items, elapsed,
    full: true, quality: '2160', screenKey: '内置显示器', screenRaw: '',
  };
  $('mockHardware').hidden = which === 'pill';
  if (which === 'pill') $('mockMenu').style.height = '24px';

  function pin(el, box) {
    layer.appendChild(el);
    el.classList.add('pinned');
    el.style.left = box.x + 'px';
    el.style.top = box.y + 'px';
    el.style.width = box.w + 'px';
    el.style.height = box.h + 'px';
  }

  if (which === 'hover') {
    apply(Object.assign({}, base, { show: 'hover', motion: 'in' }));
    pin($('panel'), { x: Math.round((W - 300) / 2), y: notchH, w: 300, h: 104 });
  } else if (which === 'recording') {
    apply(Object.assign({}, base, { show: 'ears' }));
    pin($('hit'), { x: nx - 34, y: 0, w: 34 + notchW, h: notchH });
    pin($('chin'), { x: nx, y: notchH, w: notchW, h: 28 });
  } else if (which === 'stop') {
    apply(Object.assign({}, base, { show: 'stop', motion: 'in' }));
    pin($('hit'), { x: nx - 34, y: 0, w: 34 + notchW, h: notchH });
    pin($('panel'), { x: Math.round((W - 300) / 2), y: notchH, w: 300, h: 96 });
  } else if (which === 'pill') {
    apply(Object.assign({}, base, { show: 'pill', screenKey: '外接显示器' }));
    pin($('pill'), { x: Math.round((W - 166) / 2), y: 24 + 6, w: 166, h: 30 });
  } else {
    apply(Object.assign({}, base, { show: 'idle', elapsed: 0 }));
  }
}
