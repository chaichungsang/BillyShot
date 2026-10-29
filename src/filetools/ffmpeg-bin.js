// 只使用仓库里的 LGPL ffmpeg（或 HOPSNAP_FFMPEG 指到的那一份）。不走 PATH 上可能带 x264 的系统包。
// 打包后 ffmpeg 在 resources/app.asar.unpacked 里。app.asar 里的路径能被 fs.existsSync 看到，
// 却不能 spawn（ENOENT）。文件任务跑在 utilityProcess 里，那里没有 app，所以不能靠 app.isPackaged
// 判断是否打包：一律把 app.asar 换成 app.asar.unpacked，并从 process.resourcesPath 推出位置。
const fs = require('fs');
const path = require('path');

const ASAR_SEGMENT = /([\\/])app\.asar(?=[\\/]|$)/;

// /x/resources/app.asar/src → /x/resources/app.asar.unpacked/src；不在 asar 里的路径原样返回。
function unpackedPath(p) {
  return String(p).replace(ASAR_SEGMENT, '$1app.asar.unpacked');
}

function insideAsar(p) {
  return ASAR_SEGMENT.test(String(p));
}

function isPackaged(env = {}) {
  if (env.isPackaged != null) return !!env.isPackaged;
  try {
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged;
  } catch { /* 测试里没有 electron */ }
  return insideAsar(env.dirname || __dirname);
}

function roots(env = {}) {
  const dirname = env.dirname || __dirname;
  const resourcesPath = env.resourcesPath !== undefined ? env.resourcesPath : process.resourcesPath;
  const rootEnv = env.ffmpegRoot !== undefined ? env.ffmpegRoot : process.env.HOPSNAP_FFMPEG_ROOT;
  const list = [];
  if (rootEnv) list.push(rootEnv);
  if (resourcesPath && isPackaged(env)) {
    list.push(path.join(resourcesPath, 'app.asar.unpacked', 'vendor', 'ffmpeg'));
    list.push(path.join(resourcesPath, 'vendor', 'ffmpeg'));
  }
  list.push(unpackedPath(path.join(dirname, '..', '..', 'vendor', 'ffmpeg')));
  // 去重，并且绝不返回 app.asar 里面的路径。
  return [...new Set(list)].filter((p) => !insideAsar(p));
}

function ffmpegBin(env = {}) {
  const override = env.ffmpeg !== undefined ? env.ffmpeg : process.env.HOPSNAP_FFMPEG;
  if (override) return unpackedPath(override);
  const platform = env.platform || process.platform;
  const arch = env.arch || process.arch;
  const name = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const folder = `${platform}-${arch}`;
  const exists = env.existsSync || fs.existsSync;
  for (const root of roots(env)) {
    const file = path.join(root, folder, name);
    if (exists(file)) return file;
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

module.exports = { ffmpegBin, listEncoders, roots, unpackedPath, insideAsar };
