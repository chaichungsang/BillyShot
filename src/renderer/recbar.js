'use strict';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const fmt = q.get('format') || 'mp4';
let paused = false, micOn = true;
if (q.get('mic') === '1') $('mic').hidden = false;
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/></svg>';

function mmss(ms) {
  const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}
function size(b) { if (!b) return ''; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }

api.on('recbar:state', (st) => {
  if (st.state === 'recording' || st.state === 'paused') {
    document.body.classList.remove('prep');
    document.body.classList.toggle('paused', st.state === 'paused');
    if (st.elapsed != null) $('time').textContent = mmss(st.elapsed);
    if (st.info && st.info.size) $('meta').textContent = `${fmt.toUpperCase()} ${st.info.size.replace('x', '×')}`;
    else if (fmt === 'gif' && st.frames != null) $('meta').textContent = tx('GIF · {n} 帧', { n: st.frames });
    else if (st.bytes) $('meta').textContent = `${fmt.toUpperCase()} · ${size(st.bytes)}`;
    $('meta').title = (st.warnings || []).join('\n');
    if (st.warnings && st.warnings.length) $('meta').textContent = '⚠ ' + st.warnings[0];
    else if (st.warnings && $('meta').textContent.startsWith('⚠')) $('meta').textContent = fmt.toUpperCase(); // 提示已解除
  } else if (st.state === 'encoding') {
    // GIF：停止后把剩下的帧编完（有百分比）
    const pct = st.total ? Math.min(100, Math.floor((st.done / st.total) * 100)) : null;
    saving(pct === null ? tx('正在生成 GIF…') : tx('正在生成 GIF… {p}%', { p: pct }), pct);
  } else if (st.state === 'stopping') {
    saving(tx('正在保存…'), null);
  } else if (st.state === 'finalizing') {
    const pct = st.pct > 0 ? Math.floor(st.pct * 100) : null;
    saving(pct === null ? tx('正在保存…') : tx('正在保存… {p}%', { p: pct }), pct);
  } else if (st.state === 'done') {
    done(st);
  } else if (st.state === 'ready' && st.warnings) {
    $('meta').title = st.warnings.join('\n');
    $('meta').textContent = st.warnings.length ? '⚠ ' + st.warnings[0] : tx('准备中…');
  }
});

// 停止以后：正在保存 → 已保存
const savingSeen = []; window.__saving = savingSeen; // 测试用：保存过程中显示过的文字
function saving(text, pct) {
  document.body.classList.remove('done', 'partial');
  document.body.classList.add('prep', 'saving');
  if (savingSeen[savingSeen.length - 1] !== text && savingSeen.length < 200) savingSeen.push(text);
  $('meta').textContent = text; $('meta').title = '';
  $('prog').classList.toggle('indet', pct === null);
  $('progBar').style.width = pct === null ? '' : `${pct}%`;
}
let closeTimer = null, hovering = false;
const AUTO_CLOSE = 20000; // 不动它 20 秒后自动收起；鼠标放在上面时不收
function armClose(ms) { clearTimeout(closeTimer); if (!hovering) closeTimer = setTimeout(() => api.send('recbar:done', 'close'), ms); }
function done(st) {
  const b = document.body;
  b.classList.remove('saving', 'paused'); b.classList.add('prep', 'done');
  b.classList.toggle('partial', !!st.partial);
  if (st.duration) $('time').textContent = mmss(st.duration);
  const what = st.partial ? tx('已保存录到的部分') : tx('已保存');
  $('meta').textContent = st.bytes ? `${what} · ${size(st.bytes)}` : what;
  $('meta').title = st.name || '';
  window.__done = { name: st.name, bytes: st.bytes, duration: st.duration, partial: !!st.partial };
  armClose(AUTO_CLOSE);
}
document.body.addEventListener('mouseenter', () => { hovering = true; clearTimeout(closeTimer); });
document.body.addEventListener('mouseleave', () => { hovering = false; if (document.body.classList.contains('done')) armClose(6000); });
$('dFolder').addEventListener('click', () => api.send('recbar:done', 'folder'));
$('dPlay').addEventListener('click', () => api.send('recbar:done', 'play'));
$('dClose').title = tx('关闭#窗口');
$('dClose').addEventListener('click', () => api.send('recbar:done', 'close'));

$('pause').addEventListener('click', () => {
  if (document.body.classList.contains('prep')) return; // 倒计时/准备中不能暂停
  paused = !paused;
  $('pause').innerHTML = paused ? PLAY : PAUSE;
  api.send('recbar:action', paused ? 'pause' : 'resume');
});
$('stop').addEventListener('click', () => api.send('recbar:action', 'stop'));
$('cancel').addEventListener('click', () => api.send('recbar:action', 'cancel'));
$('mic').addEventListener('click', () => {
  micOn = !micOn; $('mic').classList.toggle('off', !micOn);
  api.send('recbar:action', micOn ? 'mic-on' : 'mic-off');
});
// 演示：鼠标效果 / 聚光灯 / 摄像头
const fxState = { fx: q.get('fx') === '1', spot: q.get('spot') === '1', cam: q.get('cam') === '1' };
const FX_TITLE = { fx: tx('鼠标光圈 / 点击波纹'), spot: tx('聚光灯'), cam: tx('摄像头') };
function renderFx() {
  for (const k of ['fx', 'spot', 'cam']) { $(k).classList.toggle('on', !!fxState[k]); $(k).title = tx('{name}：{state}', { name: FX_TITLE[k], state: fxState[k] ? tx('开') : tx('关') }); }
}
for (const k of ['fx', 'spot', 'cam']) {
  $(k).addEventListener('click', () => {
    fxState[k] = !fxState[k]; renderFx();
    api.send('recbar:action', `${k}-${fxState[k] ? 'on' : 'off'}`);
  });
}
api.on('recbar:fx', (st) => { Object.assign(fxState, st || {}); renderFx(); });
renderFx();
// 拖动控制条
let drag = null;
$('grip').addEventListener('mousedown', (e) => { drag = { x: e.screenX, y: e.screenY }; });
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
  if (dx || dy) { api.send('recbar:drag', dx, dy); drag = { x: e.screenX, y: e.screenY }; }
});
window.addEventListener('mouseup', () => { drag = null; });
