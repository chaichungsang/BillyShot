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
