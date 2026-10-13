// 编译「卸载 BillyShot」小工具（build/uninstall-tool.nsi → dist/卸载BillyShot-Uninstall.exe）
// 用 electron-builder 下载好的 NSIS（打包 Windows 安装包时会自动下载）；Linux / Mac 上不需要 Wine
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const cacheRoots = [
  process.env.ELECTRON_BUILDER_CACHE,
  process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache') : null,
  process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'electron-builder') : null,
  path.join(os.homedir(), '.cache', 'electron-builder'),
].filter(Boolean);
const exe = process.platform === 'win32' ? ['makensis.exe'] : [path.join(process.platform === 'darwin' ? 'mac' : 'linux', 'makensis')];

function find(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return null;
  for (const e of exe) { const p = path.join(dir, e); if (fs.existsSync(p)) return p; }
  for (const d of fs.readdirSync(dir)) {
    if (!/nsis/i.test(d) || /resources/i.test(d)) continue;
    const full = path.join(dir, d);
    if (fs.statSync(full).isDirectory()) { const r = find(full, depth + 1); if (r) return r; }
  }
  return null;
}
let makensis = null;
for (const c of cacheRoots) { makensis = find(c); if (makensis) break; }
if (!makensis) { console.error('找不到 makensis：请先运行一次 electron-builder --win 让它下载 NSIS'); process.exit(1); }

const nsisDir = path.dirname(makensis).replace(/[\\/](linux|mac)$/, '');
const out = path.join(root, 'dist', '卸载BillyShot-Uninstall.exe');
fs.mkdirSync(path.dirname(out), { recursive: true });
// 命令行参数只用英文路径（makensis 在某些系统语言下转换中文参数会失败），编译完再改成中文文件名
const tmp = path.join(root, 'dist', 'uninstall-tool.tmp.exe');
const env = { ...process.env, NSISDIR: nsisDir, LANG: process.env.LANG || 'C.UTF-8', LC_ALL: process.env.LC_ALL || 'C.UTF-8' };
execFileSync(makensis, ['-V2', `-DOUTFILE=${tmp}`, `-DVERSION=${version}`, path.join(root, 'build', 'uninstall-tool.nsi')], { stdio: 'inherit', env, cwd: path.join(root, 'build') });
fs.renameSync(tmp, out);
console.log('built', out);
