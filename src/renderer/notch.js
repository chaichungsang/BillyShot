'use strict';

const $ = (id) => document.getElementById(id);
let face = 'idle-mark';
let notchH = 28;
let fmt = 'mp4';
let paused = false;
let micOn = true;
let over = null;

function place() {
  const slot = $('slot');
  slot.style.width = (Number(document.body.dataset.notchW) || 160) + 'px';
  slot.style.height = notchH + 'px';
  for (const card of [$('menu'), $('rec')]) card.style.top = (notchH + 6) + 'px';
}
function paintFace(next) {
  face = next || 'idle-mark';
  document.body.className = face + (document.body.classList.contains('paused') ? ' paused' : '');
  $('menu').hidden = face !== 'idle-menu';
  $('rec').hidden = !(face === 'rec-full' || face === 'saving' || face === 'done');
  const showTime = face === 'rec-compact' || face === 'rec-full' || face === 'saving' || face === 'done';
  $('ctime').hidden = !showTime;
  $('cstop').hidden = face !== 'rec-compact';
  place();
  reportHit(face !== 'idle-mark' && face !== 'rec-compact');
}
function reportHit(hit) {
  const on = !!hit;
  if (on === over) return;
  over = on;
  api.send('notch:hit', on);
}
function hitOf(target) {
  return !!(target && target.closest && target.closest('.hit'));
}

api.on('notch:state', (st) => {
  if (!st) return;
  document.body.dataset.notchW = st.notchW || 160;
  notchH = st.notchH || 28;
  if (st.recCfg) {
    fmt = st.recCfg.format || 'mp4';
    $('mic').hidden = st.recCfg.mic !== '1';
    fxState.fx = st.recCfg.fx === '1';
    fxState.spot = st.recCfg.spot === '1';
    fxState.cam = st.recCfg.cam === '1';
    renderFx();
  }
  renderMenu(st.items || []);
  paintFace(st.face);
});

function renderMenu(items) {
  const root = $('menu');
  root.textContent = '';
  let group = '';
  for (const it of items) {
    if (it.group && it.group !== group) {
      group = it.group;
      const g = document.createElement('div');
      g.className = 'group';
      g.textContent = group;
      root.appendChild(g);
    }
    const b = document.createElement('button');
    b.className = 'item' + (it.checked ? ' on' : '');
    b.disabled = it.enabled === false;
    const name = document.createElement('span');
    name.textContent = it.label;
    b.appendChild(name);
    if (it.accel) {
      const a = document.createElement('span');
      a.className = 'accel';
      a.textContent = it.accel;
      b.appendChild(a);
    }
    b.addEventListener('click', () => api.send('notch:cmd', it.id));
    root.appendChild(b);
  }
}

$('slot').addEventListener('click', (e) => {
  if (e.target.closest('#cstop')) return;
  api.send('notch:toggle');
});
$('cstop').addEventListener('click', () => api.send('recbar:action', 'stop'));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.send('notch:collapse'); });
window.addEventListener('mousemove', (e) => reportHit(hitOf(e.target)));

const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/></svg>';
function mmss(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}
function size(b) { if (!b) return ''; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

function saving(text, pct) {
  document.body.classList.add('saving');
  document.body.classList.remove('done');
  $('meta').textContent = text;
  $('prog').classList.toggle('indet', pct === null);
  $('progBar').style.width = pct === null ? '' : `${pct}%`;
}
let closeTimer = null;
let hovering = false;
function armClose(ms) {
  clearTimeout(closeTimer);
  if (!hovering) closeTimer = setTimeout(() => api.send('recbar:done', 'close'), ms);
}
function done(st) {
  document.body.classList.remove('saving', 'paused');
  document.body.classList.add('done');
  if (st.duration) $('ctime').textContent = mmss(st.duration);
  const what = st.partial ? tx('已保存录到的部分') : tx('已保存');
  $('meta').textContent = st.bytes ? `${what} · ${size(st.bytes)}` : what;
  armClose(20000);
}
document.body.addEventListener('mouseenter', () => { hovering = true; clearTimeout(closeTimer); });
document.body.addEventListener('mouseleave', () => { hovering = false; if (document.body.classList.contains('done')) armClose(6000); });
$('dFolder').addEventListener('click', () => api.send('recbar:done', 'folder'));
$('dPlay').addEventListener('click', () => api.send('recbar:done', 'play'));
$('dClose').addEventListener('click', () => api.send('recbar:done', 'close'));
$('pause').addEventListener('click', () => {
  if (document.body.classList.contains('saving') || document.body.classList.contains('done')) return;
  paused = !paused;
  $('pause').innerHTML = paused ? PLAY : PAUSE;
  document.body.classList.toggle('paused', paused);
  api.send('recbar:action', paused ? 'pause' : 'resume');
});
$('stop').addEventListener('click', () => api.send('recbar:action', 'stop'));
$('cancel').addEventListener('click', () => api.send('recbar:action', 'cancel'));
$('mic').addEventListener('click', () => {
  micOn = !micOn;
  $('mic').classList.toggle('off', !micOn);
  api.send('recbar:action', micOn ? 'mic-on' : 'mic-off');
});
const fxState = { fx: false, spot: false, cam: false };
function renderFx() {
  for (const k of ['fx', 'spot', 'cam']) $(k).classList.toggle('on', !!fxState[k]);
}
for (const k of ['fx', 'spot', 'cam']) {
  $(k).addEventListener('click', () => {
    fxState[k] = !fxState[k];
    renderFx();
    api.send('recbar:action', `${k}-${fxState[k] ? 'on' : 'off'}`);
  });
}
api.on('recbar:fx', (st) => { Object.assign(fxState, st || {}); renderFx(); });

api.on('recbar:state', (st) => {
  if (!st) return;
  if (st.state === 'recording' || st.state === 'paused') {
    document.body.classList.remove('saving', 'done');
    paused = st.state === 'paused';
    document.body.classList.toggle('paused', paused);
    $('pause').innerHTML = paused ? PLAY : PAUSE;
    if (st.elapsed != null) $('ctime').textContent = mmss(st.elapsed);
    if (st.warnings && st.warnings.length) $('meta').textContent = st.warnings[0];
    else if (st.bytes) $('meta').textContent = `${fmt.toUpperCase()} · ${size(st.bytes)}`;
    else $('meta').textContent = fmt.toUpperCase();
  } else if (st.state === 'encoding') {
    const pct = st.total ? Math.min(100, Math.floor((st.done / st.total) * 100)) : null;
    saving(pct === null ? tx('正在生成 GIF…') : tx('正在生成 GIF… {p}%', { p: pct }), pct);
  } else if (st.state === 'stopping' || st.state === 'finalizing') {
    const pct = st.pct > 0 ? Math.floor(st.pct * 100) : null;
    saving(pct === null ? tx('正在保存…') : tx('正在保存… {p}%', { p: pct }), pct);
  } else if (st.state === 'done') done(st);
});
