// 录屏进行时文件任务只排队，录屏结束后按顺序一个个跑。没有「立即开始」。
class FileJobQueue {
  constructor({ isRecording, run }) {
    this.isRecording = isRecording || (() => false);
    this.run = run;
    this.pending = [];
    this.active = null;
  }
  enqueue(job) {
    if (this.isRecording() || this.active) {
      this.pending.push(job);
      job.state = 'queued';
      return { state: 'queued', text: '录屏结束后开始' };
    }
    this._start(job);
    return { state: 'running' };
  }
  setRecording(on) {
    this._recording = !!on;
    if (!on) this._pump();
  }
  recording() {
    return this._recording != null ? this._recording : !!this.isRecording();
  }
  _start(job) {
    this.active = job;
    job.state = 'running';
    Promise.resolve().then(() => this.run(job)).finally(() => {
      if (this.active === job) this.active = null;
      this._pump();
    });
  }
  _pump() {
    if (this.recording() || this.active) return;
    const next = this.pending.shift();
    if (next && next.state !== 'cancelled') this._start(next);
  }
  // 排队中的任务：取消或 Esc 移出队列，不生成文件。正在跑的返回 running，由调用方杀进程。
  cancel(id) {
    const i = this.pending.findIndex((j) => j.id === id);
    if (i >= 0) {
      const [job] = this.pending.splice(i, 1);
      job.state = 'cancelled';
      return 'queued';
    }
    if (this.active && this.active.id === id) return 'running';
    return null;
  }
}

module.exports = { FileJobQueue };
