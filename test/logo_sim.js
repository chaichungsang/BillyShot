// 用模拟的 Windows 环境跑 main.js 里的快捷方式换图标逻辑，以及 macOS JXA 脚本的语法检查
const fs = require('fs'); const path = require('path'); const os = require('os');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const grab = (name) => { const i = src.indexOf(`function ${name}(`); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
let pass = 0; const ok = (c, m, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m + (c ? '' : '  -- ' + JSON.stringify(x))); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lnk-'));
const desktop = path.join(tmp, 'Desktop'), appData = path.join(tmp, 'AppData');
const exe = 'C:\\Users\\Billy\\AppData\\Local\\Programs\\billyshot\\BillyShot.exe';
const startDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const pinDir = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
[desktop, startDir, pinDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));
// .lnk 用 JSON 模拟
const put = (p, o) => fs.writeFileSync(p, JSON.stringify(o));
put(path.join(desktop, 'BillyShot.lnk'), { target: exe });
put(path.join(startDir, 'BillyShot.lnk'), { target: exe.toUpperCase(), icon: exe, iconIndex: 0 });
// 同名但指向别的程序（旧的免安装版）→ 不能动
put(path.join(pinDir, 'BillyShot.lnk'), { target: 'D:\\portable\\BillyShot.exe' });
const writes = [];
const shell = {
  readShortcutLink: (p) => JSON.parse(fs.readFileSync(p, 'utf8')),
  writeShortcutLink: (p, op, o) => { writes.push(p); const cur = JSON.parse(fs.readFileSync(p, 'utf8')); fs.writeFileSync(p, JSON.stringify({ ...cur, ...o })); return true; },
};
const app = { isPackaged: true, getPath: (n) => (n === 'desktop' ? desktop : appData) };
const ASSETS = 'C:\\Users\\Billy\\AppData\\Local\\Programs\\billyshot\\resources\\app.asar\\assets';
const env = { isWin: true, isMac: false, app, shell, fs, log: () => {}, BUILTIN_LOGO: 'portrait', process: { execPath: exe, env: { PUBLIC: path.join(tmp, 'Public') } }, require: (m) => (m === 'child_process' ? { spawn: () => ({ unref() {} }) } : require(m)) };
const pathWin = path.win32;
const code = `${grab('unpackedPath')}\n${grab('winShortcutPaths')}\n${grab('applyWinShortcutIcons')}\nreturn { applyWinShortcutIcons, unpackedPath };`;
const logoFile = (f, name) => pathWin.join(ASSETS, 'logos', name, f);
// winShortcutPaths 用 path.join：在 posix 下拼临时目录即可；图标路径用 win32 拼
const fns = new Function('isWin', 'isMac', 'app', 'shell', 'fs', 'log', 'BUILTIN_LOGO', 'process', 'require', 'path', 'logoFile', code)(
  env.isWin, env.isMac, app, shell, fs, env.log, 'portrait', env.process, env.require, path, logoFile);

ok(fns.unpackedPath(ASSETS + '\\logos\\purple\\icon.ico').includes('app.asar.unpacked\\assets\\logos\\purple\\icon.ico'), 'asar 路径换成 app.asar.unpacked', fns.unpackedPath(ASSETS));
ok(fns.unpackedPath('/Applications/BillyShot.app/Contents/Resources/app.asar/assets/logos/purple/mac.png').includes('app.asar.unpacked/assets'), 'mac 路径换成 app.asar.unpacked');
let r = fns.applyWinShortcutIcons('purple');
const d1 = shell.readShortcutLink(path.join(desktop, 'BillyShot.lnk')), s1 = shell.readShortcutLink(path.join(startDir, 'BillyShot.lnk')), p1 = shell.readShortcutLink(path.join(pinDir, 'BillyShot.lnk'));
ok(r.found === 2 && r.changed === 2 && r.failed === 0, '紫色版：桌面 + 开始菜单两个快捷方式已改', r);
ok(/app\.asar\.unpacked\\assets\\logos\\purple\\icon\.ico$/.test(d1.icon) && d1.icon === s1.icon, '快捷方式图标指向解包后的紫色 ico', d1);
ok(!p1.icon, '指向别的 exe 的同名快捷方式不动', p1);
r = fns.applyWinShortcutIcons('purple');
ok(r.changed === 0 && r.found === 2, '再次执行不重复写（启动时检查）', r);
r = fns.applyWinShortcutIcons('portrait');
const d2 = shell.readShortcutLink(path.join(desktop, 'BillyShot.lnk'));
ok(r.changed === 2 && d2.icon === exe && d2.iconIndex === 0, '切回头像版：快捷方式图标还原为 exe 自带图标', { r, d2 });
// 升级安装后快捷方式被重建（没有 icon 字段）+ 选的是头像版 → 不动
put(path.join(desktop, 'BillyShot.lnk'), { target: exe });
r = fns.applyWinShortcutIcons('portrait');
ok(r.changed === 0, '头像版 + 新装快捷方式：不需要改', r);
// 升级后选的是紫色版 → 补回
r = fns.applyWinShortcutIcons('purple');
ok(r.changed === 2, '紫色版 + 升级后快捷方式被重建：自动补回', r);
// 没有任何快捷方式（免安装 zip 版）
const emptyApp = { isPackaged: true, getPath: () => path.join(tmp, 'none') };
const fns2 = new Function('isWin', 'isMac', 'app', 'shell', 'fs', 'log', 'BUILTIN_LOGO', 'process', 'require', 'path', 'logoFile', code)(true, false, emptyApp, shell, fs, () => {}, 'portrait', env.process, env.require, path, logoFile);
r = fns2.applyWinShortcutIcons('purple');
ok(r.found === 0 && r.failed === 0, '免安装版没有快捷方式：静默跳过', r);

// macOS JXA 脚本：语法 + 参数逻辑（用假的 ObjC 桥）
const m = src.match(/const js = ("ObjC[\s\S]*?");\n/);
const jsSrc = eval(m[1].replace(/\n\s*/g, ' '));
const calls = [];
const fake$ = Object.assign(() => 'NIL', { NSImage: { alloc: { initWithContentsOfFile: (p) => 'IMG:' + p } }, NSWorkspace: { sharedWorkspace: { setIconForFileOptions: (img, p, o) => { calls.push([img, p, o]); return true; } } } });
const run = new Function('ObjC', '$', jsSrc + '\nreturn run;')({ import: () => {} }, fake$);
ok(run(['/x/mac.png', '/Applications/BillyShot.app']) === 'ok' && calls[0][0] === 'IMG:/x/mac.png' && calls[0][1] === '/Applications/BillyShot.app', 'macOS：设置自定义 .app 图标', calls[0]);
ok(run(['', '/Applications/BillyShot.app']) === 'ok' && calls[1][0] === 'NIL', 'macOS：选回头像版时清除自定义图标', calls[1]);
