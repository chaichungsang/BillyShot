'use strict';
// 只给测试用的工人：占住一个 .part，直到取消。生产路径 run-job.js 里没有这个动作。
const fs = require('fs');
const { discardPartial } = require('../src/filetools/paths');

let cancelled = false;
let partial = '';

function send(msg) {
  if (process.send) process.send(msg);
}

function stop() {
  if (cancelled) return;
  cancelled = true;
  discardPartial(partial);
  send({ type: 'cancelled' });
  process.exit(0);
}

function listen(job) {
  if (!job || !job.partial) return;
  partial = job.partial;
  const fd = fs.openSync(partial, 'wx');
  fs.closeSync(fd);
  fs.writeFileSync(partial, 'partial');
  send({ type: 'progress', ratio: 0.1, indeterminate: true });
  process.on('SIGTERM', stop);
  process.on('message', (m) => { if (m && m.type === 'cancel') stop(); });
}

process.on('message', listen);
