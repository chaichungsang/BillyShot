// Mac 包签名 + 压缩（在 electron-builder --mac 之后运行）
//
// 为什么要签：macOS 的「屏幕录制 / 辅助功能 / 摄像头」授权绑在程序签名上。
// ad-hoc 签名（没有证书）绑的是这一版文件的哈希，每打一次包都变 → 用户升级后授权失效，
// 系统设置里开关还开着，但系统不认新版本，又会弹窗。
//
// 三种模式（按优先级）：
//  1. devid   electron-builder 已经用 Developer ID 签好（dist:mac:release）：这里只校验 + 压缩。公证由 electron-builder 做。
//  2. cert    HOPSNAP_SIGN_DIR 指向放 cert.pem + key.pem 的文件夹（固定的自签名证书，永远用同一张）：rcodesign 签名。
//             授权绑「com.hopsnap.app + 这张证书」，升级不用重新授权；但去不掉「无法验证开发者」的提示。
//  3. adhoc   HOPSNAP_ADHOC=1：自己试用。每次重装都要重新授权屏幕录制。不要用来发布。
//
// 校验：macOS 上用苹果自己的 codesign（rcodesign verify 在 mac 上会误报），Linux 上用 rcodesign。

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const appId = pkg.build.appId;
const dist = path.join(root, 'dist');
const isMac = process.platform === 'darwin';
const targets = [
  { dir: 'mac', label: 'Intel' },
  { dir: 'mac-arm64', label: 'AppleSilicon' },
];

function sh(file, args, opts = {}) { return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }
function rc(args) { return sh('rcodesign', args); }
function die(msg) { console.error('\n[sign-mac] ' + msg + '\n'); process.exit(1); }
function hasRcodesign() { try { rc(['--version']); return true; } catch { return false; } }

const signDir = process.env.HOPSNAP_SIGN_DIR;
const adhoc = process.env.HOPSNAP_ADHOC === '1';

// 已经是 Developer ID 签名（electron-builder 签的）？
function devIdSigned(app) {
  if (!isMac) return false;
  try { const out = sh('/usr/bin/codesign', ['-dvv', app], { stdio: ['ignore', 'pipe', 'pipe'] }); return /Developer ID Application/.test(out); }
  catch (e) { return /Developer ID Application/.test(String(e.stderr || '')); }   // codesign 把信息写到 stderr
}

let mode = null, cert, key, leafSha1;
if (signDir) {
  cert = path.join(signDir, 'cert.pem');
  key = path.join(signDir, 'key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) die(`HOPSNAP_SIGN_DIR=${signDir} 里没有 cert.pem / key.pem`);
  const der = new crypto.X509Certificate(fs.readFileSync(cert)).raw;
  leafSha1 = crypto.createHash('sha1').update(der).digest('hex');
  mode = 'cert';
} else if (adhoc) {
  mode = 'adhoc';
}

// 主程序的 designated requirement：identifier "com.hopsnap.app" and certificate leaf = H"<证书 SHA-1>"
// （rcodesign 对非 Apple 证书不会自动生成，这里按 Apple 的二进制格式拼出来）
function designatedRequirement(ident, sha1hex) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const data = (buf) => Buffer.concat([u32(buf.length), buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  const expr = Buffer.concat([
    u32(6),                                  // opAnd
    u32(2), data(Buffer.from(ident)),        // opIdent
    u32(4), u32(0), data(Buffer.from(sha1hex, 'hex')), // opAnchorHash, slot 0 = leaf
  ]);
  return Buffer.concat([u32(0xfade0c00), u32(12 + expr.length), u32(1), expr]);
}

let drFile = null;
if (mode === 'cert') {
  if (!hasRcodesign()) die('找不到 rcodesign。安装：brew install rcodesign，或 cargo install apple-codesign --bin rcodesign');
  drFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-dr-')), 'dr.bin');
  fs.writeFileSync(drFile, designatedRequirement(appId, leafSha1));
  const parsed = rc(['parse-code-signing-requirement', drFile]).trim();
  const want = `(identifier "${appId}") and (certificate leaf = H"${leafSha1}")`;
  if (parsed !== want) die('designated requirement 拼错了：' + parsed);
  console.log('[sign-mac] 证书 SHA-1', leafSha1);
}

function listMachO(dir) {
  const MAGIC = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe']);
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(p); continue; }
      const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(4); const n = fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
      if (n === 4 && MAGIC.has(b.toString('hex'))) out.push(p);
    }
  })(dir);
  return out;
}

function signApp(app) {
  if (mode === 'adhoc') {
    if (isMac) { sh('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]); return; }
    if (!hasRcodesign()) die('Linux 上 ad-hoc 签名需要 rcodesign');
    rc(['sign', '--timestamp-url', 'none', app]); return;
  }
  // 自签名证书：rcodesign 带 pem 签（mac / Linux 都一样）；--timestamp-url none：自签名不需要 Apple 时间戳
  rc(['sign', '--timestamp-url', 'none', '--pem-file', cert, '--pem-file', key, '--code-requirements-file', drFile, app]);
}

function verifyApp(app, t) {
  if (isMac) {
    try { sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); }
    catch (e) { die(`${t.dir}: codesign --verify 不通过：${String(e.stderr || e.message).trim()}`); }
    const info = (() => { try { return sh('/usr/bin/codesign', ['-d', '-r-', app]); } catch (e) { return String(e.stderr || ''); } })();
    if (mode === 'cert' && !info.toLowerCase().includes(`certificate leaf = h"${leafSha1}"`)) die(`${t.dir}: 主程序签名里没有证书 requirement`);
    return listMachO(app).length;
  }
  const machos = listMachO(app);
  for (const f of machos) {
    rc(['verify', f]);
    if (mode === 'cert' && /CodeSignatureFlags\(ADHOC\)/.test(rc(['print-signature-info', f]))) die(`${t.dir}: 还是 ad-hoc 签名：${path.relative(app, f)}`);
  }
  const info = rc(['print-signature-info', path.join(app, 'Contents', 'MacOS', pkg.build.productName)]);
  if (mode === 'cert' && !info.toLowerCase().includes(`certificate leaf = h"${leafSha1}"`)) die(`${t.dir}: 主程序签名里没有证书 requirement`);
  return machos.length;
}

let done = 0;
for (const t of targets) {
  const app = path.join(dist, t.dir, `${pkg.build.productName}.app`);
  if (!fs.existsSync(app)) { console.log('[sign-mac] 跳过（没打这个架构）', t.dir); continue; }
  let m = mode;
  if (devIdSigned(app)) { m = 'devid'; console.log(`[sign-mac] ${t.dir}: 已是 Developer ID 签名，只校验 + 压缩`); }
  else if (!m) {
    die('没有设置 HOPSNAP_SIGN_DIR（放 cert.pem + key.pem 的文件夹），也不是 Developer ID 签名。\n' +
        '正式发布：npm run dist:mac:release（Developer ID + 公证），或 HOPSNAP_SIGN_DIR=… npm run dist:mac（固定自签名证书）。\n' +
        '只是自己试用可以设 HOPSNAP_ADHOC=1 跳过（每次重装要重新授权屏幕录制）。');
  }
  if (m === 'adhoc') console.warn('[sign-mac] 警告：ad-hoc 签名，用户升级后屏幕录制等授权会失效。不要用来发布。');
  if (m !== 'devid') { const saved = mode; mode = m; signApp(app); mode = saved; }
  const n = verifyApp(app, t);
  console.log(`[sign-mac] ${t.dir}: ${n} 个 Mach-O，签名有效（${m}）`);

  const zip = path.join(dist, `${pkg.build.productName}-${pkg.version}-mac-${t.label}.zip`);
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  // ditto 保留 Mac 的扩展属性和符号链接，和访达「压缩」一致；Linux 上退回 zip -y
  if (isMac) sh('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  else execFileSync('zip', ['-qry', zip, `${pkg.build.productName}.app`], { cwd: path.dirname(app) });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  console.log(`[sign-mac] ${path.basename(zip)}  ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB  sha256 ${sha}`);
  done++;
}
if (!done) die('dist 里没有找到 .app，先运行 electron-builder --mac');
