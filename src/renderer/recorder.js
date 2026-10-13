/* BillyShot 录制核心：采集屏幕 → 裁剪/缩放 → MediaRecorder(MP4) 或 GIF Worker */
'use strict';

const log = (...a) => { console.log('[rec]', ...a); };

const BOX = { 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720], source: [4096, 4096] };
const MIME = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.4d0033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.640033,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm',
];
const MIME_NOAUDIO = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

let cfg = null;
let videoStream = null, sysStream = null, micStream = null, audioCtx = null, micGain = null;
let recorder = null, gifWorker = null;
let running = false, go = false, paused = false, stopping = false, cancelled = false;
let startWall = 0, pausedTotal = 0, pausedAt = 0;
let writeChain = Promise.resolve();
let bytes = 0;
let gifState = null;
let warnings = [];

api.on('rec:start', (c) => { cfg = c; start().catch(fail); });
let goRequested = false;
api.on('rec:go', () => { goRequested = true; setTimeout(begin, 150); });
// 若录制窗口尚未就绪，main 会在 ready 后再发 rec:go
api.on('rec:pause', (v) => setPaused(v));
api.on('rec:mic', (on) => { if (micGain) micGain.gain.value = on ? 1 : 0; });
api.on('rec:stop', (cancel) => stop(cancel));

let failing = null;
function fail(e) {
  console.error(e);
  const msg = (e && (e.message || e.name)) ? `${e.name || ''} ${e.message || ''}`.trim() : String(e);
  // 编码器还活着时先让它把缓冲里的数据吐出来，再报错（主进程会保留已录部分）
  if (recorder && recorder.state !== 'inactive' && !failing) {
    failing = msg;
    try { recorder.stop(); } catch { failing = null; }
    if (failing) { setTimeout(() => { if (failing) { const m = failing; failing = null; cleanup(); api.send('rec:error', m); } }, 3000); return; }
  }
  cleanup();
  api.send('rec:error', msg);
}

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

async function getDesktopStream(pw, ph, fps) {
  const base = { chromeMediaSource: 'desktop', chromeMediaSourceId: cfg.sourceId };
  const tries = [
    { ...base, minWidth: pw, maxWidth: pw, minHeight: ph, maxHeight: ph, maxFrameRate: fps },
    { ...base, maxWidth: pw, maxHeight: ph, maxFrameRate: fps },
    { ...base, maxFrameRate: fps },
  ];
  let lastErr;
  for (const m of tries) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: m } }); } catch (e) { lastErr = e; log('gUM try failed', e.name, e.message); }
  }
  throw lastErr;
}

async function start() {
  const b = cfg.display.bounds, sf = cfg.display.scaleFactor || 1;
  const pw = Math.round(b.width * sf), ph = Math.round(b.height * sf);
  const fps = cfg.format === 'gif' ? Math.max(cfg.gifFps || 12, 15) : (cfg.fps || 30);
  // 输出会缩小时（例如 4K 屏录 1080p），直接按需要的分辨率采集，省掉大量缩放运算，减少掉帧
  const rw = cfg.rect.w * sf, rh = cfg.rect.h * sf;
  let pre = 1;
  if (cfg.format === 'gif') pre = Math.min(1, (cfg.gifMaxWidth || 960) / rw, Math.sqrt(1.3e6 / (rw * rh)));
  else { const [bl0, bs0] = BOX[cfg.quality] || BOX[1080]; pre = Math.min(1, bl0 / Math.max(rw, rh), bs0 / Math.min(rw, rh)); }
  const capW = pre < 0.98 ? even(pw * pre) : pw, capH = pre < 0.98 ? even(ph * pre) : ph;
  videoStream = await getDesktopStream(capW, capH, fps);
  const track = videoStream.getVideoTracks()[0];
  const st = track.getSettings();
  const k = (st.width || capW) / b.width;
  const kx = k, ky = (st.height || capH) / b.height;
  let sx = Math.round(cfg.rect.x * kx), sy = Math.round(cfg.rect.y * ky);
  let sw = Math.round(cfg.rect.w * kx), sh = Math.round(cfg.rect.h * ky);
  sw = Math.min(sw, (st.width || capW) - sx); sh = Math.min(sh, (st.height || capH) - sy);
  let scale = 1;
  if (cfg.format === 'gif') scale = Math.min(1, (cfg.gifMaxWidth || 960) / sw, Math.sqrt(1.3e6 / (sw * sh)));
  else {
    const [bl, bs] = BOX[cfg.quality] || BOX[1080];
    const long = Math.max(sw, sh), short = Math.min(sw, sh);
    scale = Math.min(1, bl / long, bs / short);
  }
  const outW = even(sw * scale), outH = even(sh * scale);
  const passthrough = cfg.format !== 'gif' && sx === 0 && sy === 0 && sw === st.width && sh === st.height && outW === sw && outH === sh;
  cfg.crop = { sx, sy, sw, sh, outW, outH, passthrough, captureW: st.width, captureH: st.height };
  log('capture', JSON.stringify(cfg.crop));

  // 音频
  const audioTracks = [];
  if (cfg.format !== 'gif' && (cfg.systemAudio || cfg.mic)) {
    audioCtx = new AudioContext({ sampleRate: 48000 });
    const dest = audioCtx.createMediaStreamDestination();
    if (cfg.systemAudio) {
      try {
        sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        sysStream.getVideoTracks().forEach((t) => { t.stop(); sysStream.removeTrack(t); });
        if (sysStream.getAudioTracks().length) audioCtx.createMediaStreamSource(sysStream).connect(dest);
        else warnings.push(tx('未能获取系统声音'));
      } catch (e) { warnings.push(tx('系统声音不可用：') + e.message); log('sys audio failed', e.message); }
    }
    if (cfg.mic) {
      try {
        // 1.2.3：开回声消除，减少喇叭声被麦克风再录一次；关自动增益，避免没人说话时把喇叭声放大
        const c = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
        if (cfg.micDeviceId) c.deviceId = { exact: cfg.micDeviceId };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: c, video: false });
        micGain = audioCtx.createGain();
        audioCtx.createMediaStreamSource(micStream).connect(micGain).connect(dest);
      } catch (e) { warnings.push(tx('麦克风不可用：') + e.message); log('mic failed', e.message); }
    }
    if (sysStream || micStream) audioTracks.push(...dest.stream.getAudioTracks());
  }

  // 视频处理管线
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  let generator = null, writer = null;
  if (cfg.format !== 'gif') {
    generator = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = generator.writable.getWriter();
  }
  const canvas = new OffscreenCanvas(outW, outH);
  const c2d = canvas.getContext('2d', { alpha: false, willReadFrequently: cfg.format === 'gif' });
  c2d.imageSmoothingQuality = 'high';

  if (cfg.format === 'gif') {
    gifWorker = new Worker('gif-worker.js', { type: 'module' });
    gifWorker.postMessage({ type: 'init', w: outW, h: outH });
    gifState = { interval: 1000 / (cfg.gifFps || 12), lastTs: null, pending: null, frames: 0, encoded: 0, posted: 0, pauseGap: 0 };
    gifWorker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        gifState.encoded = e.data.frames;
        // 停止以后还在编码的剩余帧：告诉控制条进度
        if (stopping && !cancelled) api.send('rec:progress', { state: 'encoding', done: e.data.frames, total: Math.max(gifState.posted, e.data.frames) });
      }
      if (e.data.type === 'done') {
        if (!cancelled) {
          // 分块发送，避免超大 GIF 一次性 IPC
          const all = new Uint8Array(e.data.bytes); const CH = 8 * 1024 * 1024;
          for (let i = 0; i < all.length; i += CH) api.send('rec:chunk', all.slice(i, i + CH).buffer);
        }
        cleanup();
        api.send('rec:done', { cancelled });
      }
    };
  } else {
    const types = audioTracks.length ? MIME : MIME_NOAUDIO;
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const px = outW * outH * (cfg.fps || 30);
    const vbps = cfg.bitrate ? cfg.bitrate * 1e6 : Math.round(Math.min(80e6, Math.max(4e6, px * 0.13)));
    const ms = new MediaStream([generator, ...audioTracks]);
    recorder = new MediaRecorder(ms, { mimeType, videoBitsPerSecond: vbps, audioBitsPerSecond: 192000 });
    cfg.mimeType = recorder.mimeType || mimeType; cfg.vbps = vbps;
    log('recorder', cfg.mimeType, vbps);
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      writeChain = writeChain.then(async () => {
        const ab = await e.data.arrayBuffer();
        bytes += ab.byteLength;
        if (!cancelled) api.send('rec:chunk', ab);
      });
    };
    recorder.onstop = () => {
      writeChain.then(() => {
        cleanup();
        if (failing) { const m = failing; failing = null; api.send('rec:error', m); }
        else api.send('rec:done', { cancelled });
      });
    };
    recorder.onerror = (e) => fail(e.error || new Error(tx('MediaRecorder 错误')));
  }

  vCtx = c2d; vCanvas = canvas; vWriter = writer;
  track.addEventListener('ended', () => { if (running && !stopping) stop(false); });
  running = true;

  (async () => {
    while (running) {
      let res;
      try { res = await reader.read(); } catch (e) { break; }
      if (res.done) break;
      const frame = res.value;
      if (!go || paused || stopping) {
        // 首帧前保留最后一帧，开始时立刻写入，避免开头黑屏
        if (!go && !stopping && cfg.format !== 'gif') { if (lastPreFrame) lastPreFrame.close(); lastPreFrame = frame; continue; }
        frame.close(); continue;
      }
      try {
        if (cfg.format === 'gif') handleGifFrame(frame, c2d, canvas);
        else {
          const t0 = performance.now();
          await writeVideoFrame(frame, c2d, canvas, writer);
          framesOut++; procMs += performance.now() - t0;
        }
      } catch (e) { log('frame error', e.message); try { frame.close(); } catch {} }
    }
  })();

  api.send('rec:progress', { state: 'ready', warnings });
  if (goRequested) setTimeout(begin, 150);
}
let lastPreFrame = null;
let framesOut = 0, procMs = 0, fpsSamples = [], lowFpsSent = false;
let vCtx = null, vCanvas = null, vWriter = null;

async function writeVideoFrame(frame, c2d, canvas, writer) {
  const c = cfg.crop;
  if (c.passthrough) { await writer.write(frame); return; }
  c2d.drawImage(frame, c.sx, c.sy, c.sw, c.sh, 0, 0, c.outW, c.outH);
  const ts = frame.timestamp;
  frame.close();
  const vf = new VideoFrame(canvas, { timestamp: ts });
  await writer.write(vf);
}

function handleGifFrame(frame, c2d, canvas) {
  const c = cfg.crop; const g = gifState;
  const ts = frame.timestamp / 1000; // ms
  if (g.lastTs !== null && ts - g.lastTs < g.interval * 0.92) { frame.close(); return; }
  // 编码跟不上时丢帧（防止内存暴涨）
  if (g.posted - g.encoded > 5) { frame.close(); return; }
  c2d.drawImage(frame, c.sx, c.sy, c.sw, c.sh, 0, 0, c.outW, c.outH);
  frame.close();
  const data = c2d.getImageData(0, 0, c.outW, c.outH).data;
  if (g.pending) {
    const delay = Math.min(ts - g.lastTs - g.pauseGap, 10000);
    gifWorker.postMessage({ type: 'frame', data: g.pending.buffer, delay }, [g.pending.buffer]);
    g.posted++;
  }
  g.pauseGap = 0;
  g.pending = data; g.lastTs = ts; g.frames++;
}

function begin() {
  if (!running || go) return;
  go = true;
  startWall = performance.now();
  if (recorder) {
    recorder.start(1000);
    // 静止画面时也写入一帧
    if (lastPreFrame) { const f = lastPreFrame; lastPreFrame = null; writeVideoFrame(f, vCtx, vCanvas, vWriter).catch(() => {}); }
  }
  api.send('rec:started', { mimeType: cfg.mimeType || 'image/gif', size: `${cfg.crop.outW}x${cfg.crop.outH}`, warnings });
  tick();
}
function setPaused(v) {
  if (!go || stopping) return;
  if (v === paused) return;
  paused = v;
  if (paused) { pausedAt = performance.now(); if (recorder && recorder.state === 'recording') recorder.pause(); }
  else {
    const gap = performance.now() - pausedAt; pausedTotal += gap;
    fpsSamples = []; // 暂停期间不算进帧率统计
    if (gifState) gifState.pauseGap = (gifState.pauseGap || 0) + gap;
    if (recorder && recorder.state === 'paused') recorder.resume();
  }
  sendProgress();
}

function elapsed() {
  if (!go) return 0;
  const now = paused ? pausedAt : performance.now();
  return Math.max(0, now - startWall - pausedTotal);
}
function sendProgress(state) {
  const p = {
    state: state || (paused ? 'paused' : 'recording'), elapsed: elapsed(), bytes,
    frames: gifState ? gifState.frames : undefined, warnings,
  };
  // 性能监测（录制 6 秒后判断一次）：
  //  ① 每帧处理耗时 → 电脑最多能跑多少帧；② 实际出帧率持续明显低于设定值（画面在动但跟不上）
  //  画面静止时系统本来就几乎不出帧，所以出帧率低于 3 fps 时不算
  if (cfg && cfg.format !== 'gif' && go && !paused && !state) {
    const now = performance.now();
    fpsSamples.push([now, framesOut, procMs]);
    while (fpsSamples.length && now - fpsSamples[0][0] > 6000) fpsSamples.shift();
    if (!lowFpsSent && elapsed() > 6000 && fpsSamples.length >= 10) {
      const [t0, f0, m0] = fpsSamples[0];
      const n = framesOut - f0;
      const target = cfg.fps || 30;
      const rate = (n * 1000) / Math.max(1, now - t0);
      const capable = n >= 5 ? 1000 / Math.max((procMs - m0) / n, 0.01) : Infinity;
      // 出帧要「稳定地少」才算跟不上：每个 0.5 秒都有帧、且最少的那段不低于平均的一半（打字、偶尔动一下的画面是忽多忽少）
      const bins = []; for (let i = 1; i < fpsSamples.length; i++) bins.push(fpsSamples[i][1] - fpsSamples[i - 1][1]);
      const mean = bins.reduce((a, b) => a + b, 0) / bins.length;
      const steady = bins.length >= 8 && Math.min(...bins) > 0 && Math.min(...bins) >= mean * 0.5;
      const slowPipe = capable < target * 0.75;
      const slowSource = steady && rate >= 3 && rate < target * 0.4;
      if (slowPipe || slowSource) {
        const est = Math.min(slowPipe ? capable : Infinity, slowSource ? rate : Infinity);
        lowFpsSent = true; p.lowFps = Math.round(est); p.targetFps = target;
        log('low fps', est.toFixed(1), 'target', target, 'rate', rate.toFixed(1), 'capable', capable.toFixed(1), 'bins', bins.join(','));
      }
    }
  }
  api.send('rec:progress', p);
}
function tick() { if (!running || stopping) return; sendProgress(); setTimeout(tick, 500); }

function stop(cancel) {
  if (stopping) return;
  stopping = true; cancelled = !!cancel;
  if (!go) { cleanup(); api.send('rec:done', { cancelled: true }); return; }
  if (recorder) {
    if (recorder.state !== 'inactive') recorder.stop(); else { cleanup(); api.send('rec:done', { cancelled }); }
  } else if (gifWorker) {
    const g = gifState;
    if (g.pending && !cancelled) {
      gifWorker.postMessage({ type: 'frame', data: g.pending.buffer, delay: g.interval }, [g.pending.buffer]);
      g.pending = null; g.posted++;
    }
    if (cancelled) { cleanup(); api.send('rec:done', { cancelled: true }); return; }
    if (!g.frames) { cleanup(); api.send('rec:error', tx('没有录到任何画面')); return; }
    api.send('rec:progress', { state: 'encoding', done: g.encoded, total: Math.max(g.posted, g.encoded) });
    gifWorker.postMessage({ type: 'finish' });
  }
}

function cleanup() {
  running = false;
  for (const s of [videoStream, sysStream, micStream]) { if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch {} }); }
  if (audioCtx) { try { audioCtx.close(); } catch {} }
}
