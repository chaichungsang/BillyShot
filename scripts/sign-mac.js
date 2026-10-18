// Mac 包签名 + 压缩（在 electron-builder --mac 之后运行，Linux / Mac 都可以，需要 rcodesign）
//
// 为什么要签：macOS 的「屏幕录制 / 辅助功能 / 摄像头」授权绑在程序签名上。
// ad-hoc 签名（没有证书）绑的是这一版文件的哈希，每打一次包都变 → 用户升级后授权失效，
// 系统设置里开关还开着，但系统不认新版本，又会弹窗。
// 用同一张证书签名后，授权绑的是「com.billyshot.app + 这张证书」，以后每个版本都认。
//
// 证书：BILLYSHOT_SIGN_DIR 指向的文件夹里放 cert.pem + key.pem（自签名，永远用同一张）。
//   换证书 = 所有用户要重新授权一次；私钥泄露 = 别人能做出「继承 BillyShot 授权」的程序。所以私钥不进源码、不外传。
// 没有证书时（例如别人自己从源码打包）：设 BILLYSHOT_ADHOC=1 用 ad-hoc 签名，授权每次升级都会失效。

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const appId = pkg.build.appId;
const dist = path.join(root, 'dist');
const targets = [
  { dir: 'mac', label: 'Intel' },
  { dir: 'mac-arm64', label: 'AppleSilicon' },
];

function run(args) { return execFileSync('rcodesign', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); }
function die(msg) { console.error('\n[sign-mac] ' + msg + '\n'); process.exit(1); }

try { run(['--version']); } catch { die('找不到 rcodesign。安装：下载 apple-codesign 预编译包，或 cargo install apple-codesign --bin rcodesign'); }

const signDir = process.env.BILLYSHOT_SIGN_DIR;
const adhoc = process.env.BILLYSHOT_ADHOC === '1';
let cert, key, leafSha1;
if (signDir) {
  cert = path.join(signDir, 'cert.pem');
  key = path.join(signDir, 'key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) die(`BILLYSHOT_SIGN_DIR=${signDir} 里没有 cert.pem / key.pem`);
  const der = new crypto.X509Certificate(fs.readFileSync(cert)).raw;
  leafSha1 = crypto.createHash('sha1').update(der).digest('hex');
} else if (!adhoc) {
  die('没有设置 BILLYSHOT_SIGN_DIR（放 cert.pem + key.pem 的文件夹）。\n' +
      '正式发布必须用固定证书签名，否则用户每次升级都要重新授权屏幕录制。\n' +
      '只是自己试用可以设 BILLYSHOT_ADHOC=1 跳过。');
} else {
  console.warn('[sign-mac] 警告：ad-hoc 签名，用户升级后屏幕录制等授权会失效。不要用来发布。');
}

// 主程序的 designated requirement：identifier "com.billyshot.app" and certificate leaf = H"<证书 SHA-1>"
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
if (leafSha1) {
  drFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-dr-')), 'dr.bin');
  fs.writeFileSync(drFile, designatedRequirement(appId, leafSha1));
  const parsed = run(['parse-code-signing-requirement', drFile]).trim();
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

let done = 0;
for (const t of targets) {
  const app = path.join(dist, t.dir, `${pkg.build.productName}.app`);
  if (!fs.existsSync(app)) { console.log('[sign-mac] 跳过（没打这个架构）', t.dir); continue; }
  const args = ['sign', '--timestamp-url', 'none']; // 自签名不需要 Apple 时间戳（只有公证才需要），也省得依赖网络
  if (leafSha1) args.push('--pem-file', cert, '--pem-file', key, '--code-requirements-file', drFile);
  args.push(app);
  run(args);
  // 核对每个 Mach-O 的签名都有效；用证书签时不能有任何一个还是 ad-hoc。
  // native/mac/ShiftDrag 打进包里之后也在这张表里，和别的二进制同一套证书。
  const machos = listMachO(app);
  for (const f of machos) {
    run(['verify', f]);
    if (leafSha1 && /CodeSignatureFlags\(ADHOC\)/.test(run(['print-signature-info', f]))) die(`${t.dir}: 还是 ad-hoc 签名：${path.relative(app, f)}`);
  }
  // 主程序必须带固定证书的 designated requirement（授权就绑在这上面）
  const info = run(['print-signature-info', path.join(app, 'Contents', 'MacOS', pkg.build.productName)]);
  if (leafSha1 && !info.toLowerCase().includes(`certificate leaf = h"${leafSha1}"`)) die(`${t.dir}: 主程序签名里没有证书 requirement`);
  console.log(`[sign-mac] ${t.dir}: ${machos.length} 个 Mach-O 签名有效`);

  const zip = path.join(dist, `${pkg.build.productName}-${pkg.version}-mac-${t.label}.zip`);
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execFileSync('zip', ['-qry', zip, `${pkg.build.productName}.app`], { cwd: path.dirname(app) }); // -y 保留 Framework 里的符号链接
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  console.log(`[sign-mac] ${path.basename(zip)}  ${fs.statSync(zip).size} B  sha256 ${sha}`);
  done++;
}
if (!done) die('dist 里没有找到 .app，先运行 electron-builder --mac');
