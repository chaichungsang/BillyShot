'use strict';
// 摄像头圆窗：显示摄像头画面，可拖动；悬停时显示 大小 / 形状 / 关闭
const $ = (id) => document.getElementById(id);
const video = $('v'), msg = $('msg');
let cfg = null, stream = null, curDevice = null, reported = false;
let seq = 0; // 每次打开 +1：换了摄像头时，旧的（可能卡住的）打开结果作废

function setMsg(t, err) {
  msg.textContent = t;
  document.body.classList.toggle('err', !!err);
}

async function open(deviceId, reopen) {
  const my = ++seq;
  reported = false;
  stop();
  document.body.classList.remove('ok'); setMsg(tx('摄像头启动中…'));
  // 重新打开（例如换了摄像头）：告诉主进程，录制中会先把圆窗藏起来，出画后再显示
  if (reopen) api.send('cam:state', { loading: true });
  const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  curDevice = deviceId; // 先记下：打开失败后，其他设置变化不会反复重试同一个设备
  const gum = async (c) => {
    const s = await navigator.mediaDevices.getUserMedia(c);
    if (my !== seq) { s.getTracks().forEach((t) => { try { t.stop(); } catch {} }); const e = new Error('stale'); e.name = 'Stale'; throw e; }
    return s;
  };
  try {
    if (cfg && cfg.simulateError === 'Hang') return; // 测试：摄像头一直没有画面
    if (cfg && cfg.simulateError) { const e = new Error('simulated'); e.name = cfg.simulateError; throw e; }
    let s;
    try {
      s = await gum({ audio: false, video: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
    } catch (e) {
      // 选过的摄像头被拔掉了：改用默认摄像头
      if (e.name === 'Stale' || my !== seq || !deviceId || !/NotFound|Overconstrained/i.test(e.name)) throw e;
      console.log('camera device missing, fallback to default', e.name);
      s = await gum({ audio: false, video: base });
    }
    stream = s;
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => { if (stream && stream.getVideoTracks()[0] === track) fail({ name: 'NotReadableError', message: 'track ended' }); });
  } catch (e) {
    if (e.name !== 'Stale' && my === seq) fail(e);
  }
}
function fail(e) {
  console.log('camera error', e.name, e.message);
  stop();
  document.body.classList.remove('ok');
  setMsg(tx(/NotReadable|TrackStart|Could not start/i.test(e.name + e.message) ? '摄像头正被其他程序使用' : /NotFound|DevicesNotFound|Overconstrained/i.test(e.name) ? '没有找到摄像头' : /NotAllowed|Permission/i.test(e.name) ? '没有摄像头权限' : '摄像头打开失败'), true);
  api.send('cam:state', { ok: false, error: `${e.name || ''} ${e.message || ''}`.trim() });
}
function stop() {
  if (stream) { stream.getTracks().forEach((t) => { try { t.stop(); } catch {} }); stream = null; }
  video.srcObject = null;
}
video.addEventListener('playing', () => {
  if (reported || !video.videoWidth) return;
  reported = true;
  document.body.classList.add('ok');
  const t = stream && stream.getVideoTracks()[0];
  api.send('cam:state', { ok: true, w: video.videoWidth, h: video.videoHeight, label: t ? t.label : '' });
});

api.on('cam:cfg', (c) => {
  const first = !cfg;
  cfg = c;
  document.body.classList.toggle('rounded', c.shape === 'rounded');
  document.body.classList.toggle('mirror', !!c.mirror);
  document.body.classList.toggle('outside', !!c.outside);
  $('bSizeT').textContent = ({ s: 'S', m: 'M', l: 'L' })[c.size] || 'M';
  if (first || c.deviceId !== curDevice) open(c.deviceId, !first); // 打开中途换设备也立刻换
});

// 拖动
let drag = null;
$('cam').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  document.body.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
  if (dx || dy) { api.send('cam:drag', dx, dy); drag.x = e.screenX; drag.y = e.screenY; drag.moved = true; }
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  document.body.classList.remove('dragging');
  if (moved) api.send('cam:drag-end');
});
$('bSize').addEventListener('click', () => api.send('cam:action', 'size'));
$('bShape').addEventListener('click', () => api.send('cam:action', 'shape'));
$('bClose').addEventListener('click', () => api.send('cam:action', 'close'));
window.addEventListener('beforeunload', stop);
window.__cam = () => ({ ok: document.body.classList.contains('ok'), w: video.videoWidth, h: video.videoHeight, msg: msg.textContent, cls: document.body.className, live: !!(stream && stream.active) });
