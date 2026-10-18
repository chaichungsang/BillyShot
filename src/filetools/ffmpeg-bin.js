// 只使用仓库里的 LGPL ffmpeg（或 BILLYSHOT_FFMPEG 指到的那一份）。不走 PATH 上可能带 x264 的系统包。
const fs = require('fs');
const path = require('path');

function roots() {
  const list = [];
  if (process.env.BILLYSHOT_FFMPEG_ROOT) list.push(process.env.BILLYSHOT_FFMPEG_ROOT);
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      list.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'ffmpeg'));
      list.push(path.join(process.resourcesPath, 'vendor', 'ffmpeg'));
    }
  } catch { /* 测试里没有 electron */ }
  list.push(path.join(__dirname, '..', '..', 'vendor', 'ffmpeg'));
  return list;
}

function ffmpegBin() {
  if (process.env.BILLYSHOT_FFMPEG) return process.env.BILLYSHOT_FFMPEG;
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const folder = `${process.platform}-${process.arch}`;
  for (const root of roots()) {
    const file = path.join(root, folder, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function listEncoders(bin, execFileSync) {
  const run = execFileSync || require('child_process').execFileSync;
  const out = run(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return out.split('\n').map((line) => {
    const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
    return m ? m[1] : '';
  }).filter(Boolean);
}

module.exports = { ffmpegBin, listEncoders, roots };
