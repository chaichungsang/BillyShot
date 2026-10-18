'use strict';
// 文件工具：每个动作、不覆盖、取消、排队、HEIC、合成 PDF 页序、GIF 15 秒、不放大。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.BILLYSHOT_FFMPEG = path.join(__dirname, '..', 'vendor', 'ffmpeg', 'linux-x64', 'ffmpeg');

const { nextTo } = require('../src/filetools/paths');
const plan = require('../src/filetools/plan');
const { FileJobQueue } = require('../src/filetools/queue');
const { decide, afterPrompt } = require('../src/filetools/shift-drag-policy');
const { buildArgs, transcode } = require('../src/filetools/video-ops');
const { decodeHeic, HEIC_MESSAGE } = require('../src/filetools/heic');
const image = require('../src/filetools/image-ops');
const { makePdf } = require('../src/filetools/pdf-ops');
const { JobRunner } = require('../src/filetools/jobs');
const { PDFDocument } = require('pdf-lib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsft-'));
let clip = '';

function waitFor(fn, ms = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v;
      try { v = fn(); } catch (e) { return reject(e); }
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error('timeout'));
      setTimeout(tick, 30);
    };
    tick();
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function samplePdf(file, w, h) {
  const doc = await PDFDocument.create();
  doc.addPage([w, h]);
  fs.writeFileSync(file, await doc.save());
}
async function samplePng(file, w, h, color) {
  await require('sharp')({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(file);
}

test('naming never returns the original and uses -1 then -2', () => {
  const dir = fs.mkdtempSync(path.join(root, 'name-'));
  const src = path.join(dir, 'shot.png');
  fs.writeFileSync(src, 'x');
  const taken = new Set([src]);
  const exists = (p) => taken.has(p);
  const a = nextTo(src, { suffix: 'compressed', ext: 'png' }, exists);
  assert.equal(path.basename(a), 'shot-compressed.png');
  taken.add(a);
  const b = nextTo(src, { suffix: 'compressed', ext: 'png' }, exists);
  assert.equal(path.basename(b), 'shot-compressed-1.png');
  taken.add(b);
  const c = nextTo(src, { suffix: 'compressed', ext: 'png' }, exists);
  assert.equal(path.basename(c), 'shot-compressed-2.png');
  assert.notEqual(path.resolve(a), path.resolve(src));
});

test('resize presets grey out when they would upscale, and say so', () => {
  const narrow = plan.resizeChoices(1000);
  const p50 = narrow.find((c) => c.id === 'p50');
  const w1920 = narrow.find((c) => c.id === 'w1920');
  const w1280 = narrow.find((c) => c.id === 'w1280');
  assert.equal(p50.grey, false);
  assert.equal(w1920.grey, true);
  assert.equal(w1920.reason, '原图小于 1920，不放大');
  assert.equal(w1280.grey, true);
  assert.equal(w1280.reason, '原图小于 1280，不放大');
  const mid = plan.resizeChoices(1600);
  assert.equal(mid.find((c) => c.id === 'w1920').grey, true);
  assert.equal(mid.find((c) => c.id === 'w1280').grey, false);
  const wide = plan.resizeChoices(2000);
  assert.equal(wide.every((c) => !c.grey), true);
  assert.equal(plan.resizeChoices(1920).find((c) => c.id === 'w1920').grey, false);
  const unknown = plan.resizeChoices(null);
  assert.equal(unknown.find((c) => c.id === 'p50').grey, false);
  assert.equal(unknown.find((c) => c.id === 'w1920').reason, '不知道原图宽度，不放大');
  assert.equal(plan.capWidth(5000, 800), 800);
  assert.equal(plan.capWidth(1920, 1920), 1920);
});

test('image arc is three keys; GIF over 15s is grey, still routed to trim', () => {
  const imageArc = plan.ringModel({ files: ['示例.png'], width: 1000 });
  assert.deepEqual(imageArc.keys.map((k) => k.label), ['转格式', '压缩图片', '改尺寸']);
  assert.equal(imageArc.keys[2].custom.label, '自定义…');
  const gif = plan.ringModel({ files: ['示例-录屏.mov'], duration: 120 }).keys.find((k) => k.action === 'video.gif');
  assert.equal(gif.grey, true);
  assert.equal(gif.dashed, true);
  assert.equal(gif.route, 'trim');
  assert.equal(gif.reason, 'GIF 最长 15 秒，先剪一段');
  assert.equal(gif.confirm, '剪切并转 GIF');
  assert.deepEqual(gif.trim, { start: 0, end: 15 });
  const short = plan.gifPlan(10);
  assert.equal(short.grey, false);
  assert.equal(short.route, 'gif');
  const unknown = plan.gifPlan(null);
  assert.equal(unknown.grey, false);
  assert.equal(unknown.route, 'trim');
  const pdf = plan.ringModel({ files: ['b.png', 'a.pdf', 'c.jpg'] });
  assert.equal(pdf.keys.length, 1);
  assert.equal(pdf.keys[0].label, '合成 PDF');
  assert.equal(pdf.keys[0].action, 'pdf.make');
});

test('GIF refuses a span over 15s and refuses an unknown span', () => {
  assert.throws(() => buildArgs({
    action: 'video.gif', input: 'a.mov', output: 'a.gif', options: { start: 0, end: 20 }, duration: 30,
  }), (e) => e.code === 'GIF_TOO_LONG');
  assert.throws(() => buildArgs({
    action: 'video.gif', input: 'a.mov', output: 'a.gif', options: {}, duration: null,
  }), (e) => e.code === 'GIF_NEEDS_TRIM');
  const built = buildArgs({
    action: 'video.gif', input: 'a.mov', output: 'a.gif', options: { start: 0, end: 10 }, duration: 30,
  });
  assert.ok(built.args.includes('-to'));
  assert.equal(built.args[built.args.indexOf('-to') + 1], '10');
  assert.equal(built.args.includes('-t'), false);
  assert.equal(built.args.includes('15'), false);
});

test('encoders stay LGPL: no libx264, VideoToolbox quality vs bitrate, Media Foundation CBR', () => {
  assert.deepEqual(plan.encodePlan('linux', ['libx264', 'mpeg4', 'libx265']), ['mpeg4']);
  assert.deepEqual(plan.encodePlan('darwin', ['h264_videotoolbox', 'mpeg4']), ['h264_videotoolbox', 'mpeg4']);
  assert.deepEqual(plan.encodePlan('win32', ['h264_mf', 'mpeg4']), ['h264_mf', 'mpeg4']);
  const arm = plan.codecArgs('h264_videotoolbox', { arch: 'arm64', qv: '65', bitrate: '8M' });
  assert.ok(arm.includes('-q:v'));
  assert.equal(arm.includes('-b:v'), false);
  assert.ok(arm.includes('-allow_sw'));
  const intel = plan.codecArgs('h264_videotoolbox', { arch: 'x64', bitrate: '8M' });
  assert.ok(intel.includes('-b:v'));
  assert.equal(intel.includes('-q:v'), false);
  const win = plan.codecArgs('h264_mf', { bitrate: '3M' });
  assert.ok(win.includes('cbr'));
  assert.throws(() => plan.codecArgs('libx264', {}), (e) => e.code === 'EGPL');
});

test('queued file jobs have no start-now, and Esc removes them', async () => {
  let rec = true;
  const ran = [];
  let release;
  const q = new FileJobQueue({
    isRecording: () => rec,
    run: (job) => new Promise((resolve) => { ran.push(job.id); release = resolve; }),
  });
  const first = q.enqueue({ id: 'a' });
  assert.equal(first.state, 'queued');
  assert.equal(first.text, '录屏结束后开始');
  assert.equal(typeof q.startNow, 'undefined');
  assert.equal(q.cancel('a'), 'queued');
  rec = false;
  q.setRecording(false);
  assert.deepEqual(ran, []);
  const held = q.enqueue({ id: 'b' });
  assert.equal(held.state, 'running');
  const waiting = q.enqueue({ id: 'c' });
  assert.equal(waiting.text, '录屏结束后开始');
  assert.equal(q.cancel('c'), 'queued');
  await waitFor(() => typeof release === 'function');
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, ['b']);
});

test('shift-drag stays off after 暂不, and starts when no permission is needed', () => {
  assert.deepEqual(decide({ shiftDrag: true }, { ok: true, permission: 'none' }).action, 'start');
  assert.equal(decide({ shiftDrag: false }, { ok: true, permission: 'none' }).action, 'off');
  const declined = afterPrompt('decline');
  assert.equal(declined.shiftDrag, 'off');
  assert.equal(declined.shiftDragDeclined, true);
  assert.equal(decide(declined, { needsPermission: true }).action, 'off');
  assert.equal(decide({ shiftDrag: true }, { needsPermission: true }).action, 'prompt');
  assert.equal(decide(afterPrompt('allow'), { ok: true, permission: 'none' }).action, 'start');
});

test('HEIC on this machine says it cannot be read and does not write', async () => {
  const dest = path.join(root, 'out.png');
  await assert.rejects(() => decodeHeic(path.join(root, 'x.heic'), dest, 'linux'), (e) => e.code === 'HEIC_UNSUPPORTED' && e.message === HEIC_MESSAGE);
  assert.equal(fs.existsSync(dest), false);
});

test('images: convert, compress keeps PNG, resize never upscales', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'img-'));
  const png = path.join(dir, 'wide.png');
  await samplePng(png, 80, 40, 'blue');
  const jpg = path.join(dir, 'wide.jpg');
  await image.convert(png, jpg, { format: 'jpg', quality: 80 });
  assert.equal(fs.readFileSync(jpg).slice(0, 2).toString('hex'), 'ffd8');
  const crushed = path.join(dir, 'wide-compressed.png');
  await image.compress(png, crushed, { quality: 40 });
  assert.equal(fs.readFileSync(crushed).slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  const half = path.join(dir, 'half.png');
  const halfMeta = await image.resize(png, half, { mode: 'percent', value: 50 });
  assert.equal(halfMeta.width, 40);
  const capped = path.join(dir, 'capped.png');
  const capMeta = await image.resize(png, capped, { mode: 'width', value: 5000 });
  assert.equal(capMeta.width, 80);
  assert.equal(capMeta.capped, true);
  const heic = path.join(dir, 'photo.heic');
  fs.writeFileSync(heic, 'not a photo');
  await assert.rejects(() => image.compress(heic, path.join(dir, 'photo.jpg'), { quality: 70 }), (e) => e.code === 'HEIC_UNSUPPORTED');
});

test('Make PDF mixes images and PDF pages in natural filename order', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'pdf-'));
  await samplePdf(path.join(dir, 'a-2.pdf'), 220, 100);
  await samplePng(path.join(dir, 'a-10.png'), 100, 50, 'red');
  await samplePng(path.join(dir, 'b.png'), 300, 80, 'green');
  const out = path.join(dir, 'merged.pdf');
  const made = await makePdf([
    path.join(dir, 'b.png'),
    path.join(dir, 'a-10.png'),
    path.join(dir, 'a-2.pdf'),
  ], out);
  assert.deepEqual(made.order, ['a-2.pdf', 'a-10.png', 'b.png']);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const widths = doc.getPages().map((p) => Math.round(p.getWidth()));
  assert.deepEqual(widths, [220, 100, 300]);
  assert.equal(made.pages, 3);
});

test('cancel kills the worker and deletes the partial', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'cancel-'));
  const png = path.join(dir, 'hold.png');
  await samplePng(png, 8, 8, 'white');
  const runner = new JobRunner();
  const job = runner.start({ action: 'test.hold', inputs: [png], options: {} });
  await waitFor(() => job.worker && job.worker.pid() && fs.existsSync(job.partial));
  const pid = job.worker.pid();
  assert.equal(runner.cancel(job.id), 'running');
  await waitFor(() => job.state === 'cancelled' && !fs.existsSync(job.partial));
  await waitFor(() => !alive(pid), 3000);
  runner.dispose();
});

test('a second job waits, and nothing runs while recording', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'queue-'));
  const png = path.join(dir, 'q.png');
  await samplePng(png, 8, 8, 'white');
  const runner = new JobRunner();
  runner.setRecording(true);
  const job = runner.start({ action: 'test.hold', inputs: [png], options: {} });
  assert.equal(job.state, 'queued');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fs.existsSync(job.partial), false);
  runner.cancel(job.id);
  assert.equal(job.state, 'cancelled');
  runner.dispose();
});

test('not enough disk blocks the job before it starts', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'disk-'));
  const png = path.join(dir, 'd.png');
  await samplePng(png, 8, 8, 'white');
  const runner = new JobRunner();
  assert.throws(() => runner.start({ action: 'image.compress', inputs: [png], options: {}, needBytes: 10 ** 18 }), (e) => e.code === 'ENOSPC');
});

test('video actions through the LGPL ffmpeg, including a short GIF', { timeout: 60000 }, async () => {
  assert.equal(fs.existsSync(process.env.BILLYSHOT_FFMPEG), true);
  const dir = fs.mkdtempSync(path.join(root, 'vid-'));
  const srcMp4 = path.join(dir, 'in.mp4');
  const made = spawnSync('/usr/bin/ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=12:duration=1',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', srcMp4,
  ], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr && made.stderr.slice(-400));
  const mp4 = path.join(dir, 'out.mp4');
  await transcode({ action: 'video.mp4', input: srcMp4, output: mp4, options: {} }, {});
  assert.ok(fs.statSync(mp4).size > 500);
  const small = path.join(dir, 'small.mp4');
  await transcode({ action: 'video.compress', input: srcMp4, output: small, options: { level: 'small' } }, {});
  assert.ok(fs.statSync(small).size > 200);
  const trimmed = path.join(dir, 'trim.mp4');
  await transcode({ action: 'video.trim', input: srcMp4, output: trimmed, options: { start: 0, end: 0.4 } }, {});
  assert.ok(fs.statSync(trimmed).size > 200);
  const gif = path.join(dir, 'clip.gif');
  await transcode({ action: 'video.gif', input: srcMp4, output: gif, options: { start: 0, end: 0.5 }, duration: 1 }, {});
  assert.equal(fs.readFileSync(gif).slice(0, 3).toString(), 'GIF');
  const tooLong = path.join(dir, 'long.gif');
  await assert.rejects(() => transcode({
    action: 'video.gif', input: srcMp4, output: tooLong, options: { start: 0, end: 20 }, duration: 30,
  }, {}), (e) => e.code === 'GIF_TOO_LONG');
  assert.equal(fs.existsSync(tooLong), false);
});

test('Windows default shortcut avoids AltGr and stays customizable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
  assert.match(src, /Control\+Alt\+F/);
  assert.match(src, /Ctrl\+Shift\+F/);
  assert.match(src, /AltGr/);
});

test('progress numbers stay empty when duration is unknown', () => {
  const known = plan.parseProgress('out_time_us=500000\nspeed=2.0x\n', 2);
  assert.equal(known.indeterminate, false);
  assert.ok(known.ratio > 0.2 && known.ratio < 0.3);
  const unknown = plan.parseProgress('out_time_us=500000\nspeed=2.0x\n', null);
  assert.equal(unknown.indeterminate, true);
  assert.equal(unknown.ratio, null);
  assert.equal(plan.estimateVideoBytes('3M', null), null);
  assert.equal(plan.estimateVideoBytes('3M', 2) > 0, true);
});
