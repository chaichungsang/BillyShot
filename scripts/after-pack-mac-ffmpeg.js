// Keep only this platform/arch's ffmpeg tree in the package (plus the LGPL COPYING file).
// electron-builder file patterns alone were still packing every vendor/ffmpeg/* tree.
// Windows also drops native/mac (the Mac ShiftDrag helper); Mac drops native/win.
'use strict';
const fs = require('fs');
const path = require('path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function unpackedRoot(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, 'BillyShot.app', 'Contents', 'Resources', 'app.asar.unpacked');
  }
  return path.join(context.appOutDir, 'resources', 'app.asar.unpacked');
}

function strip(context) {
  const platform = context.electronPlatformName;
  if (platform !== 'darwin' && platform !== 'win32') return null;
  const archName = ARCH[context.arch] || String(context.arch);
  const keep = `${platform}-${archName}`;
  const tag = `[after-pack ${platform}]`;
  const root = unpackedRoot(context);
  const ffmpegRoot = path.join(root, 'vendor', 'ffmpeg');
  if (!fs.existsSync(ffmpegRoot)) {
    console.warn(tag, 'no ffmpeg root at', ffmpegRoot);
    return null;
  }
  for (const name of fs.readdirSync(ffmpegRoot)) {
    if (name === 'COPYING.LGPLv2.1' || name === keep) continue;
    console.log(tag, 'remove vendor/ffmpeg/' + name, '(keep', keep + ')');
    rm(path.join(ffmpegRoot, name));
  }
  const left = fs.readdirSync(ffmpegRoot).sort();
  if (!left.includes(keep)) throw new Error(`after-pack: missing ${keep} under ${ffmpegRoot}`);
  const foreignNative = path.join(root, 'native', platform === 'win32' ? 'mac' : 'win');
  if (fs.existsSync(foreignNative)) {
    console.log(tag, 'remove', path.relative(root, foreignNative));
    rm(foreignNative);
  }
  console.log(tag, archName, 'ffmpeg left:', left.join(', '));
  return { keep, left };
}

exports.strip = strip;
exports.default = async function afterPack(context) {
  strip(context);
};
