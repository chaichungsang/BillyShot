// Keep only this Mac arch's ffmpeg tree inside the .app (plus the LGPL COPYING file).
// electron-builder file patterns alone were still packing every vendor/ffmpeg/* tree.
'use strict';
const fs = require('fs');
const path = require('path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const archName = ARCH[context.arch] || String(context.arch);
  const keep = `darwin-${archName}`;
  const ffmpegRoot = path.join(
    context.appOutDir,
    'Hopsnap.app',
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'vendor',
    'ffmpeg',
  );
  if (!fs.existsSync(ffmpegRoot)) {
    console.warn('[after-pack-mac-ffmpeg] no ffmpeg root at', ffmpegRoot);
    return;
  }
  for (const name of fs.readdirSync(ffmpegRoot)) {
    if (name === 'COPYING.LGPLv2.1' || name === keep) continue;
    const p = path.join(ffmpegRoot, name);
    console.log('[after-pack-mac-ffmpeg] remove', name, '(keep', keep + ')');
    rm(p);
  }
  const left = fs.readdirSync(ffmpegRoot).sort();
  if (!left.includes(keep)) throw new Error(`after-pack-mac-ffmpeg: missing ${keep} under ${ffmpegRoot}`);
  console.log('[after-pack-mac-ffmpeg]', archName, 'left:', left.join(', '));
};
