// Windows 安装包：node scripts/dist-win.js  （= npm run dist:win）
// Windows / Linux / Intel Mac 上直接用 electron-builder 自带的 NSIS。
// Apple Silicon 的 Mac 上 electron-builder 自带的 makensis 是 x86_64 的，没装 Rosetta 就跑不起来（spawn error -86）：
// 这里改用 Homebrew 的 makensis（brew install makensis），通过 ELECTRON_BUILDER_NSIS_DIR 指给 electron-builder。
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
};

function canRunX64() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return true;
  try { execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function brewMakensis() {
  for (const p of ['/opt/homebrew/bin/makensis', '/usr/local/bin/makensis']) if (fs.existsSync(p)) return p;
  try { return execFileSync('/usr/bin/which', ['makensis'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
// electron-builder 要的目录结构：<dir>/makensis（入口脚本）+ <dir>/elevate.exe
function wrapperDir(makensis) {
  const dir = path.join(os.homedir(), 'Library', 'Caches', 'electron-builder', 'nsis-system');
  fs.mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'makensis');
  fs.writeFileSync(entry, `#!/bin/sh\nexec "${makensis}" "$@"\n`, { mode: 0o755 });
  const elevate = path.join(dir, 'elevate.exe');
  if (!fs.existsSync(elevate)) {
    const cache = path.join(os.homedir(), 'Library', 'Caches', 'electron-builder');
    const found = (function find(d, depth) {
      if (depth > 3 || !fs.existsSync(d)) return null;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isFile() && e.name === 'elevate.exe') return p;
        if (e.isDirectory() && /nsis/i.test(e.name)) { const r = find(p, depth + 1); if (r) return r; }
      }
      return null;
    })(cache, 0);
    if (!found) { console.error('[dist-win] 找不到 elevate.exe：先跑一次 electron-builder --win 让它下载 NSIS 包（会失败，但文件已下载），再重试'); process.exit(1); }
    fs.copyFileSync(found, elevate);
  }
  return dir;
}

run('node', [path.join('scripts', 'fetch-natives.js')]);
const env = {};
if (!canRunX64()) {
  const mk = brewMakensis();
  if (!mk) { console.error('[dist-win] Apple Silicon 上需要 Homebrew 的 makensis：brew install makensis（或安装 Rosetta：softwareupdate --install-rosetta）'); process.exit(1); }
  env.ELECTRON_BUILDER_NSIS_DIR = wrapperDir(mk);
  env.MAKENSIS = mk;
  console.log('[dist-win] 用系统 makensis：', mk);
}
run(path.join('node_modules', '.bin', 'electron-builder'), ['--win', '--x64'], env);
run('node', [path.join('scripts', 'build-uninstall-tool.js')], env);
