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
const { buildArgs, transcode, killProcessTree } = require('../src/filetools/video-ops');
const { decodeHeic, HEIC_MESSAGE } = require('../src/filetools/heic');
const image = require('../src/filetools/image-ops');
const { makePdf, friendlyPdfError, ENCRYPTED } = require('../src/filetools/pdf-ops');
const { panelTitle, visibleEstimateBytes } = require('../src/filetools/panel-title');
const { noticeForRegisterFailure, registerResult } = require('../src/hotkey-notice');
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
  assert.equal(built.args[built.args.length - 3], '-f');
  assert.equal(built.args[built.args.length - 2], 'gif');
  const mp4 = buildArgs({
    action: 'video.mp4', input: 'a.mov', output: 'a.mp4.part', options: {},
    encoder: 'mpeg4', platform: 'linux', duration: 2,
  });
  assert.equal(mp4.args[mp4.args.length - 3], '-f');
  assert.equal(mp4.args[mp4.args.length - 2], 'mp4');
  assert.equal(mp4.args[mp4.args.length - 1], 'a.mp4.part');
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
  assert.equal(fs.readFileSync(out).includes(Buffer.from('/DCTDecode')), true);
});

test('cancel kills the worker and deletes the partial', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'cancel-'));
  const png = path.join(dir, 'hold.png');
  await samplePng(png, 8, 8, 'white');
  const runner = new JobRunner({ workerScript: path.join(__dirname, 'hold-worker.js') });
  const job = runner.start({ action: 'image.compress', inputs: [png], options: {} });
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
  const runner = new JobRunner({ workerScript: path.join(__dirname, 'hold-worker.js') });
  runner.setRecording(true);
  const job = runner.start({ action: 'image.compress', inputs: [png], options: {} });
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

test('Windows default shortcut avoids AltGr and editor Ctrl+Shift+F', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
  assert.match(src, /Control\+Alt\+F/);
  assert.match(src, /Ctrl\+Shift\+Alt\+F/);
  assert.match(src, /AltGr/);
  assert.equal(src.includes("fileTools: { keyboard: isMac ? 'Control+Alt+F' : 'Ctrl+Shift+F'"), false);
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

test('x64 sharp prebuilds stay official binaries with npmRebuild false', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.npmRebuild, false);
  const winDir = path.join(__dirname, '..', 'node_modules', '@img', 'sharp-win32-x64', 'lib');
  const winName = fs.readdirSync(winDir).find((f) => f.endsWith('.node'));
  const winBuf = fs.readFileSync(path.join(winDir, winName));
  assert.equal(winBuf.slice(0, 2).toString(), 'MZ');
  const pe = winBuf.readUInt32LE(0x3c);
  assert.equal(winBuf.readUInt16LE(pe + 4), 0x8664);
  assert.equal(fs.existsSync(path.join(winDir, 'libvips-42.dll')), true);
  const macDir = path.join(__dirname, '..', 'node_modules', '@img', 'sharp-darwin-x64', 'lib');
  const macName = fs.readdirSync(macDir).find((f) => f.endsWith('.node'));
  const macBuf = fs.readFileSync(path.join(macDir, macName));
  assert.equal(macBuf.slice(0, 4).toString('hex'), 'cffaedfe');
  assert.equal(macBuf.readInt32LE(4), 0x01000007);
});

test('bundled Windows ffmpeg is LGPL and includes h264_mf', () => {
  const exe = path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win32-x64', 'ffmpeg.exe');
  const text = fs.readFileSync(exe).toString('latin1');
  assert.match(text, /--disable-gpl/);
  assert.equal(text.includes('--enable-gpl'), false);
  assert.equal(text.includes('--enable-libx264'), false);
  assert.match(text, /--enable-mediafoundation/);
  assert.match(text, /h264_mf/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win32-x64', 'avcodec-61.dll')), true);
});

test('size line stays hidden unless bitrate times duration produced it', () => {
  const bytes = plan.estimateVideoBytes('3M', 2);
  assert.ok(bytes > 0);
  assert.equal(visibleEstimateBytes({ indeterminate: true, estimateBytes: bytes, estimateFromDuration: true }), null);
  assert.equal(visibleEstimateBytes({ indeterminate: true, estimateBytes: 2516582, estimateFromDuration: true }), null);
  assert.equal(visibleEstimateBytes({ indeterminate: false, estimateBytes: 2516582 }), null);
  assert.equal(visibleEstimateBytes({ indeterminate: false, estimateBytes: bytes, estimateFromDuration: false }), null);
  assert.equal(visibleEstimateBytes({ indeterminate: false, estimateBytes: bytes, estimateFromDuration: true }), bytes);
  assert.equal(visibleEstimateBytes({ indeterminate: false, estimateBytes: null, estimateFromDuration: true }), null);
  assert.equal(plan.estimateVideoBytes('3M', null), null);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'filetools', 'panel.css'), 'utf8');
  assert.match(css, /\.split \+ \.levels \{ margin-top: 12px; \}/);
  assert.match(css, /\.levels button\.seg\.on:disabled \{[^}]*background: transparent/);
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'filetools', 'panel.js'), 'utf8');
  assert.match(panel, /预览生成中/);
  assert.match(panel, /filetoolsVisibleEstimate/);
});

test('each Mac package keeps only its own ffmpeg', () => {
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const pkg = require('../package.json');
  const from = path.resolve(__dirname, '..');
  function keep(archName, rel, isDir) {
    const matcher = new FileMatcher(from, path.join(from, 'out-test'), (pattern) => pattern.split('${arch}').join(archName));
    for (const p of pkg.build.files) matcher.addPattern(p);
    for (const p of pkg.build.mac.files) matcher.addPattern(p);
    const filter = matcher.createFilter();
    return filter(path.join(from, rel), { isDirectory: () => !!isDir });
  }
  assert.equal(keep('arm64', 'vendor/ffmpeg/darwin-arm64/ffmpeg'), true);
  assert.equal(keep('arm64', 'vendor/ffmpeg/darwin-x64/ffmpeg'), false);
  assert.equal(keep('x64', 'vendor/ffmpeg/darwin-x64/ffmpeg'), true);
  assert.equal(keep('x64', 'vendor/ffmpeg/darwin-arm64/ffmpeg'), false);
  assert.equal(keep('arm64', 'vendor/ffmpeg/darwin-arm64/libavcodec.dylib'), true);
  assert.equal(keep('arm64', 'vendor/ffmpeg/darwin-x64/libavcodec.dylib'), false);
  assert.equal(keep('x64', 'vendor/ffmpeg/darwin-x64/libavcodec.dylib'), true);
  assert.equal(keep('arm64', 'vendor/ffmpeg/linux-x64/ffmpeg'), false);
  assert.equal(keep('arm64', 'vendor/ffmpeg/win32-x64/ffmpeg.exe'), false);
  assert.equal(keep('arm64', 'vendor/ffmpeg', true), true);
  assert.equal(keep('arm64', 'vendor/ffmpeg/darwin-arm64', true), true);
  assert.equal(keep('x64', 'vendor/ffmpeg/darwin-x64', true), true);
  assert.ok(pkg.build.win.files.includes('!vendor/ffmpeg/darwin-*/**'));
});

test('committed Mac ffmpeg and ShiftDrag match their architectures', () => {
  function header(rel) {
    const buf = fs.readFileSync(path.join(__dirname, '..', rel));
    return { magic: buf.slice(0, 4).toString('hex'), cpu: buf.readInt32LE(4), text: buf.toString('latin1') };
  }
  const arm = header('vendor/ffmpeg/darwin-arm64/ffmpeg');
  assert.equal(arm.magic, 'cffaedfe');
  assert.equal(arm.cpu, 0x0100000c);
  assert.match(arm.text, /--disable-gpl/);
  assert.equal(arm.text.includes('--enable-gpl'), false);
  assert.equal(arm.text.includes('--enable-libx264'), false);
  assert.match(arm.text, /h264_videotoolbox/);
  const x64 = header('vendor/ffmpeg/darwin-x64/ffmpeg');
  assert.equal(x64.magic, 'cffaedfe');
  assert.equal(x64.cpu, 0x01000007);
  assert.match(x64.text, /--disable-gpl/);
  assert.match(x64.text, /--disable-x86asm/);
  assert.equal(x64.text.includes('--enable-gpl'), false);
  assert.equal(x64.text.includes('--enable-libx264'), false);
  assert.match(x64.text, /h264_videotoolbox/);
  assert.equal(fs.readlinkSync(path.join(__dirname, '..', 'vendor/ffmpeg/darwin-arm64/libavcodec.dylib')), 'libavcodec.61.dylib');
  const shift = header('native/mac/ShiftDrag');
  assert.equal(shift.magic, 'cafebabe');
  assert.match(shift.text, /NSApplication/);
});

test('mac ffmpeg workflow runs on this branch and rejects gpl encoders', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ffmpeg-lgpl.yml'), 'utf8');
  assert.match(yml, /branches: \[cursor\/file-tools-v1-2b25\]/);
  assert.match(yml, /h264_videotoolbox/);
  assert.match(yml, /libx264/);
  assert.match(yml, /--disable-gpl/);
  assert.match(yml, /native\/mac\/\*\*/);
});

test('panel title follows the job action, including queued and done', () => {
  assert.equal(panelTitle({ action: 'video.compress', kind: 'compress-image', phase: 'running' }), '压缩视频');
  assert.equal(panelTitle({ action: 'video.compress', phase: 'queued' }), '压缩视频');
  assert.equal(panelTitle({ action: 'video.trim', phase: 'done' }), '剪头尾');
  assert.equal(panelTitle({ kind: 'compress-image' }), '压缩图片');
  assert.equal(panelTitle({ action: 'image.resize' }), '改尺寸');
});

test('shortcut register failure is noticed once per key', () => {
  assert.equal(registerResult(false), 'fail');
  assert.equal(registerResult(true), 'ok');
  assert.equal(registerResult(() => { throw new Error('busy'); }), 'fail');
  const names = { fileTools: '文件工具' };
  const status = { fileTools: { keyboard: registerResult(false) } };
  const hotkeys = { fileTools: { keyboard: 'Ctrl+Shift+Alt+F' } };
  const once = noticeForRegisterFailure(status, hotkeys, {}, names);
  assert.equal(once.notify, true);
  assert.match(once.body, /设置 → 快捷键/);
  assert.match(once.body, /Ctrl\+Shift\+Alt\+F/);
  const again = noticeForRegisterFailure(status, hotkeys, once.notified, names);
  assert.equal(again.notify, false);
  const changed = noticeForRegisterFailure(
    { fileTools: { keyboard: registerResult(() => { throw new Error('no'); }) } },
    { fileTools: { keyboard: 'Ctrl+Alt+9' } },
    once.notified,
    names,
  );
  assert.equal(changed.notify, true);
  const ok = noticeForRegisterFailure({ fileTools: { keyboard: 'ok' } }, hotkeys, {}, names);
  assert.equal(ok.notify, false);
});

test('Windows cancel uses taskkill /T /F before the worker can exit', () => {
  const calls = [];
  const result = killProcessTree(4242, 'win32', (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; });
  assert.equal(result.how, 'taskkill');
  assert.deepEqual(calls, [['taskkill', ['/pid', '4242', '/t', '/f']]]);
  const worker = fs.readFileSync(path.join(__dirname, '..', 'src', 'filetools', 'run-job.js'), 'utf8');
  assert.equal(worker.includes('test.hold'), false);
  const killAt = worker.indexOf('killActive()');
  const exitAt = worker.indexOf('process.exit(0)');
  assert.ok(killAt >= 0 && exitAt > killAt);
  const video = fs.readFileSync(path.join(__dirname, '..', 'src', 'filetools', 'video-ops.js'), 'utf8');
  assert.equal(/setTimeout\(\(\) => \{ try \{ child\.kill\('SIGKILL'\)/.test(video), false);
  assert.match(video, /taskkill/);
});

test('shift-drag helper is the default, and y uses the primary screen', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'filetools', 'bridge.js'), 'utf8');
  assert.equal(bridge.includes("'osascript'"), false);
  assert.match(bridge, /ShiftDrag/);
  assert.match(bridge, /msg\.type === 'up'/);
  const swift = fs.readFileSync(path.join(__dirname, '..', 'native', 'mac', 'ShiftDrag.swift'), 'utf8');
  assert.match(swift, /NSApplication/);
  assert.match(swift, /screens\.first/);
  assert.equal(/map \{ \$0\.frame\.maxY \}/.test(swift), false);
});

test('opaque images become JPEG in a PDF, and encrypted PDFs get a clear error', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'pdf2-'));
  const jpg = path.join(dir, 'photo.jpg');
  await require('sharp')({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).jpeg().toFile(jpg);
  const alpha = path.join(dir, 'alpha.png');
  await require('sharp')({ create: { width: 12, height: 12, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.4 } } }).png().toFile(alpha);
  const jpgPdf = path.join(dir, 'jpg.pdf');
  await makePdf([jpg], jpgPdf);
  assert.equal(fs.readFileSync(jpgPdf).includes(Buffer.from('/DCTDecode')), true);
  const alphaPdf = path.join(dir, 'alpha.pdf');
  await makePdf([alpha], alphaPdf);
  assert.equal(fs.readFileSync(alphaPdf).includes(Buffer.from('/DCTDecode')), false);
  const locked = path.join(dir, 'locked.pdf');
  const plain = await PDFDocument.create();
  plain.addPage([80, 40]);
  const raw = Buffer.from(await plain.save()).toString('latin1').replace('/Root', '/Encrypt 1 0 R /Root');
  fs.writeFileSync(locked, raw, 'latin1');
  await assert.rejects(() => makePdf([locked], path.join(dir, 'nope.pdf')), (e) => e.code === 'EPDF_ENCRYPTED' && e.message === ENCRYPTED);
  const mapped = friendlyPdfError(new Error('Input document to `PDFDocument.load` is encrypted.'));
  assert.equal(mapped.code, 'EPDF_ENCRYPTED');
});

function bundledFfmpegPids() {
  const bin = process.env.BILLYSHOT_FFMPEG;
  const r = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  return r.stdout.split('\n').filter((line) => line.includes(bin)).map((line) => Number(line.trim().split(/\s+/)[0])).filter((n) => n > 0);
}

async function h264Clip(file, size, seconds) {
  const made = spawnSync('/usr/bin/ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=12:duration=${seconds}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', file,
  ], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr && made.stderr.slice(-400));
}

test('JobRunner video actions use the bundled ffmpeg and a .part output', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(root, 'e2e-'));
  const src = path.join(dir, 'in.mp4');
  await h264Clip(src, '160x120', 1);
  const runner = new JobRunner();
  const specs = [
    { action: 'video.mp4', options: {} },
    { action: 'video.compress', options: { level: 'small' } },
    { action: 'video.trim', options: { start: 0, end: 0.4 } },
    { action: 'video.gif', options: { start: 0, end: 0.4 } },
  ];
  for (const spec of specs) {
    const job = runner.start({ action: spec.action, inputs: [src], options: spec.options });
    assert.ok(job.partial.endsWith('.part'));
    await waitFor(() => job.state === 'done' || job.state === 'error', 90000);
    assert.equal(job.state, 'done', job.message || spec.action);
    assert.equal(fs.existsSync(job.finalPath), true);
    assert.equal(fs.existsSync(job.partial), false);
    const buf = fs.readFileSync(job.finalPath);
    if (spec.action === 'video.gif') assert.equal(buf.slice(0, 3).toString(), 'GIF');
    else assert.equal(buf.slice(0, 64).includes(Buffer.from('ftyp')), true);
  }
  runner.dispose();
});

test('cancelling a real ffmpeg job kills it and deletes the partial', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(root, 'e2e-cancel-'));
  const src = path.join(dir, 'long.mp4');
  await h264Clip(src, '640x360', 6);
  const before = new Set(bundledFfmpegPids());
  let asked = false;
  const runner = new JobRunner({
    onUpdate(job, info) {
      if (!asked && info && info.progress && info.progress.ratio != null) {
        asked = true;
        runner.cancel(job.id);
      }
    },
  });
  const job = runner.start({ action: 'video.compress', inputs: [src], options: { level: 'high' } });
  await waitFor(() => job.state === 'cancelled' || job.state === 'done' || job.state === 'error', 45000);
  assert.equal(job.state, 'cancelled', job.message || '');
  assert.equal(fs.existsSync(job.partial), false);
  assert.equal(fs.existsSync(job.finalPath), false);
  await new Promise((r) => setTimeout(r, 300));
  const leftover = bundledFfmpegPids().filter((pid) => !before.has(pid) && alive(pid));
  assert.deepEqual(leftover, []);
  runner.dispose();
});

// ---- 1.4.1：冷启动后第一次 Shift 拖 ----
function fakeElectron() {
  const wins = [];
  const handlers = {};
  class FakeWin {
    constructor(opts) {
      this.opts = opts; this.visible = false; this.bounds = null; this.sent = []; this.destroyed = false; this.file = '';
      const self = this;
      this.webContents = {
        isLoading: () => false,
        once: (_ev, fn) => fn(),
        on: () => {},
        send: (ch, payload) => self.sent.push({ ch, payload }),
      };
      wins.push(this);
    }
    setAlwaysOnTop(on, level) { this.level = on ? level : null; } setVisibleOnAllWorkspaces() {} setMenu() {}
    loadFile(f) { this.file = String(f); }
    on() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() {}
    setBounds(b) { this.bounds = b; }
    getContentSize() { return [this.opts.width, this.opts.height]; }
    setContentSize(w, h) { this.opts.width = w; this.opts.height = h; }
    invalidateShadow() { this.shadowRefreshed = (this.shadowRefreshed || 0) + 1; }
  }
  const deps = {
    BrowserWindow: FakeWin,
    ipcMain: { on: (ch, fn) => { handlers[ch] = fn; } },
    screen: {
      getCursorScreenPoint: () => ({ x: 600, y: 500 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 28, width: 1496, height: 877 } }),
    },
    shell: { showItemInFolder() {} }, dialog: {}, Notification: null, nativeImage: null,
    app: { isQuitting: false },
    settings: { get: () => ({ fileTools: { shiftDrag: true }, hotkeys: {} }) },
    t: (s) => s, isMac: true, isWin: false, log: () => {},
    R: (...p) => path.join(__dirname, '..', 'src', ...p),
    getTray: () => null, trayIcon: () => null,
  };
  const arcWin = () => wins.find((w) => w.file.endsWith('arc.html'));
  const panelWin = () => wins.find((w) => w.file.endsWith('filepanel.html'));
  return { deps, handlers, wins, arcWin, panelWin };
}

test('first Shift-drag after a cold start shows the arc and accepts the drop', { timeout: 20000 }, async () => {
  const { createFileTools } = require('../src/filetools/bridge');
  const { deps, handlers, arcWin } = fakeElectron();
  const ft = createFileTools(deps);
  try {
    const png = path.join(root, 'cold-start.png');
    await samplePng(png, 40, 30, 'teal');
    assert.equal(arcWin(), undefined, 'no arc window before the first drag');

    // helper：Shift 拖开始、移动
    ft.helperMessage({ type: 'shift-drag', x: 590, y: 495 });
    ft.helperMessage({ type: 'move', x: 600, y: 500 });
    const win = arcWin();
    assert.ok(win && win.visible, 'catcher window is shown at the cursor');
    // macOS 只把拖放交给层级低于拖放图标（500）的窗口；screen-saver 是 1000，拖放会穿过去。
    assert.notEqual(win.level, 'screen-saver');
    assert.ok(['floating', 'torn-off-menu', 'modal-panel', 'main-menu', 'status', 'pop-up-menu'].includes(win.level), 'arc window level stays below the drag level: ' + win.level);
    const caught = win.sent.filter((m) => m.ch === 'filetools:catch');
    assert.ok(caught.length >= 1, 'renderer is told to draw the hit-testable catch ring');
    const last = caught[caught.length - 1].payload;
    assert.equal(win.bounds.x + last.hubx, 600);
    assert.equal(win.bounds.y + last.huby, 500);

    // helper 的 up 比 drop 先到：窗口不能马上收起
    ft.helperMessage({ type: 'up', x: 600, y: 500 });
    assert.equal(win.visible, true, 'mouse-up does not hide the catcher before the drop arrives');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(win.visible, true);

    // 渲染端在没有弧的状态下也把 drop 交给主进程
    handlers['filetools:drop']({}, { files: [png], dx: 0, dy: 0 });
    const arc = await waitFor(() => win.sent.find((m) => m.ch === 'filetools:arc'), 10000);
    assert.equal(arc.payload.model.keys[0].action, 'image.convert');
    assert.equal(arc.payload.model.keys[0].label, '转格式');
    assert.ok(arc.payload.model.keys[0].pills.some((p) => p.format === 'jpg'));
    assert.deepEqual(arc.payload.files, [png]);
    // 宽限期过了也不会把画好的弧收掉
    await new Promise((r) => setTimeout(r, 900));
    assert.equal(win.visible, true, 'the drawn arc stays open after the grace period');
  } finally { ft.dispose(); }
});

test('Shift-drag released without a drop closes the catcher after a short grace', async () => {
  const { createFileTools } = require('../src/filetools/bridge');
  const { deps, arcWin } = fakeElectron();
  const ft = createFileTools(deps);
  try {
    ft.helperMessage({ type: 'shift-drag', x: 600, y: 500 });
    ft.helperMessage({ type: 'up', x: 600, y: 500 });
    assert.equal(arcWin().visible, true);
    await waitFor(() => !arcWin().visible, 3000);
    ft.helperMessage({ type: 'shift-drag', x: 600, y: 500 });
    ft.helperMessage({ type: 'shift-up' });
    assert.equal(arcWin().visible, false, 'letting go of Shift mid-drag closes at once');
  } finally { ft.dispose(); }
});

test('arc renderer forwards a cold-start drop and has no stray hub', () => {
  const vm = require('vm');
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const els = {};
  const mk = (id) => ({
    id, hidden: false, innerHTML: '', style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
    appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  const docListeners = {};
  const body = mk('body');
  const document = {
    body,
    getElementById: (id) => (els[id] = els[id] || mk(id)),
    createElement: () => mk('x'), createElementNS: () => mk('x'),
    querySelectorAll: () => [],
    addEventListener: (n, fn) => { docListeners[n] = fn; },
  };
  const sent = [];
  const onHandlers = {};
  const api = {
    send: (ch, payload) => sent.push({ ch, payload }),
    on: (ch, fn) => { onHandlers[ch] = fn; },
    pathForFile: () => '/tmp/cold.png',
  };
  const ctx = { document, api, window: {}, setTimeout, clearTimeout, getComputedStyle: () => ({}), console };
  ctx.window = ctx; ctx.window.api = api; ctx.innerWidth = 600; ctx.innerHeight = 400;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'filetools', 'arc.js'), 'utf8'), ctx);
  assert.ok(onHandlers['filetools:catch'], 'listens for the catch message');

  onHandlers['filetools:catch']({ hubx: 300, huby: 200 });
  assert.equal(els.catch.hidden, false);
  assert.equal(els.catch.style.left, '300px');
  assert.equal(els.hub.hidden, true);
  assert.ok(body.classList.contains('catching'));

  docListeners.drop({ preventDefault() {}, clientX: 300, clientY: 200, dataTransfer: { files: [{}] } });
  const drop = sent.find((m) => m.ch === 'filetools:drop');
  assert.ok(drop, 'a drop with no arc drawn still goes to main');
  assert.deepEqual(Array.from(drop.payload.files), ['/tmp/cold.png']);

  const html = fs.readFileSync(path.join(dir, 'arc.html'), 'utf8');
  assert.match(html, /id="catch"/);
  const css = fs.readFileSync(path.join(dir, 'filetools', 'arc.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  const bg = css.match(/body\.catching\s*\{\s*background:\s*rgba\(([^)]*)\)/);
  assert.ok(bg, 'catcher body has a background');
  const alpha = Number(bg[1].split(',')[3]);
  assert.ok(alpha > 0 && alpha < 0.05, 'catcher background is hit-testable but nearly invisible');
  // 接收圈的样式不能套到 body 上（body 带 catching 类）：选择器只认 .catch-ring
  assert.doesNotMatch(css, /(^|[\s,}])\.catching\s*\{/m, 'no bare .catching rule that would also style <body>');
  assert.match(css, /\.catch-ring\s*\{[^}]*position:\s*absolute/);
  assert.match(html, /class="catch-ring"/);
});

// ---- 1.4.1：完成面板 ----
function loadPanelRenderer(panelHeight) {
  const vm = require('vm');
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const els = {};
  const mk = (id) => ({
    id, hidden: false, innerHTML: '', textContent: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: id === 'panel' ? panelHeight : 0, width: 500, height: id === 'panel' ? panelHeight : 0 }),
  });
  const docListeners = {};
  const document = {
    body: mk('body'),
    getElementById: (id) => (els[id] = els[id] || mk(id)),
    createElement: () => mk('x'), createElementNS: () => mk('x'),
    querySelectorAll: () => [],
    addEventListener: (n, fn) => { docListeners[n] = fn; },
  };
  const sent = [];
  const onHandlers = {};
  const api = { send: (ch, payload) => sent.push({ ch, payload }), on: (ch, fn) => { onHandlers[ch] = fn; } };
  const ctx = { document, api, setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(), getComputedStyle: () => ({}), console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'filetools', 'panel.js'), 'utf8'), ctx);
  const esc = () => docListeners.keydown({ key: 'Escape', preventDefault() {} });
  return { sent, onHandlers, esc };
}

test('done panel has one close control, fits its content and closes on Esc', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer');
  const html = fs.readFileSync(path.join(dir, 'filepanel.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'filetools', 'panel.css'), 'utf8');
  // 只有一个关闭：自绘的 ×，没有假的红绿灯
  assert.equal((html.match(/class="x"/g) || []).length, 1, 'exactly one close control');
  assert.doesNotMatch(html, /<i><\/i>/, 'no fake traffic-light dots');
  assert.doesNotMatch(css, /\.drag i\b/, 'no traffic-light dot styles left');
  assert.doesNotMatch(css, /#ff5f57/i, 'no red close dot');
  // 面板外面不画大阴影：窗口和面板一样大，阴影交给系统
  const panelRule = css.match(/\.panel\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(panelRule, /24px 60px/, 'no outer CSS shadow that needs a taller window');

  const { sent, onHandlers, esc } = loadPanelRenderer(268);
  onHandlers['filetools:panel']({ phase: 'done', action: 'image.convert', file: '/tmp/a.jpg', fileName: 'a.jpg', bytes: 4700, measured: true, revealLabel: '在 Finder 中显示' });
  const size = sent.filter((m) => m.ch === 'filetools:panel-size').pop();
  assert.ok(size, 'renderer reports its height after drawing');
  assert.equal(size.payload.height, 268);

  sent.length = 0;
  esc();
  assert.deepEqual(sent.map((m) => m.ch), ['filetools:close-panel'], 'Esc closes the done panel');

  // 进行中 Esc 仍然是取消任务
  onHandlers['filetools:panel']({ phase: 'running', id: 7, action: 'image.convert', ratio: 0.5 });
  sent.length = 0;
  esc();
  assert.deepEqual(sent.map((m) => m.ch), ['filetools:cancel']);
});

test('done panel window shrinks to the reported height, so no empty strip is left under it', { timeout: 30000 }, async () => {
  const { createFileTools } = require('../src/filetools/bridge');
  const { deps, handlers, panelWin } = fakeElectron();
  const ft = createFileTools(deps);
  try {
    const png = path.join(root, 'panel-done.png');
    await samplePng(png, 40, 30, 'navy');
    handlers['filetools:run']({}, { action: 'image.convert', files: [png], options: { format: 'jpg' } });
    const win = await waitFor(() => { const w = panelWin(); return w && w.sent.find((m) => m.ch === 'filetools:panel' && m.payload.phase === 'done') && w; }, 20000);
    assert.equal(win.opts.frame, false, 'frameless: no native traffic lights next to the custom ×');

    handlers['filetools:panel-size']({ sender: win.webContents }, { height: 268 });
    assert.deepEqual(win.getContentSize(), [500, 268], 'window is exactly as tall as the panel');
    assert.ok(win.shadowRefreshed >= 1, 'window shadow is recomputed after the resize');
    assert.equal(win.visible, true);

    // 收起后，迟到的尺寸消息不会把面板重新弹出来
    handlers['filetools:close-panel']();
    handlers['filetools:panel-size']({ sender: win.webContents }, { height: 300 });
    assert.equal(win.visible, false);
    // 别的窗口发来的尺寸不算
    handlers['filetools:panel-size']({ sender: {} }, { height: 600 });
    assert.deepEqual(win.getContentSize(), [500, 300]);
  } finally { ft.dispose(); }
});

test('the label under each arc circle is part of its button and clickable', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'filetools', 'arc.css'), 'utf8');
  const cap = css.match(/\.key \.cap\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(cap, /pointer-events:\s*none/, 'label does not let clicks fall through');
  assert.match(cap, /pointer-events:\s*auto/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'filetools', 'arc.js'), 'utf8');
  // 字是按钮的子元素，点字就是点按钮
  assert.match(js, /btn\.appendChild\(face\);\s*btn\.appendChild\(cap\);/);
  // 子选项（→ JPG）叠在字上面时，还是子选项先收到点击
  const z = (sel) => Number((css.match(new RegExp(sel + '[^{]*\\{[^}]*z-index:\\s*(\\d+)')) || [])[1]);
  assert.ok(z('\\.pills') > z('\\.key'), 'pills stay above the labels');
});

test('mouse-moves while the arc window loads add one load listener and deliver the latest position', () => {
  const { createFileTools } = require('../src/filetools/bridge');
  const { deps, arcWin } = fakeElectron();
  const ft = createFileTools(deps);
  try {
    ft.helperMessage({ type: 'shift-drag', x: 590, y: 495 });
    const win = arcWin();
    // 第一次之后的窗口：模拟「还在加载」，记下挂上的 did-finish-load
    const loads = [];
    win.webContents.isLoading = () => true;
    win.webContents.once = (ev, fn) => { if (ev === 'did-finish-load') loads.push(fn); };
    win.sent.length = 0;
    for (let i = 1; i <= 15; i++) ft.helperMessage({ type: 'move', x: 600 + i, y: 500 + i });
    assert.equal(loads.length, 1, 'at most one did-finish-load listener while loading');
    assert.equal(win.sent.filter((m) => m.ch === 'filetools:catch').length, 0, 'nothing sent before the page loads');

    win.webContents.isLoading = () => false;
    loads[0]();
    const caught = win.sent.filter((m) => m.ch === 'filetools:catch');
    assert.equal(caught.length, 1, 'one catch message after load');
    assert.equal(win.bounds.x + caught[0].payload.hubx, 615, 'latest x is delivered');
    assert.equal(win.bounds.y + caught[0].payload.huby, 515, 'latest y is delivered');

    // 加载完以后照常每次直接发
    ft.helperMessage({ type: 'move', x: 620, y: 520 });
    assert.equal(win.sent.filter((m) => m.ch === 'filetools:catch').length, 2);
    assert.equal(loads.length, 1);
  } finally { ft.dispose(); }
});

// 1.4.1：打包后的布局。utilityProcess 里没有 app，ffmpeg-bin 不能指到 app.asar 里面（spawn 会 ENOENT）。
function packagedLayout() {
  const res = fs.mkdtempSync(path.join(root, 'packaged-')) + path.sep + 'resources';
  const asarSrc = path.join(res, 'app.asar', 'src', 'filetools');
  fs.mkdirSync(asarSrc, { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'filetools'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(__dirname, '..', 'src', 'filetools', f), path.join(asarSrc, f));
  }
  // app.asar 里也“看得到”一个 ffmpeg，但它不能执行，和真实 asar 一样。
  const fake = path.join(res, 'app.asar', 'vendor', 'ffmpeg', 'linux-x64');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, 'ffmpeg'), 'not runnable inside asar\n', { mode: 0o644 });
  const real = path.join(res, 'app.asar.unpacked', 'vendor', 'ffmpeg', 'linux-x64');
  fs.mkdirSync(real, { recursive: true });
  fs.copyFileSync(process.env.BILLYSHOT_FFMPEG, path.join(real, 'ffmpeg'));
  fs.chmodSync(path.join(real, 'ffmpeg'), 0o755);
  return { res, asarSrc, realBin: path.join(real, 'ffmpeg') };
}

test('ffmpeg-bin never returns a path inside app.asar, with or without app', () => {
  const { unpackedPath, insideAsar, roots, ffmpegBin } = require('../src/filetools/ffmpeg-bin');
  assert.equal(unpackedPath('/A/Resources/app.asar/vendor/ffmpeg'), '/A/Resources/app.asar.unpacked/vendor/ffmpeg');
  assert.equal(unpackedPath('C:\\P\\BillyShot\\resources\\app.asar\\vendor\\ffmpeg'), 'C:\\P\\BillyShot\\resources\\app.asar.unpacked\\vendor\\ffmpeg');
  assert.equal(unpackedPath('/x/app.asar.unpacked/vendor'), '/x/app.asar.unpacked/vendor');
  assert.equal(unpackedPath('/x/my.app.asarish/vendor'), '/x/my.app.asarish/vendor');
  const { res, asarSrc, realBin } = packagedLayout();
  const env = { dirname: asarSrc, resourcesPath: res, ffmpeg: '', ffmpegRoot: '', platform: 'linux', arch: 'x64' };
  for (const r of roots(env)) assert.equal(insideAsar(r), false, r);
  assert.equal(ffmpegBin(env), realBin);
  // utilityProcess 里有 resourcesPath 但没有 app；Windows 布局也一样。
  const seen = [];
  const win = ffmpegBin({ dirname: 'C:\\BS\\resources\\app.asar\\src\\filetools', resourcesPath: 'C:\\BS\\resources', ffmpeg: '', ffmpegRoot: '', platform: 'win32', arch: 'x64', existsSync: (p) => { seen.push(p); return !insideAsar(p); } });
  assert.match(win, /app\.asar\.unpacked[\\/]vendor[\\/]ffmpeg[\\/]win32-x64[\\/]ffmpeg\.exe$/);
  assert.equal(seen.some(insideAsar), false);
  // 主进程传下来的路径如果误指 app.asar，也换成 unpacked。
  assert.equal(ffmpegBin({ ffmpeg: path.join(res, 'app.asar', 'vendor', 'ffmpeg', 'linux-x64', 'ffmpeg') }), realBin);
});

test('main hands the resolved ffmpeg to the file-job worker', () => {
  const { workerEnv } = require('../src/filetools/jobs');
  const env = workerEnv({ PATH: '/bin' }, () => '/R/app.asar.unpacked/vendor/ffmpeg/darwin-arm64/ffmpeg');
  assert.equal(env.BILLYSHOT_FFMPEG, '/R/app.asar.unpacked/vendor/ffmpeg/darwin-arm64/ffmpeg');
  assert.equal(env.PATH, '/bin');
  assert.equal(workerEnv({ BILLYSHOT_FFMPEG: '/keep' }, () => '/other').BILLYSHOT_FFMPEG, '/keep');
  assert.equal('BILLYSHOT_FFMPEG' in workerEnv({}, () => null), false);
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'src', 'filetools', 'jobs.js'), 'utf8');
  assert.match(jobs, /utilityProcess\.fork\([^)]*env: workerEnv\(\)/);
});

test('packaged layout without app: the job worker runs all four video actions with the unpacked ffmpeg', { timeout: 180000 }, async () => {
  const { res, asarSrc } = packagedLayout();
  const dir = fs.mkdtempSync(path.join(root, 'pkg-video-'));
  const src = path.join(dir, 'in.mp4');
  await h264Clip(src, '160x120', 2);
  const { fork } = require('child_process');
  const env = { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules') };
  delete env.BILLYSHOT_FFMPEG;
  delete env.BILLYSHOT_FFMPEG_ROOT;
  delete env.ELECTRON_RUN_AS_NODE;
  const runJob = (job) => new Promise((resolve) => {
    // 与 utilityProcess 一样：worker 脚本在 app.asar 里，进程里没有 electron 的 app。
    const child = fork(path.join(asarSrc, 'run-job.js'), [], { env, cwd: res, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let last = null;
    child.on('message', (m) => { if (m && m.type !== 'progress') last = m; });
    child.on('exit', () => resolve(last));
    child.send(job);
  });
  const cases = [
    ['video.mp4', {}, '-mp4.mp4'],
    ['video.compress', { level: 'small' }, '-small.mp4'],
    ['video.trim', { start: 0, end: 1 }, '-trim.mp4'],
    ['video.gif', { start: 0, end: 1 }, '.gif'],
  ];
  for (const [action, options, tail] of cases) {
    const finalPath = path.join(dir, `out${tail}`);
    const msg = await runJob({ action, inputs: [src], options, finalPath, partial: finalPath + '.part' });
    assert.equal(msg && msg.type, 'done', `${action}: ${JSON.stringify(msg)}`);
    assert.equal(fs.existsSync(finalPath + '.part'), false);
    const buf = fs.readFileSync(finalPath);
    if (action === 'video.gif') assert.equal(buf.slice(0, 3).toString(), 'GIF');
    else assert.equal(buf.slice(0, 64).includes(Buffer.from('ftyp')), true);
  }
  // 超过 15 秒的 GIF 在同一条路径上照样被拒绝。
  const long = path.join(dir, 'long.mp4');
  await h264Clip(long, '160x120', 17);
  const refused = await runJob({ action: 'video.gif', inputs: [long], options: { start: 0, end: 16 }, finalPath: path.join(dir, 'long.gif'), partial: path.join(dir, 'long.gif.part') });
  assert.equal(refused.type, 'error');
  assert.equal(refused.code, 'GIF_TOO_LONG');
  assert.equal(fs.existsSync(path.join(dir, 'long.gif.part')), false);
});

test('NSIS sidebar File paths use backslashes so Windows makensis finds them', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /!define BILLY_SIDEBAR_DIR "\$\{__FILEDIR__\}\\sidebar"/);
  const files = nsh.split(/\r?\n/).filter((l) => /^\s*File\s/.test(l));
  assert.equal(files.length, 8);
  for (const line of files) {
    const m = line.match(/"\$\{BILLY_SIDEBAR_DIR\}\\(side-\d+\.bmp)"\s*$/);
    assert.ok(m, line);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'build', 'sidebar', m[1])), true, m[1]);
  }
});
