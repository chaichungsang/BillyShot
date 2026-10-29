// 文件任务：子进程、低优先级、.part、取消时杀掉进程树并删掉半成品。
const { fork, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nextTo, partialFor, discardPartial, samePath } = require('./paths');
const { outputSpec } = require('./plan');
const { FileJobQueue } = require('./queue');
const { ffmpegBin } = require('./ffmpeg-bin');

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return null; }
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  } catch {}
}

function lowerPriority(pid) {
  try { os.setPriority(pid, 19); } catch {}
  if (process.platform === 'darwin') {
    try { spawn('/usr/sbin/taskpolicy', ['-b', '-p', String(pid)], { stdio: 'ignore' }); } catch {}
  }
}

// 主进程有 app，能可靠找到 app.asar.unpacked 里的 ffmpeg；把结果交给子进程，子进程就不用再猜。
function workerEnv(base = process.env, resolve = ffmpegBin) {
  const env = { ...base };
  if (!env.HOPSNAP_FFMPEG) {
    let bin = null;
    try { bin = resolve(); } catch { bin = null; }
    if (bin) env.HOPSNAP_FFMPEG = bin;
  }
  return env;
}

function spawnWorker(script) {
  script = script || path.join(__dirname, 'run-job.js');
  if (process.versions && process.versions.electron) {
    try {
      const { utilityProcess } = require('electron');
      const child = utilityProcess.fork(script, [], { serviceName: 'hopsnap-file-job', stdio: 'inherit', env: workerEnv() });
      return {
        pid: () => child.pid,
        send: (msg) => child.postMessage(msg),
        onMessage: (fn) => child.on('message', fn),
        onExit: (fn) => child.on('exit', (code) => fn(code)),
        kill: () => { try { child.kill(); } catch {} },
      };
    } catch { /* 退回 fork */ }
  }
  const child = fork(script, [], {
    env: { ...workerEnv(), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    detached: process.platform !== 'win32',
  });
  return {
    pid: () => child.pid,
    send: (msg) => { try { child.send(msg); } catch {} },
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => child.on('exit', (code) => fn(code)),
    kill: () => killTree(child),
  };
}

class JobRunner {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.workerScript = hooks.workerScript || null;
    this.jobs = new Map();
    this.queue = new FileJobQueue({
      isRecording: () => !!this._recording,
      run: (job) => this._execute(job),
    });
  }
  setRecording(on) {
    this._recording = !!on;
    this.queue.setRecording(!!on);
  }
  plan(spec) {
    const anchor = spec.inputs[0];
    const naming = outputSpec(spec.action, { ...spec.options, merged: spec.inputs.length > 1 && spec.action === 'pdf.make' }, anchor);
    const ext = naming.ext;
    const suffix = spec.action === 'pdf.make' && spec.inputs.length > 1 ? 'merged' : naming.suffix;
    const finalPath = nextTo(anchor, { suffix, ext });
    if (spec.inputs.some((f) => samePath(f, finalPath))) throw Object.assign(new Error('refusing to overwrite original'), { code: 'EOVERWRITE' });
    return { ...spec, finalPath, partial: partialFor(finalPath) };
  }
  checkDisk(finalPath, need) {
    const free = freeBytes(path.dirname(finalPath));
    if (free == null) return { ok: true };
    if (free < Math.max(need || 0, 8 * 1024 * 1024)) {
      return { ok: false, free, message: '磁盘空间不够，已停用开始按钮。腾出空间后再试。' };
    }
    return { ok: true, free };
  }
  start(spec) {
    const job = this.plan(spec);
    job.id = spec.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    job.state = 'queued';
    const disk = this.checkDisk(job.finalPath, spec.needBytes || 0);
    if (!disk.ok) throw Object.assign(new Error(disk.message), { code: 'ENOSPC', disk });
    this.jobs.set(job.id, job);
    const placed = this.queue.enqueue(job);
    if (this.hooks.onUpdate) this.hooks.onUpdate(job, placed);
    return job;
  }
  cancel(id) {
    const where = this.queue.cancel(id);
    const job = this.jobs.get(id);
    if (!job) return where;
    if (where === 'queued') {
      job.state = 'cancelled';
      discardPartial(job.partial);
      if (this.hooks.onUpdate) this.hooks.onUpdate(job, { state: 'cancelled' });
    } else if (where === 'running' && job.worker) {
      job.cancelRequested = true;
      try { job.worker.send({ type: 'cancel' }); } catch {}
      setTimeout(() => { if (job.state === 'running' && job.worker) job.worker.kill(); }, 700);
    }
    return where;
  }
  _execute(job) {
    return new Promise((resolve) => {
      const worker = spawnWorker(this.workerScript);
      job.worker = worker;
      job.state = 'running';
      if (this.hooks.onUpdate) this.hooks.onUpdate(job, { state: 'running' });
      const pid = worker.pid();
      if (pid) lowerPriority(pid);
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (result.state !== 'done') discardPartial(job.partial);
        job.state = result.state;
        if (this.hooks.onUpdate) this.hooks.onUpdate(job, result);
        resolve(result);
      };
      worker.onMessage((msg) => {
        if (msg && !msg.type && msg.data && msg.data.type) msg = msg.data;
        if (!msg) return;
        if (msg.type === 'progress') {
          if (this.hooks.onUpdate) this.hooks.onUpdate(job, { state: 'running', progress: msg });
        } else if (msg.type === 'done') finish({ state: 'done', file: msg.file, bytes: msg.bytes });
        else if (msg.type === 'cancelled') finish({ state: 'cancelled' });
        else if (msg.type === 'error') finish({ state: 'error', code: msg.code, message: msg.message });
        else if (msg.type === 'estimate') finish({ state: 'estimate', bytes: msg.bytes });
      });
      worker.onExit(() => {
        if (!settled) {
          const cancelled = job.cancelRequested || job.state === 'cancelled';
          finish({ state: cancelled ? 'cancelled' : 'error', message: cancelled ? '' : '任务进程已退出' });
        }
      });
      const { worker: _w, ...payload } = job;
      worker.send(payload);
    });
  }
  dispose() {
    for (const job of this.jobs.values()) {
      if (job.state === 'running' && job.worker) job.worker.kill();
      if (job.state !== 'done') discardPartial(job.partial);
    }
  }
}

module.exports = { JobRunner, freeBytes, killTree, lowerPriority, spawnWorker, workerEnv };
