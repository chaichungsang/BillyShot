// 子进程里干活。主进程取消时发 {type:'cancel'} 或 SIGTERM，删掉 .part。
const fs = require('fs');
const path = require('path');
const { discardPartial } = require('./paths');
const image = require('./image-ops');
const { transcode, durationSeconds, killActive } = require('./video-ops');
const { ffmpegBin } = require('./ffmpeg-bin');
const { makePdf } = require('./pdf-ops');

let cancelled = false;
let partial = '';

function send(msg) {
  if (process.parentPort) process.parentPort.postMessage(msg);
  else if (process.send) process.send(msg);
}

function onCancel(fn) {
  if (process.parentPort) process.parentPort.on('message', (e) => { if (e.data && e.data.type === 'cancel') fn(); });
  else process.on('message', (m) => { if (m && m.type === 'cancel') fn(); });
}

function stop() {
  if (cancelled) return;
  cancelled = true;
  try { killActive(); } catch {}
  discardPartial(partial);
  send({ type: 'cancelled' });
  setTimeout(() => process.exit(0), 30);
}

async function perform(job) {
  partial = job.partial;
  const fd = fs.openSync(partial, 'wx');
  fs.closeSync(fd);
  const progress = (p) => { if (!cancelled) send({ type: 'progress', ...p }); };
  if (job.action === 'test.hold') {
    fs.writeFileSync(partial, 'partial');
    send({ type: 'progress', ratio: 0.1, indeterminate: true });
    await new Promise((resolve) => {
      const t = setInterval(() => { if (cancelled) { clearInterval(t); resolve(); } }, 40);
      onCancel(() => { cancelled = true; });
    });
    discardPartial(partial);
    send({ type: 'cancelled' });
    return;
  }
  if (job.action === 'image.convert') await image.convert(job.inputs[0], partial, job.options || {});
  else if (job.action === 'image.compress') await image.compress(job.inputs[0], partial, job.options || {});
  else if (job.action === 'image.resize') await image.resize(job.inputs[0], partial, job.options || {});
  else if (job.action === 'image.estimate') {
    const bytes = await image.estimateCompress(job.inputs[0], (job.options || {}).quality);
    discardPartial(partial);
    send({ type: 'estimate', bytes });
    return;
  } else if (job.action === 'video.mp4' || job.action === 'video.compress' || job.action === 'video.trim' || job.action === 'video.gif') {
    const bin = ffmpegBin();
    const duration = await durationSeconds(bin, job.inputs[0]);
    await transcode({
      action: job.action, input: job.inputs[0], output: partial, options: job.options || {}, duration,
    }, { onProgress: progress, isCancelled: () => cancelled });
  } else if (job.action === 'pdf.make') {
    await makePdf(job.inputs, partial);
  } else throw Object.assign(new Error('unknown action'), { code: 'EACTION' });
  if (cancelled) { discardPartial(partial); send({ type: 'cancelled' }); return; }
  fs.renameSync(partial, job.finalPath);
  const bytes = fs.statSync(job.finalPath).size;
  send({ type: 'done', file: job.finalPath, bytes });
}

function listen(job) {
  process.on('SIGTERM', stop);
  onCancel(stop);
  perform(job).then(() => {
    if (!cancelled) setTimeout(() => process.exit(0), 40);
  }).catch((err) => {
    discardPartial(partial);
    if (cancelled || err.code === 'CANCELLED') { send({ type: 'cancelled' }); process.exit(0); return; }
    send({ type: 'error', code: err.code || 'ERR', message: err.message || String(err) });
    process.exit(1);
  });
}

if (process.parentPort) process.parentPort.on('message', (e) => listen(e.data));
else if (require.main === module) process.on('message', listen);

module.exports = { listen };
