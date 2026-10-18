// 视频只调用 LGPL ffmpeg。H.264 用系统硬件编码器；没有就退到 LGPL 的 mpeg4，从不用 libx264。
const { spawn, spawnSync } = require('child_process');
const { ffmpegBin, listEncoders } = require('./ffmpeg-bin');
const { encodePlan, codecArgs, LEVELS, scaleFilter, FORBIDDEN_ENCODERS, parseProgress } = require('./plan');

let encoderCache = null;
let activeChild = null;

// Windows 上 worker 退出很快，400ms 后再 SIGKILL 根本来不及，ffmpeg 会变成孤儿。
// 所以在 worker 退出之前同步杀掉整棵进程树：Windows 用 taskkill /T /F，其他系统直接 SIGKILL。
function killProcessTree(pid, platform = process.platform, spawnSyncImpl = spawnSync) {
  if (!pid) return { killed: false };
  if (platform === 'win32') {
    spawnSyncImpl('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return { killed: true, how: 'taskkill' };
  }
  try { process.kill(pid, 'SIGKILL'); } catch {}
  return { killed: true, how: 'SIGKILL' };
}

function killActive() {
  const child = activeChild;
  activeChild = null;
  if (!child || !child.pid) return { killed: false };
  return killProcessTree(child.pid);
}
function encoders() {
  if (encoderCache) return encoderCache;
  const bin = ffmpegBin();
  if (!bin) throw Object.assign(new Error('未找到 LGPL ffmpeg。请按 docs/file-tools-licensing.md 编译后再试。'), { code: 'ENOFFMPEG' });
  encoderCache = listEncoders(bin);
  return encoderCache;
}

function assertNoGpl(args) {
  const hit = args.find((a) => FORBIDDEN_ENCODERS.includes(a));
  if (hit) throw Object.assign(new Error('refusing ' + hit), { code: 'EGPL' });
}

function durationSeconds(bin, file) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('error', () => resolve(null));
    child.on('exit', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(null);
      if (m[0].includes('N/A')) return resolve(null);
      const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null);
    });
  });
}

function buildArgs({ action, input, output, options, encoder, platform, arch, duration }) {
  const level = LEVELS[options.level || 'medium'] || LEVELS.medium;
  const bitrate = action === 'video.mp4' ? '8M' : level.bitrate;
  const qv = action === 'video.mp4' ? '65' : level.qv;
  const maxWidth = action === 'video.compress' ? level.maxWidth : 0;
  if (action === 'video.gif') {
    const start = Number(options.start) || 0;
    const end = options.end == null ? null : Number(options.end);
    const span = end == null ? (duration == null ? null : duration - start) : end - start;
    // 没有明确的 ≤15 秒区间就不编码：不偷偷截成 15 秒，也不悄悄转完整段。
    if (span == null) throw Object.assign(new Error('先剪头尾'), { code: 'GIF_NEEDS_TRIM' });
    if (span > 15.001) throw Object.assign(new Error('先剪头尾'), { code: 'GIF_TOO_LONG' });
    const vf = ['fps=12', 'scale=480:-2:flags=lanczos', 'split[s0][s1]', '[s0]palettegen=stats_mode=diff[p]', '[s1][p]paletteuse'].join(',');
    const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', input, '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    else if (span != null) args.push('-t', String(span));
    // 半成品是 *.gif.part。不写 -f 的话 ffmpeg 认不出封装，会报 Invalid argument。
    args.push('-filter_complex', vf, '-loop', '0', '-f', 'gif', output);
    assertNoGpl(args);
    return { args, indeterminate: span == null && end == null && duration == null };
  }
  const vargs = codecArgs(encoder, { platform, arch, bitrate, qv });
  const vf = scaleFilter(maxWidth);
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', input];
  if (action === 'video.trim') {
    args.push('-ss', String(Number(options.start) || 0));
    if (options.end != null) args.push('-to', String(Number(options.end)));
  }
  args.push('-map', '0:v:0', '-map', '0:a:0?');
  if (vf) args.push('-vf', vf);
  args.push(...vargs, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', output);
  assertNoGpl(args);
  return { args, indeterminate: !duration };
}

function spawnFfmpeg(bin, args, { duration, onProgress, isCancelled }) {
  return new Promise((resolve, reject) => {
    // 不单独脱离：ffmpeg 留在任务进程的组里，取消时一组杀掉。脱离的话会变成孤儿进程。
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    activeChild = child;
    try { require('os').setPriority(child.pid, 19); } catch {}
    if (process.platform === 'darwin') {
      try { spawn('/usr/sbin/taskpolicy', ['-b', '-p', String(child.pid)], { stdio: 'ignore' }); } catch {}
    }
    let stderr = '';
    let buf = '';
    const timer = setInterval(() => {
      if (isCancelled && isCancelled()) kill();
    }, 120);
    const kill = () => { killProcessTree(child.pid); };
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.stdout.on('data', (b) => {
      buf += b.toString();
      const idx = buf.lastIndexOf('\n');
      if (idx < 0) return;
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (onProgress) onProgress(parseProgress(chunk, duration));
    });
    child.on('error', (err) => { clearInterval(timer); reject(err); });
    child.on('exit', (code, signal) => {
      clearInterval(timer);
      if (activeChild === child) activeChild = null;
      if (isCancelled && isCancelled()) reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
      else if (code === 0) resolve();
      else reject(Object.assign(new Error((stderr || `ffmpeg ${signal || code}`).trim().slice(-500)), { code: 'EFFMPEG' }));
    });
  });
}

async function transcode(spec, hooks) {
  const bin = ffmpegBin();
  if (!bin) throw Object.assign(new Error('未找到 LGPL ffmpeg。请按 docs/file-tools-licensing.md 编译后再试。'), { code: 'ENOFFMPEG' });
  const duration = spec.duration != null ? spec.duration : await durationSeconds(bin, spec.input);
  if (spec.action === 'video.gif') {
    const start = Number(spec.options.start) || 0;
    const end = spec.options.end == null ? null : Number(spec.options.end);
    const span = end == null ? (duration == null ? null : duration - start) : end - start;
    if (span == null) throw Object.assign(new Error('先剪头尾'), { code: 'GIF_NEEDS_TRIM' });
    if (span > 15.001) throw Object.assign(new Error('先剪头尾'), { code: 'GIF_TOO_LONG' });
  }
  const platform = spec.platform || process.platform;
  const arch = spec.arch || process.arch;
  const plan = encodePlan(platform, spec.action === 'video.gif' ? [] : encoders());
  if (spec.action !== 'video.gif' && !plan.length) {
    throw Object.assign(new Error('这台电脑没有可用的 H.264 硬件编码器（VideoToolbox / Media Foundation），也没有 LGPL 的 mpeg4 备用编码器。'), { code: 'ENOENC' });
  }
  const encodersToTry = spec.action === 'video.gif' ? [null] : plan;
  let last;
  for (const encoder of encodersToTry) {
    const built = buildArgs({ ...spec, encoder, platform, arch, duration });
    try {
      await spawnFfmpeg(bin, built.args, { duration, onProgress: hooks.onProgress, isCancelled: hooks.isCancelled });
      return { duration, indeterminate: built.indeterminate && !duration, encoder };
    } catch (err) {
      if (err.code === 'CANCELLED' || (hooks.isCancelled && hooks.isCancelled())) throw err;
      last = err;
    }
  }
  throw last || Object.assign(new Error('encode failed'), { code: 'EFFMPEG' });
}

module.exports = { transcode, buildArgs, durationSeconds, encoders, killActive, killProcessTree };
