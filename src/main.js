// Hopsnap 主进程：托盘、快捷键、截图覆盖层、贴图、录屏
const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell,
  screen, desktopCapturer, session, Notification, systemPreferences, nativeTheme, globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./settings');
const hotkeys = require('./hotkeys');
const { captureDisplay, cursorDisplay } = require('./capture');
const clip = require('./clip');
const i18n = require('./i18n');
const update = require('./update');
const t = i18n.t;
const { createPresent } = require('./present');
const { createFileTools } = require('./filetools/bridge');
const { noticeForRegisterFailure } = require('./hotkey-notice');
const { finalizeMp4 } = require('./mp4fix');
const { createNotch } = require('./notch');
const { menuAndHover, trayLabel } = require('./notch-logic');
const os = require('os');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const R = (...p) => path.join(__dirname, ...p);
const ASSETS = path.join(__dirname, '..', 'assets');

// 系统声音（loopback）所需的 Chromium 特性开关，必须在 ready 之前设置
app.commandLine.appendSwitch('enable-features', [
  'MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride', 'PulseaudioLoopbackForScreenShare',
].join(','));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (process.env.HOPSNAP_TEST) app.commandLine.appendSwitch('no-sandbox');
// 自动化测试：用 Chromium 的虚拟摄像头 / 麦克风（只在未打包的开发环境生效）
if (process.env.HOPSNAP_TEST && process.env.HOPSNAP_FAKE_MEDIA && !app.isPackaged) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
// 自动化测试：云端测试机没有显卡，用软件 WebGL 跑水波纹（HOPSNAP_TEST_NOGL=1 时不开，用来测「没有 WebGL 时退回单圈」）
if (process.env.HOPSNAP_TEST && !process.env.HOPSNAP_TEST_NOGL && !app.isPackaged) app.commandLine.appendSwitch('enable-unsafe-swiftshader');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (isWin) app.setAppUserModelId('com.hopsnap.app');

let settings;
let tray = null;
let trayMenu = null;
let notch = null;
let overlayWin = null;
let overlayReady = null;
let overlayBusy = false;
let overlaySession = null; // 当前截图会话 { display, mode }
let settingsWin = null;
let hotkeyStatus = {};
const pins = new Set();
let rec = null; // 录制状态
let fileTools = null;
let present = null; // 演示层 + 摄像头圆窗（present.js）
const liveNotifications = new Set();

// ---------------------------------------------------------------- 日志与全局错误处理
let logFile = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  if (process.env.HOPSNAP_DEBUG) process.stdout.write(line);
  try {
    if (!logFile) { const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true }); logFile = path.join(dir, 'hopsnap.log'); }
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line);
  } catch {}
}
// 各模块里的 console.error / console.warn 也写进日志文件（打包后的 Windows 版没有控制台）
for (const k of ['error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { orig(...a); try { log(k.toUpperCase(), ...a); } catch {} };
}
let lastErrBox = 0;
function reportError(title, err) {
  log('ERROR', title, err);
  if (process.env.HOPSNAP_TEST) { console.log('REPORTED_ERROR', title, (err && err.message) || err); return; }
  if (Date.now() - lastErrBox < 3000) return;
  lastErrBox = Date.now();
  try { dialog.showErrorBox(title, `${(err && err.message) || err}\n\n${t('（详细信息已记录到日志：设置 → 关于 → 打开日志）')}`); } catch {}
}
process.on('uncaughtException', (err) => reportError(t('Hopsnap 遇到问题'), err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));

// ---------------------------------------------------------------- 工具函数
function stamp(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// 逐级创建目录（不用 recursive，避免某些文件系统/掉线的网络盘上 Node 死循环）
function ensureDir(dir) {
  try {
    if (fs.existsSync(dir)) return dir;
    const missing = []; let cur = path.resolve(dir);
    for (let i = 0; i < 64 && !fs.existsSync(cur); i++) { missing.unshift(cur); const up = path.dirname(cur); if (up === cur) break; cur = up; }
    for (const d of missing) fs.mkdirSync(d);
  } catch (e) { log('mkdir failed', dir, e.message); }
  return dir;
}
function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`); let i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base}_${i++}.${ext}`);
  return p;
}
// 录屏：录制中写到「成品名.part」，保存完成后才改成正式文件名（文件夹里出现 .mp4 / .gif 就表示已经好了）
const PART = '.part';
function uniqueRecPath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`); let i = 1;
  while (fs.existsSync(p) || fs.existsSync(p + PART)) p = path.join(dir, `${base}_${i++}.${ext}`);
  return p;
}
async function renameRetry(from, to) {
  let last;
  for (let i = 0; i < 8; i++) { try { fs.renameSync(from, to); return true; } catch (e) { last = e; await sleep(250 * (i + 1)); } } // 杀毒软件 / 索引可能短暂锁住
  log('rename failed', from, to, last && last.message);
  return false;
}
// 免安装版（zip）没有开始菜单快捷方式，Windows 不会显示系统通知 → 改用托盘气泡
function isPortableWin() {
  if (!isWin || !app.isPackaged) return false;
  try { return !fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Hopsnap.exe')); } catch { return false; }
}
function notify(title, body, onClick) {
  log('notify', title, body || '');
  if (process.env.HOPSNAP_TEST) console.log('NOTIFY', title, '|', body || '');
  try {
    if (isPortableWin() && tray && !tray.isDestroyed()) {
      tray.displayBalloon({ title, content: body || ' ', iconType: 'info', noSound: !((settings && settings.get().sound) || {}).notify });
      if (onClick) { tray.removeAllListeners('balloon-click'); tray.once('balloon-click', onClick); }
      return;
    }
    if (!Notification.isSupported()) return;
    const snd = (settings && settings.get().sound) || {};
    const n = new Notification({ title, body, silent: !snd.notify, icon: logoFile('icon.png') });
    if (onClick) n.on('click', onClick);
    liveNotifications.add(n);
    const drop = () => liveNotifications.delete(n);
    n.on('close', drop); n.on('click', () => setTimeout(drop, 1000));
    setTimeout(drop, 10 * 60 * 1000);
    n.show();
  } catch {}
}
// 音效：由常驻的覆盖层窗口播放（隐藏状态也能出声）
function playSound(name) {
  try {
    const snd = settings.get().sound || {};
    if (!name || name === 'off' || !overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send('overlay:sound', name, Math.max(0, Math.min(1, (snd.volume ?? 70) / 100)));
  } catch {}
}
function captureSound() { const snd = settings.get().sound || {}; playSound(snd.capture || 'shutter'); }
function imageBuffer(pngBuf) {
  const s = settings.get().capture;
  if (s.imageFormat === 'jpg') return { buf: nativeImage.createFromBuffer(pngBuf).toJPEG(s.jpgQuality || 92), ext: 'jpg' };
  return { buf: pngBuf, ext: 'png' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 带重试的写文件：Windows 上杀毒软件/索引服务可能短暂锁住文件；
// 被「受控文件夹访问」拦截时，可回退到用户主目录下的 Hopsnap 文件夹
function fallbackDir() { return ensureDir(path.join(app.getPath('home'), 'Hopsnap')); }
async function safeWrite(file, buf, allowFallback = true) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try { fs.writeFileSync(file, buf); return { ok: true, file }; } catch (e) { lastErr = e; await sleep(120 * (i + 1)); }
  }
  if (allowFallback) {
    const alt = uniquePath(fallbackDir(), path.parse(file).name, path.extname(file).slice(1) || 'png');
    try { fs.writeFileSync(alt, buf); log('write fallback', file, '->', alt, lastErr && lastErr.message); return { ok: true, file: alt, fallback: true }; } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr && lastErr.message };
}
async function safeClip(png) {
  for (let i = 0; i < 4; i++) {
    try { await clip.writeImagePng(png); return true; } catch (e) { log('clipboard write failed', e.message); await sleep(150); }
  }
  return false;
}
// 检查文件夹是否可写（受控文件夹访问 / 只读盘 / 已拔出的 U 盘）
function writableDir(dir) {
  try {
    ensureDir(dir);
    const probe = path.join(dir, `.hopsnap-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe);
    return true;
  } catch (e) { log('dir not writable', dir, e.message); return false; }
}
async function unlinkRetry(f) {
  for (let i = 0; i < 6; i++) { try { if (fs.existsSync(f)) fs.unlinkSync(f); return; } catch { await sleep(300 * (i + 1)); } }
}
function historyDir() { return ensureDir(path.join(app.getPath('userData'), 'history')); }

function addHistory(pngBuf) {
  try {
    const dir = historyDir();
    const id = `${Date.now()}`;
    fs.writeFileSync(path.join(dir, `${id}.png`), pngBuf);
    const img = nativeImage.createFromBuffer(pngBuf);
    const { width, height } = img.getSize();
    const scale = Math.min(1, 320 / Math.max(width, 1));
    const thumb = img.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'good' });
    fs.writeFileSync(path.join(dir, `${id}.thumb.jpg`), thumb.toJPEG(80));
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, time: Date.now(), width, height }));
    // 超出上限删除最旧
    const max = settings.get().capture.historyMax || 30;
    const items = listHistory(false);
    for (const it of items.slice(max)) removeHistory(it.id);
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('history:changed');
  } catch (e) { console.error('history failed', e); }
}
// 截图自动保存：在后台进行，不拖慢覆盖层关闭
function autoSaveShot(png) {
  const s = settings.get().capture;
  if (!s.autoSave) return;
  setTimeout(async () => {
    try {
      const { buf, ext } = imageBuffer(png);
      const saved = await safeWrite(uniquePath(ensureDir(s.saveDir), `Hopsnap_${stamp()}`, ext), buf, true);
      if (!saved.ok) { log('autosave failed', saved.error); notify(t('截图自动保存失败'), saved.error || ''); }
      else if (saved.fallback) notify(t('截图已改存到备用文件夹'), t('原文件夹无法写入，已保存到 {file}', { file: saved.file }));
    } catch (e) { log('autosave error', e); }
  }, 0);
}
// 复制失败时告诉用户（截图仍在历史里）
async function copyOrWarn(png) {
  const ok = await safeClip(png);
  if (!ok) {
    // 覆盖层置顶盖着整个屏幕，弹窗会被挡住：等覆盖层关掉以后再提示
    const warn = () => reportError(t('复制到剪贴板失败'), t('剪贴板可能正被其他软件占用。\n这张截图已保存在 设置 → 历史 / 剪贴板，可以在那里重新复制。'));
    const wait = (n) => { if (!overlayBusy || n > 50) warn(); else setTimeout(() => wait(n + 1), 100); };
    setTimeout(() => wait(0), 100);
  }
  return ok;
}
function listHistory(withThumb = true) {
  const dir = historyDir();
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch {}
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (withThumb) {
        const t = path.join(dir, `${meta.id}.thumb.jpg`);
        meta.thumb = fs.existsSync(t) ? `data:image/jpeg;base64,${fs.readFileSync(t).toString('base64')}` : '';
      }
      out.push(meta);
    } catch {}
  }
  return out.sort((a, b) => b.time - a.time);
}
function removeHistory(id) {
  const dir = historyDir();
  for (const ext of ['.png', '.thumb.jpg', '.json']) { try { fs.unlinkSync(path.join(dir, `${id}${ext}`)); } catch {} }
}
function historyPng(id) { return fs.readFileSync(path.join(historyDir(), `${String(id).replace(/[^0-9]/g, '')}.png`)); }

// ---------------------------------------------------------------- 界面语言
// general.language: 'auto'（跟随系统）| 'zh' | 'en'
function systemLangs() {
  if (process.env.HOPSNAP_SYSLANG) return [process.env.HOPSNAP_SYSLANG]; // 测试用
  try { const l = app.getPreferredSystemLanguages(); if (l && l.length) return l; } catch {}
  try { return [app.getLocale()]; } catch { return []; }
}
function applyLanguage() {
  const pref = (settings.get().general || {}).language || 'auto';
  const lang = i18n.setLang(i18n.resolve(pref, systemLangs()));
  log('language', pref, '->', lang, systemLangs().join(','));
  return lang;
}
ipcMain.on('app:lang', (e) => { e.returnValue = i18n.getLang(); });
function rebuildOverlayWin() {
  if (overlayWin && !overlayBusy) { const old = overlayWin; overlayWin = null; old.destroy(); createOverlay(); return true; }
  return false;
}
// 切换语言后刷新已经打开的界面：托盘菜单、截图层（预加载的）、设置窗口
function refreshLanguageUi() {
  if (tray || notch) buildTrayMenu();
  if (fileTools) fileTools.refreshLanguage();
  if (notch && !rec) notch.reload();
  if (!rebuildOverlayWin() && overlayWin) {
    // 正在截图：截图结束后再重建
    const wait = () => { if (overlayBusy) setTimeout(wait, 500); else rebuildOverlayWin(); };
    setTimeout(wait, 500);
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setTitle(t('Hopsnap 设置'));
    settingsWin.loadFile(R('renderer', 'settings.html'), { query: themeQuery('general') });
  }
  if (permWin && !permWin.isDestroyed()) { permWin.setTitle(t('Hopsnap · 权限')); permWin.loadFile(R('renderer', 'perm.html')); }
}
function setLanguage(v) {
  const before = i18n.getLang();
  settings.set({ general: { language: ['zh', 'en'].includes(v) ? v : 'auto' } });
  const after = applyLanguage();
  if (after !== before) refreshLanguageUi(); else if (tray) buildTrayMenu();
}

// ---------------------------------------------------------------- 托盘
function trayIcon() {
  const img = nativeImage.createFromPath(logoFile(isMac ? 'trayMac.png' : 'tray.png'));
  if (isMac) img.setTemplateImage(true); // 菜单栏用黑白模板图（小青蛙剪影），系统按深浅色自动反色
  return img;
}

// ---------------------------------------------------------------- 应用图标（2.0 起只有一套：小青蛙，assets/logos/frog）
// 下面的快捷方式 / 访达图标逻辑保留，以后要加备选图标时直接往 LOGOS 里加目录名即可。
const LOGOS = ['frog'];
const BUILTIN_LOGO = 'frog';
function logoName() { const l = settings && settings.get().general.logo; return LOGOS.includes(l) ? l : BUILTIN_LOGO; }
function logoFile(f, name = logoName()) { return path.join(ASSETS, 'logos', name, f); }
// 资源管理器 / 访达读不到 asar 里的文件 → 用 asarUnpack 解出来的副本
function unpackedPath(p) { return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); }

function winShortcutPaths() {
  const appData = app.getPath('appData');
  const list = [path.join(app.getPath('desktop'), 'Hopsnap.lnk'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hopsnap.lnk'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Hopsnap.lnk')];
  try { const pub = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop', 'Hopsnap.lnk'); list.push(pub); } catch {}
  return list;
}
// Windows：把指向本程序的快捷方式图标改成所选版本（头像版 = exe 自带图标）。已经一致的不动。
function applyWinShortcutIcons(name) {
  const res = { changed: 0, failed: 0, found: 0 };
  if (!isWin || !app.isPackaged) return res;
  const exe = process.execPath.toLowerCase();
  const want = name === BUILTIN_LOGO ? { icon: process.execPath, iconIndex: 0 } : { icon: unpackedPath(logoFile('icon.ico', name)), iconIndex: 0 };
  for (const lnk of winShortcutPaths()) {
    try {
      if (!fs.existsSync(lnk)) continue;
      const cur = shell.readShortcutLink(lnk);
      if (!cur.target || cur.target.toLowerCase() !== exe) continue;
      res.found++;
      if ((cur.icon || '').toLowerCase() === want.icon.toLowerCase() || (!cur.icon && name === BUILTIN_LOGO)) continue;
      if (shell.writeShortcutLink(lnk, 'update', want)) res.changed++; else res.failed++;
    } catch (e) { res.failed++; log('shortcut icon', lnk, e.message); }
  }
  if (res.changed) { try { require('child_process').spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {} }
  log('shortcut icons', name, res);
  return res;
}
// macOS：访达 / 启动台里的 .app 图标（NSWorkspace setIcon，选回头像版时清掉自定义图标）
function macBundlePath() {
  if (!isMac || !app.isPackaged) return null;
  const p = path.resolve(process.execPath, '..', '..', '..');
  return p.endsWith('.app') ? p : null;
}
function applyMacBundleIcon(name) {
  return new Promise((resolve) => {
    const bundle = macBundlePath();
    if (!bundle) return resolve({ ok: false, skipped: true });
    const custom = name !== BUILTIN_LOGO;
    if (fs.existsSync(path.join(bundle, 'Icon\r')) === custom && settings.get().general.logoMacOk === custom) return resolve({ ok: true, unchanged: true });
    const js = "ObjC.import('AppKit'); function run(argv) { var img = argv[0] ? $.NSImage.alloc.initWithContentsOfFile(argv[0]) : $(); " +
      "return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, argv[1], 0) ? 'ok' : 'fail'; }";
    require('child_process').execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', js, custom ? unpackedPath(logoFile('mac.png', name)) : '', bundle],
      { timeout: 10000 }, (err, out) => {
        const ok = !err && String(out).trim() === 'ok';
        if (!ok) log('mac bundle icon failed', name, (err && err.message) || out);
        resolve({ ok });
      });
  });
}
// system=true：连系统里的快捷方式 / 访达图标一起改（用户在设置里切换、或启动时发现不一致）
async function applyLogo({ system = false } = {}) {
  const name = logoName();
  try { if (tray && !tray.isDestroyed()) tray.setImage(trayIcon()); } catch (e) { log('tray icon', e.message); }
  try { if (settingsWin && !settingsWin.isDestroyed() && !isMac) settingsWin.setIcon(logoFile('icon.png')); } catch {}
  try { if (isMac && app.dock) app.dock.setIcon(nativeImage.createFromPath(logoFile('mac.png'))); } catch {}
  if (process.env.HOPSNAP_TEST) console.log('LOGO', name);
  const out = { logo: name, shortcuts: null, finder: null };
  if (!system) return out;
  if (isWin) out.shortcuts = applyWinShortcutIcons(name);
  if (isMac) {
    out.finder = await applyMacBundleIcon(name);
    if (!out.finder.skipped && !out.finder.unchanged) settings.set({ general: { logoMacOk: out.finder.ok ? name !== BUILTIN_LOGO : false } });
  }
  return out;
}

// ---------------------------------------------------------------- 主题（2.0 起只有一套「呱咔」配色，深浅色由 general.appearance 决定：system | light | dark）
// 旧版的 general.theme（9 套配色）不再使用；下面的 glass 重建逻辑保留但不会再触发。
const THEMES = ['frog'];
// 设置窗口的底色（加载前 / 标题栏按钮区），[浅色, 深色]；要和 settings.css 里的 --bg 一致
const THEME_BG = { frog: ['#FAF6EC', '#121B16'] };
function themeSetting() { return 'frog'; }
function themeName() { return 'frog'; }
function themeDark() { return nativeTheme.shouldUseDarkColors; }
function themeBg(theme = themeName()) { return THEME_BG[theme][themeDark(theme) ? 1 : 0]; }
// 系统毛玻璃：Windows 11 22H2 起（亚克力）、macOS（vibrancy）；其他系统用 CSS 模拟
function canMaterial() { return isMac || (isWin && winBuild >= 22621); }
function themeQuery(tab) { const th = themeName(); return { tab, theme: th, mat: th === 'glass' && canMaterial() ? '1' : '' }; }
function applyAppearance() {
  const a = (settings.get().general || {}).appearance;
  try { nativeTheme.themeSource = ['light', 'dark'].includes(a) ? a : 'system'; } catch {}
}
function styleSettingsWin(win) {
  if (!win || win.isDestroyed()) return false;
  const theme = themeName(); const glass = theme === 'glass' && canMaterial();
  try {
    if (isWin && winBuild >= 22621) win.setBackgroundMaterial(glass ? 'acrylic' : 'none');
    if (isMac) win.setVibrancy(glass ? 'under-window' : null);
    win.setBackgroundColor(glass ? '#00000000' : themeBg(theme));
    if (!isMac && win.setTitleBarOverlay) win.setTitleBarOverlay({ color: glass ? '#00000000' : themeBg(theme), symbolColor: themeDark(theme) ? '#B9C6BE' : '#5C6660', height: 36 });
  } catch (e) { log('theme window', e.message); }
  return glass;
}
// Mac 的毛玻璃窗口必须在创建时就是透明的。1.3.3 是先建不透明窗口、换到「透明玻璃」时再改成透明：
// macOS 上这样改，窗口底层仍按不透明处理，透明的地方每一帧都不清空 → 滚动后内容重影、上一个主题的颜色残留。
// 所以在 Mac 上切入 / 切出「透明玻璃」时重建设置窗口（位置、大小、当前页、滚动位置不变）。
// HOPSNAP_TEST_MACGLASS：只给 Linux 自动化测试用，走同样的重建流程（Linux 没有系统毛玻璃）。
const glassRebuild = () => isMac || !!(process.env.HOPSNAP_TEST && process.env.HOPSNAP_TEST_MACGLASS);
const glassWinWanted = () => glassRebuild() && themeName() === 'glass';
const settingsNeedsRebuild = (win) => glassRebuild() && !!win.glassBuilt !== glassWinWanted();
let settingsRebuild = null;
function rebuildSettings() {
  if (settingsRebuild) return settingsRebuild;
  const old = settingsWin;
  settingsRebuild = (async () => {
    let st = {};
    // 页面卡住 / 正在重新加载时 executeJavaScript 可能一直不返回：最多等 0.8 秒
    try { st = await Promise.race([old.webContents.executeJavaScript("({ tab: ((document.querySelector('nav a.on') || {}).dataset || {}).tab || 'general', scroll: (document.querySelector('main') || {}).scrollTop || 0 })"), new Promise((r) => setTimeout(() => r({}), 800))]) || {}; } catch {}
    if (old.isDestroyed() || settingsWin !== old) return;   // 这期间用户关掉了设置窗口
    let revealed; const shown = new Promise((r) => { revealed = r; });
    const opts = { bounds: old.getBounds(), maximized: old.isMaximized(), fullScreen: old.isFullScreen(), visible: old.isVisible(),
      scroll: Math.round(+st.scroll || 0), toast: 1, replace: old, onReveal: () => revealed() };
    old.replaced = true;
    settingsWin = null;
    try { openSettings(typeof st.tab === 'string' ? st.tab : 'general', opts); }
    catch (e) { old.replaced = false; settingsWin = old; throw e; }
    log('settings window rebuilt for theme ' + themeName());
    await shown;   // 新窗口显示、旧窗口关掉以后才算完成：这期间再换主题，等完成后统一处理
  })().catch((e) => log('settings rebuild', e.message)).finally(() => {
    settingsRebuild = null;
    applyTheme();   // 重建期间又换了主题 / 深浅色：再套一次（需要的话再重建）
  });
  return settingsRebuild;
}
function applyTheme() {
  const theme = themeName();
  if (settingsWin && !settingsWin.isDestroyed() && !settingsRebuild) {
    if (settingsNeedsRebuild(settingsWin)) rebuildSettings();
    else {
      const material = styleSettingsWin(settingsWin);
      settingsWin.webContents.send('settings:theme', { theme, material, setting: themeSetting() });
    }
  }
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('overlay:theme', theme);
  if (process.env.HOPSNAP_TEST) console.log('THEME', theme, nativeTheme.themeSource);
  return theme;
}
function accelLabel(action) {
  const h = settings.get().hotkeys[action] || {};
  return [h.keyboard, h.mouse].filter(Boolean).join(' / ');
}
let lastTrayTpl = [];
function presentHaloOn() {
  return !!(present && present.isDemo() && settings.get().present.halo);
}
function presentClicksOn() {
  return !!(present && present.isDemo() && settings.get().present.clicks);
}
function setPresentHalo(on) {
  on = !!on;
  settings.set({ present: { halo: on } });
  if (!present) return;
  if (on) present.setDemo(true);
  else if (!settings.get().present.clicks) present.setDemo(false);
  else present.applySettings();
}
function setPresentClicks(on) {
  on = !!on;
  settings.set({ present: { clicks: on } });
  if (!present) return;
  if (on) present.setDemo(true);
  else if (!settings.get().present.halo) present.setDemo(false);
  else present.applySettings();
}
function runNotchCmd(id) {
  if (notch) notch.collapse();
  if (id === 'shot') return startCapture('shot');
  if (id === 'record') return startCapture('record');
  if (id === 'recordFull') return startFullRecording();
  if (id === 'stop') return stopRecording();
}
function buildTrayMenu() {
  const recording = !!rec;
  const { menu, hover } = menuAndHover({ recording, label: t, accel: accelLabel });
  const tpl = [
    // Mac 还没屏幕录制权限：菜单第一行就是入口，不用等用户按快捷键才发现截不了
    ...(isMac && !macScreenOk() ? [{ label: t('⚠️ 先开一下屏幕录制权限…'), click: () => openPermWindow() }, { type: 'separator' }] : []),
    // 截图 / 录制这几行和刘海悬停菜单是同一份（notch-logic）
    ...menu.map((it) => ({ label: trayLabel(it), enabled: it.enabled !== false, click: () => runNotchCmd(it.id) })),
    {
      label: t('演示'),
      submenu: [
        { label: `${t('鼠标光圈')}\t${accelLabel('presentMode')}`, type: 'checkbox', checked: presentHaloOn(), click: (m) => setPresentHalo(m.checked) },
        { label: t('点击波纹'), type: 'checkbox', checked: presentClicksOn(), click: (m) => setPresentClicks(m.checked) },
        { label: `${t('聚光灯')}\t${accelLabel('spotlight')}`, type: 'checkbox', checked: !!(present && present.isSpot()), click: (m) => present && present.setSpot(m.checked) },
        { label: t('摄像头'), type: 'checkbox', checked: !!(present && present.camOn()), click: (m) => toggleCamera(m.checked) },
      ],
    },
    {
      label: t('文件'),
      submenu: [
        { label: `${t('全屏截图到剪贴板')}\t${accelLabel('captureFull')}`, click: () => captureFullToClipboard() },
        { label: `${t('钉图')}\t${accelLabel('pinClipboard')}`, click: () => pinClipboard() },
        { label: t('历史'), click: () => openSettings('history') },
        { label: t('截图夹'), click: () => shell.openPath(ensureDir(settings.get().capture.saveDir)) },
        { label: t('录屏夹'), click: () => shell.openPath(ensureDir(settings.get().record.saveDir)) },
        { type: 'separator' },
        { label: t('文件工具…'), click: () => fileTools && fileTools.openWindow() },
      ],
    },
    { label: t('设置…'), click: () => openSettings('general') },
    // 有新版本：菜单里多一行，点了去下载页；不弹窗打扰
    ...(updateInfo && updateInfo.hasUpdate ? [{ label: t('有新版本 {v}，去下载…', { v: updateInfo.latest }), click: () => shell.openExternal(updateInfo.url) }] : []),
    { label: t('退出'), click: () => { app.isQuitting = true; app.quit(); } },
  ];
  lastTrayTpl = tpl;
  if (tray && !tray.isDestroyed()) {
    trayMenu = Menu.buildFromTemplate(tpl);
    tray.setContextMenu(trayMenu);
    tray.setToolTip(recording ? t('Hopsnap — 录制中') : t('Hopsnap 截图录屏'));
  }
  if (notch) notch.sync(hover);
}
function createTray() {
  tray = new Tray(trayIcon());
  buildTrayMenu();
  // Windows 双击时会先触发一次 click：单击立即截图；随后来的双击把刚开的截图收掉，只打开设置
  let lastTrayClick = 0;
  if (!isMac) tray.on('click', () => { lastTrayClick = Date.now(); startCapture('shot'); });
  tray.on('double-click', async () => {
    if (Date.now() - lastTrayClick < 1500 && overlayBusy && (!overlaySession || overlaySession.mode === 'shot')) {
      const t0 = Date.now();
      while (overlayBusy && !overlaySession && Date.now() - t0 < 1500) await sleep(30); // 截图还在准备中
      if (overlayBusy) await hideOverlay();
    }
    openSettings('general');
  });
}

// ---------------------------------------------------------------- 快捷键
function applyHotkeys() {
  const hadEsc = escHeld, hadKeys = keysHeld.length > 0;
  escHeld = false; keysHeld = []; // register() 会 unregisterAll，临时接管的 Esc / Enter / Ctrl+C 也会被清掉
  hotkeyStatus = hotkeys.register(settings.get().hotkeys, (action) => {
    switch (action) {
      case 'capture': return startCapture('shot');
      case 'captureFull': return captureFullToClipboard();
      case 'recordRegion': return rec ? stopRecording() : startCapture('record');
      case 'recordFull': return rec ? stopRecording() : startFullRecording();
      case 'pinClipboard': return pinClipboard();
      case 'presentMode': return present && present.setDemo(!present.isDemo());
      case 'spotlight': return present && present.setSpot(!present.isSpot());
      case 'fileTools': return fileTools && fileTools.openWindow();
    }
  });
  if (hadEsc && overlayBusy) holdEsc();
  if (hadKeys && overlayBusy) holdKeys();
  // 设了鼠标快捷键但 Mac 还没授权「辅助功能」：让系统把 Hopsnap 加进列表（每个版本最多弹一次）
  if (Object.values(hotkeyStatus).some((st) => st && st.mouse === 'needPermission')) askAccessibilityOnce();
  if (tray) buildTrayMenu();
  return hotkeyStatus;
}

// 快捷键被其他软件（微信 / QQ / 钉钉…）占用：每次启动都检查，先重试，再自动换备用键并提示
const HOTKEY_NAMES = { capture: '截图', captureFull: '全屏截图', recordRegion: '区域录屏', recordFull: '全屏录屏', pinClipboard: '贴图', presentMode: '演示模式', spotlight: '聚光灯', fileTools: '文件工具' };
const CAPTURE_ALTS = isMac ? ['Control+Shift+A', 'Command+Shift+X', 'F1'] : ['Ctrl+Alt+A', 'Ctrl+Shift+A', 'Alt+Q', 'F1'];
function failedHotkeys() { return Object.keys(hotkeyStatus).filter((a) => (hotkeyStatus[a] || {}).keyboard === 'fail'); }
function checkHotkeyConflicts(attempt = 0) {
  const delays = process.env.HOPSNAP_TEST ? [1500, 3000] : [3000, 10000];
  if (!failedHotkeys().length) return;
  if (attempt < delays.length) {
    // 开机时别的软件可能只是先抢到、随后释放，先等一会儿重试
    setTimeout(() => { if (!overlayBusy && !hotkeys.isPaused()) applyHotkeys(); checkHotkeyConflicts(attempt + 1); }, delays[attempt]);
    return;
  }
  // 正在截图、或设置页正在录入快捷键时先不动，稍后再试
  if (overlayBusy || hotkeys.isPaused()) { setTimeout(() => checkHotkeyConflicts(attempt), 5000); return; }
  if ((hotkeyStatus.capture || {}).keyboard === 'fail') {
    const orig = settings.get().hotkeys.capture.keyboard;
    const norm = (k) => String(k || '').toLowerCase().replace(/control|commandorcontrol/g, 'ctrl');
    const used = Object.entries(settings.get().hotkeys).filter(([a]) => a !== 'capture').map(([, b]) => norm(b.keyboard));
    for (const k of CAPTURE_ALTS) {
      if (k === orig || used.includes(norm(k))) continue;
      settings.set({ hotkeys: { capture: { keyboard: k } } });
      applyHotkeys();
      if ((hotkeyStatus.capture || {}).keyboard === 'ok') {
        log('capture hotkey fallback', orig, '->', k);
        notify(t('截图快捷键已改为 {k}', { k }), t('{orig} 被其他软件占用（常见是微信），可以在 设置 → 快捷键 修改', { orig }));
        break;
      }
    }
    if ((hotkeyStatus.capture || {}).keyboard !== 'ok') {
      settings.set({ hotkeys: { capture: { keyboard: orig } } }); applyHotkeys();
    }
  }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed');
  // register 返回 false 或抛错时，每个「动作 + 这组键」只提醒一次，并指向设置。同一组键下次启动不再弹。
  const names = {};
  for (const a of Object.keys(HOTKEY_NAMES)) names[a] = t(HOTKEY_NAMES[a]);
  const note = noticeForRegisterFailure(hotkeyStatus, settings.get().hotkeys, (settings.get().general || {}).hotkeyFailNotified || {}, names);
  if (note.notify) {
    settings.set({ general: { hotkeyFailNotified: note.notified } });
    notify(t(note.title), t('{list} 没能注册。请到 设置 → 快捷键 换一个。', { list: note.list }), () => openSettings('hotkeys'));
  }
}

// ---------------------------------------------------------------- 截图覆盖层
function createOverlay(d = cursorDisplay()) {
  overlayWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: true, enableLargerThanScreen: true,
    type: isMac ? 'panel' : (isWin ? 'toolbar' : undefined),
    roundedCorners: false, acceptFirstMouse: true, titleBarStyle: isMac ? 'hidden' : undefined,
    webPreferences: { preload: R('preload.js'), backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  // 记住覆盖层创建时所在屏幕的缩放：跨不同缩放的屏幕移动隐藏窗口在 Windows 上会尺寸错乱，需重建
  overlayWin.createdScale = d.scaleFactor || 1;
  if (isMac) { try { overlayWin.setWindowButtonVisibility(false); } catch {} }
  overlayWin.setMenu(null);
  overlayReady = new Promise((res) => ipcMain.once('overlay:loaded', res));
  overlayWin.loadFile(R('renderer', 'overlay.html'), { query: { theme: themeName() } });
  const me = overlayWin;
  overlayWin.on('closed', () => { if (overlayWin === me) { overlayWin = null; overlayBusy = false; releaseEsc(); if (present) present.restoreAfterCapture(); } });
  overlayWin.webContents.on('render-process-gone', (_e, info) => {
    log('overlay renderer gone', info);
    if (overlayWin !== me) return;
    try { me.destroy(); } catch {}
    overlayWin = null; overlayBusy = false; overlaySession = null; releaseEsc();
    if (present) present.restoreAfterCapture();
  });
  // 截图进行中保持键盘焦点（Esc / Enter / 快捷键要能生效）
  overlayWin.on('focus', () => releaseEsc());
  overlayWin.on('blur', () => {
    if (!overlayBusy || overlayWin.inDialog || !overlayWin.isVisible()) return;
    holdEsc(); holdKeys();
    setTimeout(() => { if (overlayWin && overlayBusy && !overlayWin.inDialog && overlayWin.isVisible()) { overlayWin.focus(); overlayWin.webContents.focus(); } }, 60);
  });
  if (process.env.HOPSNAP_DEBUG) overlayWin.webContents.on('console-message', (e) => console.log('[overlay]', e.message));
}

// 截图期间临时注册 Esc，保证就算覆盖层没拿到焦点也能退出
let escHeld = false;
function holdEsc() {
  if (escHeld || overlayHiding) return;
  try { escHeld = globalShortcut.register('Escape', () => { if (overlayBusy) hideOverlay(); }); } catch { escHeld = false; }
}
function releaseEsc() {
  releaseKeys();
  if (!escHeld) return;
  try { globalShortcut.unregister('Escape'); } catch {}
  escHeld = false;
}
// 覆盖层没拿到键盘焦点时（Windows 前台锁：用鼠标侧键 / 托盘触发），临时接管 Enter 和 Ctrl+C
let keysHeld = [];
function holdKeys() {
  if (keysHeld.length || !overlayBusy || overlayHiding) return;
  for (const [acc, key] of [['Return', 'Enter'], ['CommandOrControl+C', 'copy']]) {
    try { if (globalShortcut.register(acc, () => { if (overlayBusy && overlayWin && !overlayWin.isDestroyed() && !overlayWin.isFocused()) overlayWin.webContents.send('overlay:key', key); })) keysHeld.push(acc); } catch {}
  }
}
function releaseKeys() {
  for (const acc of keysHeld) { try { globalShortcut.unregister(acc); } catch {} }
  keysHeld = [];
}

// ---------------------------------------------------------------- macOS 权限（1.3.5）
// 屏幕录制（截图、全屏截图、录屏共用）。注意两点：
//  · 在系统设置里打开开关后，正在运行的 Hopsnap 仍按「未授权」处理，必须真正退出再打开（只关窗口不算，它还在菜单栏里）。
//    所以提示框里直接给「重新打开 Hopsnap」按钮。
//  · 开关开着却一直不认：多半是系统里留着旧版本（不同签名）的授权记录。「修复权限」用 tccutil 清掉 Hopsnap 的旧记录，
//    再重新请求一次，用户重新打开开关即可。
const MAC_PANES = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};
const macScreenOk = () => { try { return systemPreferences.getMediaAccessStatus('screen') === 'granted'; } catch { return false; } };
let screenRequested = false;
let screenAtLaunch = null;   // 启动时屏幕录制是否已授权：中途才打开的开关要重开 Hopsnap 才生效
let permWin = null;
// 权限助手窗口：代替原来 4 个按钮的系统对话框。一步一步带用户开开关，每秒检查状态，开了自动进入下一步
function openPermWindow() {
  if (!isMac) return null;
  if (permWin && !permWin.isDestroyed()) { permWin.show(); permWin.focus(); return permWin; }
  const W = 440, H = 660;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = permWin = new BrowserWindow({
    width: W, height: H, x: Math.round(wa.x + wa.width - W - 24), y: Math.round(wa.y + (wa.height - H) / 2),   // 靠右，给中间的系统设置让位
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false, alwaysOnTop: true,
    title: t('Hopsnap · 权限'), backgroundColor: themeBg(), titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 16 },
    webPreferences: { preload: R('preload.js'), spellcheck: false },
  });
  win.setAlwaysOnTop(true, 'floating');   // 浮在系统设置上面，用户切到系统设置也看得到
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenu(null);
  win.loadFile(R('renderer', 'perm.html'));
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.on('closed', () => { if (permWin === win) permWin = null; });
  return win;
}
function closePermWindow() { if (permWin && !permWin.isDestroyed()) permWin.close(); }
// 页面按当前步骤报内容高度，窗口跟着收放（「全部就绪」只有一句话，不该留一大片空白）
ipcMain.on('perm:height', (e, h) => {
  if (!permWin || permWin.isDestroyed() || e.sender !== permWin.webContents) return;
  const [w, cur] = permWin.getSize();
  const wa = screen.getDisplayMatching(permWin.getBounds()).workArea;
  const want = Math.max(360, Math.min(wa.height - 40, 820, Math.round(h)));
  if (Math.abs(cur - want) > 4) {
    const [x, y] = permWin.getPosition();
    permWin.setBounds({ x, y: Math.max(wa.y + 20, Math.min(y, wa.y + wa.height - want - 20)), width: w, height: want }, true);   // 变高时别伸出屏幕底部
  }
});
// 让系统把 Hopsnap 加进「屏幕与系统录音」列表（没有记录时系统会弹一次自己的授权框；有记录时什么都不弹）
async function requestScreenAccess() {
  screenRequested = true;
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch {}
  return macScreenOk();
}
// 辅助功能：系统授权框每个版本最多弹一次（以前每次启动 / 每次改快捷键都可能弹）；其余时候只在设置页显示状态
function askAccessibilityOnce() {
  if (!isMac) return;
  const v = app.getVersion();
  if (settings.get().general.axAskedVer === v) return;
  settings.set({ general: { axAskedVer: v } });
  try { systemPreferences.isTrustedAccessibilityClient(true); } catch {}
}
let permOverride = null;   // 仅测试钩子用
function macPermState() {
  if (!isMac) return { mac: false };
  const st = (k) => { try { return systemPreferences.getMediaAccessStatus(k); } catch { return 'unknown'; } };
  if (permOverride) return { mac: true, screen: 'denied', accessibility: 'denied', camera: 'not-determined', microphone: 'not-determined', axNeeded: false, needRelaunch: false, ...permOverride };
  return {
    mac: true, screen: st('screen'), accessibility: hotkeys.axTrusted() ? 'granted' : 'denied', camera: st('camera'), microphone: st('microphone'),
    // 用了鼠标快捷键 / 点击波纹才需要辅助功能；不需要时设置页不标红
    axNeeded: Object.values(settings.get().hotkeys).some((h) => h && h.mouse) || !!settings.get().present.clicks,
    // 这次启动时还没授权、中途才打开的开关：系统只认重新打开后的进程
    needRelaunch: screenAtLaunch === false && st('screen') === 'granted',
    inApplications: (() => { try { return app.isInApplicationsFolder(); } catch { return null; } })(),
    translocated: /\/AppTranslocation\//.test(process.execPath),
  };
}
function relaunchApp() {
  if (rec) { notify(t('正在录屏，结束后再重新打开')); return; }
  log('relaunch for permissions');
  const bundle = macBundlePath();
  if (bundle) {
    // 等这个进程真正退出后再用 open 重新打开（经过 LaunchServices，系统按新进程重新检查授权）
    try {
      require('child_process').spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; /usr/bin/open "$2"', 'relaunch', String(process.pid), bundle],
        { detached: true, stdio: 'ignore' }).unref();
      app.quit();
      return;
    } catch (e) { log('relaunch via open failed', e.message); }
  }
  app.relaunch();
  app.quit();
}
function runTool(file, args, timeout = 8000) {
  return new Promise((resolve) => {
    require('child_process').execFile(file, args, { timeout }, (err, out, errOut) =>
      resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || (err && err.message) || '').trim() }));
  });
}
// 清掉 Hopsnap 在系统里的旧授权记录（只影响 Hopsnap 自己）
async function resetMacPerms(services) {
  const id = 'com.hopsnap.app';
  const res = {};
  for (const s of services) res[s] = await runTool('/usr/bin/tccutil', ['reset', s, id]);
  log('tccutil reset', JSON.stringify(res));
  return res;
}
// 「修复权限」：清旧记录 → 重新请求（Hopsnap 重新出现在列表里）→ 打开系统设置 → 提示打开开关后重新打开 Hopsnap
async function repairMacPerms(parent, quiet = false) {
  // 辅助功能已经正常的不动（不然鼠标快捷键会被清掉）；清了的话马上请系统把 Hopsnap 加回列表
  const axOk = hotkeys.axTrusted();
  const res = await resetMacPerms(axOk ? ['ScreenCapture'] : ['ScreenCapture', 'Accessibility']);
  const failed = Object.values(res).some((r) => !r.ok);
  if (!axOk) { try { systemPreferences.isTrustedAccessibilityClient(true); } catch {} }
  await requestScreenAccess();
  shell.openExternal(MAC_PANES.screen);
  if (quiet) return { ok: !failed, res };   // 权限助手里调用：结果显示在助手窗口里，不弹系统对话框
  const r = await dialog.showMessageBox(parent || undefined, {
    type: failed ? 'warning' : 'info', buttons: [t('重新打开 Hopsnap'), t('稍后')], defaultId: 0, cancelId: 1,
    message: failed ? t('没能自动清除旧的授权记录') : t('已清除 Hopsnap 旧的授权记录'),
    detail: failed
      ? t('请在系统设置的「屏幕与系统录音」和「辅助功能」里选中 Hopsnap，点下面的「−」删掉，再点「+」重新添加 Hopsnap 并打开开关，然后点「重新打开 Hopsnap」。')
      : t('请在系统设置的「屏幕与系统录音」里打开 Hopsnap（用鼠标快捷键 / 点击波纹的话，「辅助功能」也要打开），然后点「重新打开 Hopsnap」。'),
  });
  if (r.response === 0) relaunchApp();
  return { ok: !failed, res };
}
// 诊断信息：Benji 反馈权限问题时复制给我们
async function macDiag(deep = true) {
  const bundle = macBundlePath();
  const out = { version: app.getVersion(), macOS: process.getSystemVersion ? process.getSystemVersion() : os.release(), arch: process.arch,
    execPath: process.execPath, bundle, ...macPermState() };
  if (bundle) {
    const dr = await runTool('/usr/bin/codesign', ['-d', '-r-', bundle]);
    out.requirement = (dr.out + '\n' + dr.err).split('\n').filter((l) => /designated/.test(l)).join(' ').trim();
    if (deep) {   // 完整校验要读整个程序包，只在用户点「复制诊断信息」时做
      const v = await runTool('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], 20000);
      out.signatureValid = v.ok ? 'yes' : (v.err || 'no').slice(0, 300);
    }
    out.customIcon = fs.existsSync(path.join(bundle, 'Icon\r'));
  }
  return out;
}
async function ensureScreenPerm() {
  if (!isMac) return true;
  if (macScreenOk()) return true;
  // 第一次（这次启动内）先请求一下：没有记录的话系统会弹自己的授权框
  if (!screenRequested && await requestScreenAccess()) return true;
  log('screen permission missing', JSON.stringify(macPermState()));
  openPermWindow();
  return false;
}
// ---------------------------------------------------------------- 检查更新（2.0）
// 每天最多问 GitHub 一次；有新版本：托盘多一行 + 每个版本通知一次。「关于」页可以手动查，常规页可以关掉自动检查。
let updateInfo = null;
async function checkUpdate(manual = false) {
  const r = await update.check();
  log('update check', JSON.stringify(r));
  if (r.ok) {
    settings.set({ general: { updateCheckedAt: Date.now() } });
    updateInfo = r;
    buildTrayMenu();
    if (r.hasUpdate && !manual && settings.get().general.updateNotified !== r.latest) {
      settings.set({ general: { updateNotified: r.latest } });
      notify(t('Hopsnap 有新版本 {v}', { v: r.latest }), t('点击查看更新内容和下载'), () => shell.openExternal(r.url));
    }
  }
  return r;
}
function scheduleUpdateCheck() {
  if (!app.isPackaged || process.env.HOPSNAP_TEST) return;
  const tick = () => {
    const g = settings.get().general;
    if (!g.updateCheck) return;
    if (Date.now() - (g.updateCheckedAt || 0) < 24 * 3600 * 1000) return;
    checkUpdate(false).catch((e) => log('update check failed', e.message));
  };
  setTimeout(tick, 30 * 1000);               // 启动 30 秒后
  setInterval(tick, 6 * 3600 * 1000);        // 之后每 6 小时看一眼（常驻不退出的机器）
}

// 启动时：记录权限状态；不在「应用程序」文件夹里运行时建议移过去（在下载文件夹 / 隔离状态下运行，授权容易对不上）；
// 还没有屏幕录制权限就直接打开权限助手（用户点过「稍后再说」的话，启动时不再主动弹，截图时还是会弹）
async function macStartupChecks() {
  if (!isMac) return;
  setTimeout(() => { macDiag(false).then((d) => log('mac permissions', JSON.stringify(d))).catch((e) => log('mac diag failed', e.message)); }, 3000);
  if (!app.isPackaged || process.env.HOPSNAP_TEST) return;
  let inApps = true; try { inApps = app.isInApplicationsFolder(); } catch {}
  if (!inApps && settings.get().general.macMoveAsk) {
    const r = await dialog.showMessageBox({
      type: 'question', buttons: [t('移到「应用程序」'), t('不移'), t('不再提示')], defaultId: 0, cancelId: 1,
      message: t('把 Hopsnap 移到「应用程序」文件夹？'),
      detail: t('现在 Hopsnap 不在「应用程序」文件夹里运行。直接从下载文件夹打开时，macOS 的屏幕录制 / 辅助功能授权容易对不上、反复要求授权。'),
    });
    if (r.response === 2) settings.set({ general: { macMoveAsk: false } });
    if (r.response === 0) {
      if (rec) { notify(t('没能移动 Hopsnap'), t('正在录屏，结束后再重新打开')); return; }
      let moved = false;
      try { moved = app.moveToApplicationsFolder(); } catch (e) { log('move to Applications failed', e.message); }
      // 成功时 Electron 会自己退出并从「应用程序」重新打开；失败（例如取消了管理员密码）才会走到这里
      if (!moved) notify(t('没能移动 Hopsnap'), t('请手动把 Hopsnap 拖进「应用程序」文件夹，再从那里打开。'));
      return;
    }
  }
  if (macScreenOk() || settings.get().general.permAutoOpen === false) return;
  await requestScreenAccess();   // 第一次：系统会弹自己的授权框，把 Hopsnap 加进列表
  if (!macScreenOk()) openPermWindow();
}

async function startCapture(mode = 'shot') {
  if (overlayBusy) return;
  if (mode === 'record' && rec) return stopRecording();
  if (notch) notch.collapse();
  closeDoneBar(); // 上一次录屏的「已保存」控制条：开始截图就收起，不挡住框选
  overlayBusy = true;
  try {
    if (!(await ensureScreenPerm())) { overlayBusy = false; return; }
    const display = cursorDisplay();
    if (overlayWin && !overlayWin.isDestroyed() && Math.abs((overlayWin.createdScale || 1) - (display.scaleFactor || 1)) > 0.001) {
      // 目标屏幕缩放和覆盖层不一样（例如笔记本 150% + 外接屏 100%）：在目标屏上重建
      log('overlay rebuild for scale', overlayWin.createdScale, '->', display.scaleFactor);
      const old = overlayWin; overlayWin = null; try { old.destroy(); } catch {}
    }
    if (!overlayWin || overlayWin.isDestroyed()) createOverlay(display);
    if (present) await present.hideForCapture(); // 截图里不要鼠标光圈 / 聚光灯
    const t0 = Date.now();
    const tc = Date.now();
    const [cap] = await Promise.all([
      captureDisplay(display, { withWindows: settings.get().capture.windowDetect }),
      overlayReady,
    ]);
    if (process.env.HOPSNAP_DEBUG) console.log('grab took', Date.now() - tc, 'ms');
    const cursor = screen.getCursorScreenPoint();
    overlaySession = { display, mode };
    const b = display.bounds;
    overlayWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    const painted = new Promise((res) => { ipcMain.once('overlay:painted', (_e, info) => res(info)); setTimeout(() => res({ ok: true, timeout: true }), 1500); });
    overlayWin.webContents.send('overlay:start', {
      mode,
      display: cap.display,
      image: cap.image,
      windows: cap.windows,
      cursor: { x: cursor.x - b.x, y: cursor.y - b.y },
      opts: {
        magnifier: settings.get().capture.magnifier,
        record: settings.get().record,
        present: { camera: !!(settings.get().present || {}).camera },
        platform: process.platform,
      },
    });
    const pinfo = await painted;
    if (pinfo && pinfo.ok === false) throw new Error(t('截图画面加载失败：') + (pinfo.error || ''));
    if (process.env.HOPSNAP_DEBUG) console.log('capture ready in', Date.now() - t0, 'ms', cap.image.kind, cap.image.width, cap.image.height, 'windows', cap.windows.length);
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    if (!isWin) overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    overlayWin.show();
    if (isMac) { overlayWin.setKiosk(true); try { app.focus({ steal: true }); } catch {} }
    try { overlayWin.moveTop(); } catch {}
    overlayWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    // 再核对一次：窗口没盖满目标屏幕时纠正
    const got = overlayWin.getBounds();
    if (got.x !== b.x || got.y !== b.y || got.width !== b.width || got.height !== b.height) { log('overlay bounds mismatch', got, b); overlayWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); }
    overlayWin.focus();
    overlayWin.webContents.focus();
    // 如果系统没把焦点给覆盖层（例如用鼠标侧键触发），临时接管 Esc / Enter / Ctrl+C
    setTimeout(() => { if (overlayBusy && overlayWin && !overlayWin.isDestroyed() && !overlayWin.isFocused()) { holdEsc(); holdKeys(); } }, 250);
  } catch (e) {
    try { if (overlayWin && !overlayWin.isDestroyed()) { overlayWin.hide(); if (isMac) overlayWin.setKiosk(false); } } catch {}
    overlayBusy = false; overlaySession = null; releaseEsc();
    if (present) present.restoreAfterCapture();
    reportError(t('截图失败'), e);
  }
}

let overlayHiding = false;
async function hideOverlay() {
  overlayHiding = true;
  releaseEsc();
  if (!overlayWin || overlayWin.isDestroyed()) { overlayBusy = false; overlayHiding = false; if (present) present.restoreAfterCapture(); return; }
  const cleared = new Promise((res) => { ipcMain.once('overlay:cleared', res); setTimeout(res, 300); });
  overlayWin.webContents.send('overlay:reset');
  await cleared;
  if (isMac) overlayWin.setKiosk(false);
  overlayWin.hide();
  overlayBusy = false;
  overlaySession = null;
  overlayHiding = false;
  releaseEsc(); // 关闭过程中失焦可能又接管了按键，这里再释放一次
  if (present) present.restoreAfterCapture();
}

ipcMain.on('overlay:loaded', () => {});
ipcMain.on('overlay:cancel', () => hideOverlay());

ipcMain.handle('overlay:finish', async (_e, payload) => {
  // payload: { action: 'copy'|'save'|'pin', rgba: ArrayBuffer, width, height, rect: {x,y,w,h} (覆盖层局部 CSS 坐标) }
  // PNG 在主进程编码：渲染进程的 canvas.toBlob 在没有显卡加速时会卡约 1 秒
  let png;
  if (payload.rgba) {
    const src = Buffer.from(payload.rgba);
    const bgra = Buffer.allocUnsafe(src.length);
    for (let i = 0; i < src.length; i += 4) { bgra[i] = src[i + 2]; bgra[i + 1] = src[i + 1]; bgra[i + 2] = src[i]; bgra[i + 3] = 255; }
    png = nativeImage.createFromBitmap(bgra, { width: payload.width, height: payload.height, scaleFactor: 1 }).toPNG();
  } else png = Buffer.from(payload.png);
  const display = overlaySession && overlaySession.display;
  const s = settings.get().capture;
  let failed = false;
  try {
    if (payload.action === 'save') {
      const { ext } = imageBuffer(png);
      overlayWin.inDialog = true;
      overlayWin.setAlwaysOnTop(false);
      if (isMac) overlayWin.setKiosk(false);
      releaseEsc();
      const dir = ensureDir(s.saveDir);
      let r;
      try {
        r = await dialog.showSaveDialog(overlayWin, {
          defaultPath: uniquePath(dir, `Hopsnap_${stamp()}`, ext),
          filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPG', extensions: ['jpg', 'jpeg'] }],
        });
      } finally { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.inDialog = false; }
      if (r.canceled || !r.filePath) {
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.setAlwaysOnTop(true, 'screen-saver');
          if (isMac) overlayWin.setKiosk(true);
          overlayWin.focus();
        }
        return { ok: false };
      }
      const outExt = path.extname(r.filePath).toLowerCase();
      const out = (outExt === '.jpg' || outExt === '.jpeg') ? nativeImage.createFromBuffer(png).toJPEG(s.jpgQuality || 92) : png;
      const saved = await safeWrite(r.filePath, out);
      captureSound();
      await safeClip(png); // 已经保存成文件，复制失败不打扰
      setTimeout(() => addHistory(png), 350);
      await hideOverlay();
      if (saved.ok) notify(t('截图已保存'), saved.file, () => shell.showItemInFolder(saved.file));
      else reportError(t('保存失败'), t('无法写入 {file}\n{err}\n\n截图已复制到剪贴板，可以直接粘贴。', { file: r.filePath, err: saved.error }));
      return { ok: true };
    }
    captureSound();
    if (payload.action === 'pin' && display) {
      await safeClip(png);
    } else await copyOrWarn(png);
    // 历史和自动保存等覆盖层关掉以后再写，不拖慢关闭
    setTimeout(() => { addHistory(png); autoSaveShot(png); }, 350);
    if (payload.action === 'pin' && display) {
      const b = display.bounds;
      createPin(png, { x: b.x + payload.rect.x, y: b.y + payload.rect.y, width: payload.rect.w, height: payload.rect.h });
    }
    return { ok: true };
  } catch (e) {
    failed = true;
    reportError(t('截图输出失败'), e);
    return { ok: false };
  } finally {
    if (overlayBusy && (payload.action !== 'save' || failed)) await hideOverlay();
  }
});

ipcMain.on('overlay:copy-text', (_e, text) => { clip.writeText(text); });

ipcMain.on('overlay:record', async (_e, req) => {
  // req: { rect: {x,y,w,h}, format, systemAudio, mic }
  const display = overlaySession && overlaySession.display;
  await hideOverlay();
  if (!display) return;
  // 记住录制选项
  // 区域录屏的格式单独记住，不影响「默认格式」（全屏录屏用默认格式）
  const QUALS = ['source', '2160', '1440', '1080', '720'];
  const keep = {};
  if (QUALS.includes(String(req.quality))) keep.quality = String(req.quality);
  if ([24, 30, 60].includes(Number(req.fps))) keep.fps = Number(req.fps);
  settings.set({ record: { regionFormat: req.format === 'gif' ? 'gif' : 'mp4', ...keep, ...(req.format === 'gif' ? {} : { systemAudio: !!req.systemAudio, mic: !!req.mic }) } });
  if ('camera' in req) settings.set({ present: { camera: !!req.camera } });
  startRecording(display, req.rect, req);
});

// 全屏截图直接进剪贴板
async function captureFullToClipboard() {
  if (notch) notch.collapse();
  closeDoneBar();
  try {
    if (!(await ensureScreenPerm())) return;
    const display = cursorDisplay();
    if (present) await present.hideForCapture();
    let cap;
    try { cap = await captureDisplay(display, { withWindows: false }); } finally { if (present && !overlayBusy) present.restoreAfterCapture(); }
    let png;
    if (cap.image.kind === 'png') png = cap.image.data;
    else {
      // RGBA -> BGRA 供 nativeImage
      const src = cap.image.data;
      const bgra = Buffer.allocUnsafe(src.length);
      for (let i = 0; i < src.length; i += 4) { bgra[i] = src[i + 2]; bgra[i + 1] = src[i + 1]; bgra[i + 2] = src[i]; bgra[i + 3] = 255; }
      png = nativeImage.createFromBitmap(bgra, { width: cap.image.width, height: cap.image.height, scaleFactor: 1 }).toPNG();
    }
    addHistory(png);
    const copied = await copyOrWarn(png);
    autoSaveShot(png);
    captureSound();
    if (copied) notify(t('全屏截图已复制到剪贴板'), `${cap.image.width} × ${cap.image.height}`);
  } catch (e) { reportError(t('截图失败'), e); }
}

// ---------------------------------------------------------------- 贴图
function createPin(png, bounds) {
  const img = nativeImage.createFromBuffer(png);
  const size = img.getSize();
  let w = Math.round(bounds.width), h = Math.round(bounds.height);
  if (!w || !h) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const sf = d.scaleFactor || 1;
    w = Math.round(size.width / sf); h = Math.round(size.height / sf);
    const maxW = d.workArea.width * 0.8, maxH = d.workArea.height * 0.8;
    const k = Math.min(1, maxW / w, maxH / h);
    w = Math.round(w * k); h = Math.round(h * k);
    bounds = { x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: Math.round(d.workArea.y + (d.workArea.height - h) / 2) };
  }
  const win = new BrowserWindow({
    x: Math.round(bounds.x), y: Math.round(bounds.y), width: w, height: h,
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    minimizable: false, maximizable: false, fullscreenable: false, show: false, backgroundColor: '#ffffff',
    useContentSize: true, enableLargerThanScreen: true, roundedCorners: false,
    type: isWin ? 'toolbar' : undefined,
    webPreferences: { preload: R('preload.js'), spellcheck: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.pinData = { png, aspect: w / h, baseW: w, baseH: h };
  win.loadFile(R('renderer', 'pin.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('pin:image', `data:image/png;base64,${png.toString('base64')}`, size);
    win.showInactive ? win.show() : win.show();
  });
  win.on('closed', () => pins.delete(win));
  pins.add(win);
  return win;
}
function pinFromEvent(e) { return BrowserWindow.fromWebContents(e.sender); }
ipcMain.on('pin:move', (e, dx, dy) => {
  const w = pinFromEvent(e); if (!w) return;
  const [x, y] = w.getPosition(); w.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('pin:zoom', (e, factor, cx, cy) => {
  const w = pinFromEvent(e); if (!w || !w.pinData) return;
  const b = w.getBounds();
  const nw = Math.max(40, Math.min(8000, Math.round(b.width * factor)));
  const nh = Math.max(20, Math.round(nw / w.pinData.aspect));
  const k = nw / b.width;
  w.setBounds({ x: Math.round(b.x + cx - cx * k), y: Math.round(b.y + cy - cy * k), width: nw, height: nh });
  e.sender.send('pin:scale', Math.round((nw / w.pinData.baseW) * 100));
});
ipcMain.on('pin:close', (e) => { const w = pinFromEvent(e); if (w) w.close(); });
ipcMain.on('pin:menu', (e) => {
  const w = pinFromEvent(e); if (!w) return;
  const op = (v) => () => w.setOpacity(v);
  Menu.buildFromTemplate([
    { label: t('复制'), click: () => copyOrWarn(w.pinData.png) },
    { label: t('另存为…'), click: async () => {
      const r = await dialog.showSaveDialog(w, { defaultPath: uniquePath(ensureDir(settings.get().capture.saveDir), `Hopsnap_${stamp()}`, 'png') });
      if (!r.canceled && r.filePath) { const saved = await safeWrite(r.filePath, w.pinData.png, false); if (!saved.ok) reportError(t('保存失败'), t('无法写入 {file}\n{err}', { file: r.filePath, err: saved.error })); }
    } },
    { label: t('原始大小'), click: () => { const b = w.getBounds(); w.setBounds({ x: b.x, y: b.y, width: w.pinData.baseW, height: w.pinData.baseH }); e.sender.send('pin:scale', 100); } },
    { label: t('透明度'), submenu: [
      { label: '100%', click: op(1) }, { label: '80%', click: op(0.8) }, { label: '60%', click: op(0.6) }, { label: '40%', click: op(0.4) },
    ] },
    { label: t('置顶'), type: 'checkbox', checked: w.isAlwaysOnTop(), click: (m) => w.setAlwaysOnTop(m.checked, 'floating') },
    { type: 'separator' },
    { label: t('关闭贴图'), click: () => w.close() },
    { label: t('关闭全部贴图'), click: () => [...pins].forEach((p) => p.close()) },
  ]).popup({ window: w });
});

async function pinClipboard() {
  const png = await clip.readImagePng();
  if (!png) { notify(t('剪贴板里没有图片'), t('先截图或复制一张图片，再按贴图快捷键')); return; }
  createPin(png, { x: 0, y: 0, width: 0, height: 0 });
}

// ---------------------------------------------------------------- 设置窗口
function openSettings(tab = 'general', re = null) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:tab', tab);
    settingsWin.show(); settingsWin.focus(); return;
  }
  // Mac「透明玻璃」：创建时就是透明窗口 + 系统毛玻璃（见 rebuildSettings 上面的说明）
  const glass = glassWinWanted();
  const win = settingsWin = new BrowserWindow({
    ...(re && re.bounds ? re.bounds : { width: 980, height: 680 }),
    minWidth: 820, minHeight: 540, show: false, title: t('Hopsnap 设置'),
    icon: logoFile('icon.png'), autoHideMenuBar: true, backgroundColor: glass ? '#00000000' : themeBg(),
    ...(glass ? { transparent: true, hasShadow: true, ...(isMac ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}) } : {}),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { color: themeBg(), symbolColor: themeDark() ? '#B9C6BE' : '#5C6660', height: 36 } }),
    webPreferences: { preload: R('preload.js'), spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.glassBuilt = glass;
  win.setMenu(null);
  styleSettingsWin(win);
  const query = themeQuery(tab);
  if (re) { if (re.scroll) query.scroll = String(re.scroll); if (re.toast) query.toast = 'theme'; }
  win.loadFile(R('renderer', 'settings.html'), { query });
  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return; shown = true;
    if (re && re.maximized) win.maximize();
    if (!re || re.visible !== false) win.show();
    if (re && re.fullScreen) win.setFullScreen(true);
    // 新窗口出来以后再关旧窗口，不闪
    if (re && re.replace && !re.replace.isDestroyed()) { try { re.replace.destroy(); } catch {} }
    if (re && re.onReveal) re.onReveal();
  };
  win.once('ready-to-show', reveal);
  if (re) setTimeout(reveal, 4000);   // 万一 ready-to-show 没来，也不能让旧窗口一直留着
  win.on('closed', () => {
    // 新窗口还没显示就被关掉：旧窗口也一起关，结束这次重建
    if (re && re.onReveal && !shown) { shown = true; if (re.replace && !re.replace.isDestroyed()) { try { re.replace.destroy(); } catch {} } re.onReveal(); }
    if (win.replaced) return;   // 换主题重建：新窗口接手，不恢复快捷键、不隐藏 Dock 图标
    if (settingsWin === win) settingsWin = null;
    hotkeys.setPaused(false); applyHotkeys(); if (isMac) app.dock && app.dock.hide();
  });
  if (isMac && app.dock) { app.dock.show(); try { app.dock.setIcon(nativeImage.createFromPath(logoFile('mac.png'))); } catch {} }
}

ipcMain.handle('settings:get', () => ({ settings: settings.get(), status: hotkeyStatus, platform: process.platform, version: app.getVersion(),
  theme: themeName(), material: themeName() === 'glass' && canMaterial(), canMaterial: canMaterial() }));
ipcMain.handle('settings:set', (_e, patch) => {
  const before = JSON.stringify(settings.get().hotkeys);
  // 在设置里改「默认格式」后，区域录屏也跟着用新的默认格式
  if (patch && patch.record && 'format' in patch.record && !('regionFormat' in patch.record)) patch = { ...patch, record: { ...patch.record, regionFormat: '' } };
  if (patch && patch.general && 'language' in patch.general) {
    const v = patch.general.language;
    setTimeout(() => setLanguage(v), 30); // 先把结果返回给设置页，再刷新界面
  }
  const s = settings.set(patch);
  if (patch.general && 'appearance' in patch.general) { applyAppearance(); applyTheme(); }
  if (patch.general && 'launchAtLogin' in patch.general) {
    setLaunchAtLogin(!!patch.general.launchAtLogin);
  }
  if (JSON.stringify(s.hotkeys) !== before) applyHotkeys();
  if (patch && patch.fileTools && fileTools) fileTools.syncShiftDrag();
  if (patch && patch.present && present) present.applySettings();
  if (patch && patch.record && Object.prototype.hasOwnProperty.call(patch.record, 'demoCaptureBar')) syncDemoBarCapture();
  return { settings: s, status: hotkeyStatus };
});
ipcMain.handle('settings:reset', async () => {
  const hadLogo = logoName();
  const before = i18n.getLang();
  settings.reset(); setLaunchAtLogin(false); applyHotkeys();
  if (fileTools) fileTools.syncShiftDrag();
  if (hadLogo !== logoName()) await applyLogo({ system: true });
  applyAppearance(); applyTheme();
  if (present) present.applySettings();
  syncDemoBarCapture();
  if (applyLanguage() !== before) setTimeout(refreshLanguageUi, 30);
  return { settings: settings.get(), status: hotkeyStatus };
});
ipcMain.handle('settings:logo', async (_e, name) => {
  if (!LOGOS.includes(name)) return { error: 'unknown logo' };
  settings.set({ general: { logo: name } });
  const r = await applyLogo({ system: true });
  if (themeSetting() === 'auto') applyTheme();
  return { ...r, settings: settings.get(), platform: process.platform, packaged: app.isPackaged };
});
ipcMain.handle('settings:theme', (_e, name) => {
  if (name !== 'auto' && !THEMES.includes(name)) return { error: 'unknown theme' };
  settings.set({ general: { theme: name } });
  const theme = applyTheme();
  // rebuilding：设置窗口要重建（Mac 切入 / 切出透明玻璃），旧窗口别再自己换样式（会出现重影），等新窗口
  return { settings: settings.get(), theme, material: theme === 'glass' && canMaterial(), rebuilding: !!settingsRebuild };
});
function setLaunchAtLogin(on) {
  try {
    // Windows 注册表启动项名称固定为 Hopsnap（卸载程序按这个名字清理）
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, ...(isWin ? { name: 'Hopsnap' } : {}) });
    if (isWin && !on) app.setLoginItemSettings({ openAtLogin: false }); // 清理旧版本用默认名称写入的启动项
  } catch (e) { log('login item failed', e); }
}
ipcMain.handle('hotkeys:pause', (_e, v) => { hotkeys.setPaused(v); if (!v) applyHotkeys(); return hotkeyStatus; });
ipcMain.handle('dialog:pickDir', async (e, current) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
// 只允许打开设置里配置的保存文件夹（不接受任意路径）
ipcMain.handle('shell:openPath', (_e, p) => {
  const st = settings.get();
  const allowed = [st.capture.saveDir, st.record.saveDir].map((d) => path.resolve(d));
  if (typeof p !== 'string' || !allowed.includes(path.resolve(p))) return 'not allowed';
  return shell.openPath(ensureDir(p));
});
ipcMain.handle('history:list', () => listHistory(true));
ipcMain.handle('history:copy', async (_e, id) => {
  try { return { ok: await safeClip(historyPng(id)) }; } catch (e) { log('history copy failed', e); return { ok: false, error: e.message }; }
});
ipcMain.handle('history:pin', (_e, id) => {
  try { createPin(historyPng(id), { x: 0, y: 0, width: 0, height: 0 }); return { ok: true }; } catch (e) { log('history pin failed', e); return { ok: false, error: e.message }; }
});
ipcMain.handle('history:delete', (_e, id) => { removeHistory(String(id).replace(/[^0-9]/g, '')); return true; });
ipcMain.handle('history:clear', () => { for (const it of listHistory(false)) removeHistory(it.id); return true; });
ipcMain.handle('history:save', async (e, id) => {
  try {
    const png = historyPng(id);
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: uniquePath(ensureDir(settings.get().capture.saveDir), `Hopsnap_${stamp()}`, 'png') });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const saved = await safeWrite(r.filePath, png, false);
    return saved.ok ? { ok: true, file: saved.file } : { ok: false, error: saved.error };
  } catch (err) { log('history save failed', err); return { ok: false, error: err.message }; }
});
ipcMain.handle('app:action', async (_e, name) => {
  if (name === 'capture') setTimeout(() => startCapture('shot'), 250);
  if (name === 'record') setTimeout(() => startCapture('record'), 250);
  if (name === 'recordFull') setTimeout(() => startFullRecording(), 250);
  // 先请求一次，保证 Hopsnap 出现在系统设置的列表里，再打开对应页面
  if (name === 'macScreenPerm') { if (isMac && !macScreenOk()) await requestScreenAccess(); shell.openExternal(MAC_PANES.screen); }
  if (name === 'macPermState') return macPermState();
  if (name === 'macPermRepair') return isMac ? repairMacPerms(settingsWin) : null;
  if (name === 'macPermRepairQuiet') return isMac ? repairMacPerms(permWin, true) : null;
  if (name === 'macPermHelper') { openPermWindow(); return true; }
  if (name === 'checkUpdate') return checkUpdate(true);
  if (name === 'openReleases') { if (updateInfo && updateInfo.url) shell.openExternal(updateInfo.url); else if (update.PAGE) shell.openExternal(update.PAGE); return true; }
  if (name === 'macPermLater') { settings.set({ general: { permAutoOpen: false } }); closePermWindow(); return true; }
  if (name === 'macRelaunch') { relaunchApp(); return true; }
  if (name === 'macDiag') { const d = await macDiag(); require('electron').clipboard.writeText(JSON.stringify(d, null, 2)); return d; }
  if (name === 'openLogs') { log('open logs'); shell.showItemInFolder(logFile || path.join(app.getPath('userData'), 'logs', 'hopsnap.log')); }
  if (name === 'openSource') { shell.openExternal('https://github.com/chaichungsang/BillyShot'); }
  if (name === 'macAccessPerm') { if (isMac && !hotkeys.axTrusted()) { try { systemPreferences.isTrustedAccessibilityClient(true); } catch {} } shell.openExternal(MAC_PANES.accessibility); }
  if (name === 'macCameraPerm') shell.openExternal(MAC_PANES.camera);
  if (name === 'cameraPreview') return toggleCamera(!(present && present.camOn())).then(() => presentState());
  if (name === 'spotToggle') { if (present) present.setSpot(!present.isSpot()); return presentState(); }
  if (name === 'presentState') return presentState();
  return true;
});

// ---------------------------------------------------------------- 录屏
// Windows 10 2004 (19041) 起才支持“窗口不进入录屏画面”；更老的系统会把窗口录成黑块
const winBuild = isWin ? parseInt((os.release().split('.')[2]) || '0', 10) : 0;
const canExcludeFromCapture = !isWin || winBuild >= 19041;
function protect(win) { if (canExcludeFromCapture) { try { win.setContentProtection(true); } catch {} } }

async function startFullRecording() {
  if (rec) return stopRecording();
  if (overlayBusy) await hideOverlay();
  const display = cursorDisplay();
  const r = settings.get().record;
  startRecording(display, { x: 0, y: 0, w: display.bounds.width, h: display.bounds.height, full: true },
    { format: r.format, systemAudio: r.systemAudio, mic: r.mic, camera: !!(settings.get().present || {}).camera });
}

async function getScreenSourceId(display) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  let s = sources.find((x) => x.display_id === String(display.id)) ||
          sources.find((x) => x.id.startsWith(`screen:${display.id}:`));
  if (!s && sources.length === 1) s = sources[0];
  if (!s && sources.length > 1) {
    // 按显示器顺序对应（display_id 缺失时的兜底）
    const all = screen.getAllDisplays();
    const idx = all.findIndex((d) => d.id === display.id);
    s = sources[idx] || sources[0];
    log('screen source fallback by index', idx, sources.map((x) => [x.id, x.display_id]));
  }
  return s ? s.id : null;
}

function videoSaveDir() {
  const want = settings.get().record.saveDir;
  if (writableDir(want)) return { dir: want, fallback: false };
  const alt = fallbackDir();
  return { dir: alt, fallback: true };
}

async function startRecording(display, rect, req) {
  if (rec) return;
  // 先同步占位，防止快速连按开出两个录制
  rec = { starting: true, display, stopping: false, extraWarn: [], camDone: true };
  const cur = rec;
  if (fileTools) fileTools.setRecording(true);
  closeDoneBar();
  buildTrayMenu();
  try {
    if (!(await ensureScreenPerm())) { rec = null; if (fileTools) fileTools.setRecording(false); buildTrayMenu(); return; }
    // Ears / pill go up before the capture stream exists, so they are on screen within 1s
    // and already excluded from it. updateRec fills in the real full-screen flag below.
    if (isMac && notch && !cur.stopping) {
      const b0 = display.bounds;
      const fullGuess = !!(rect && (rect.full || (rect.w >= b0.width - 2 && rect.h >= b0.height - 2)));
      notch.beginRec({ display, full: fullGuess, quality: (settings.get().record || {}).quality });
    }
    const r = settings.get().record;
    const format = req.format === 'gif' ? 'gif' : 'mp4';
    const sourceId = await getScreenSourceId(display);
    if (rec !== cur) return;
    if (!sourceId) throw new Error(t('找不到屏幕源'));
    if (cur.stopping) { rec = null; if (fileTools) fileTools.setRecording(false); if (notch) notch.endRec(); buildTrayMenu(); return; }
    const b = display.bounds;
    // 录制区域至少 32×32
    rect = { ...rect, w: Math.max(32, Math.round(rect.w)), h: Math.max(32, Math.round(rect.h)), x: Math.round(rect.x), y: Math.round(rect.y) };
    rect.x = Math.max(0, Math.min(rect.x, b.width - rect.w)); rect.y = Math.max(0, Math.min(rect.y, b.height - rect.h));
    const abs = { x: b.x + rect.x, y: b.y + rect.y, width: rect.w, height: rect.h };
    const { dir, fallback } = videoSaveDir();
    Object.assign(cur, {
      starting: false, rect, format, file: uniqueRecPath(dir, `Hopsnap_${stamp()}`, format === 'gif' ? 'gif' : 'mp4'),
      fd: null, bytes: 0, writeErr: null, fallback, startedAt: 0, paused: false, frameWin: null, barWin: null, recWin: null,
      abs, extraWarn: [], camDone: true,
    });
    log('record start', { format, rect, file: cur.file, fallback, winBuild });

    // 录制区域边框（画在区域外侧，不进入画面）
    const full = !!rect.full || (rect.w >= b.width - 2 && rect.h >= b.height - 2);
    cur.full = full;
    if (isMac && notch) notch.updateRec({ full, quality: r.quality, display });
    const pad = 4;
    cur.frameWin = new BrowserWindow({
      x: abs.x - pad, y: abs.y - pad, width: abs.width + pad * 2, height: abs.height + pad * 2,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, show: false,
      type: isMac ? 'panel' : (isWin ? 'toolbar' : undefined), roundedCorners: false,
      webPreferences: { preload: R('preload.js'), autoplayPolicy: 'no-user-gesture-required' },
    });
    cur.frameWin.setIgnoreMouseEvents(true);
    protect(cur.frameWin);
    cur.frameWin.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) cur.frameWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    const snd = settings.get().sound || {};
    cur.frameWin.loadFile(R('renderer', 'recframe.html'), { query: { full: full ? '1' : '0', countdown: String(r.countdown || 0), tick: snd.countdown ? '1' : '0', vol: String((snd.volume ?? 70) / 100) } });
    cur.frameWin.once('ready-to-show', () => { if (rec === cur && cur.frameWin && !cur.frameWin.isDestroyed()) cur.frameWin.showInactive(); });

    // Mac 录制状态在刘海或胶囊上。控制条仍创建，录的时候藏着，停止后拿出来走原来的保存 / 预览。
    // Windows（notch 为空）照旧马上显示控制条。
    const macHud = isMac && !!notch;
    const barW = 430, barH = 46;
    const wa = display.workArea || b; // 工作区 = 屏幕去掉任务栏
    let bx = Math.round(abs.x + abs.width / 2 - barW / 2), by = abs.y + abs.height + pad + 8;
    if (by + barH > wa.y + wa.height) by = abs.y - pad - 8 - barH;
    if (by < wa.y) by = wa.y + wa.height - barH - 24;
    by = Math.max(wa.y + 4, Math.min(by, wa.y + wa.height - barH - 4));
    bx = Math.max(wa.x + 8, Math.min(bx, wa.x + wa.width - barW - 8));
    cur.barPos = { x: bx, y: by, w: barW, h: barH };
    cur.barWin = new BrowserWindow({
      x: bx, y: by, width: barW, height: barH, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: true,
      minimizable: false, maximizable: false, fullscreenable: false, roundedCorners: false,
      type: isWin ? 'toolbar' : undefined,
      webPreferences: { preload: R('preload.js') },
    });
    protect(cur.barWin);
    syncDemoBarCapture();
    cur.barWin.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) cur.barWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // 演示层（光圈 / 波纹）跟着录屏出现；摄像头圆窗放进录制区域
    const absArea = { x: abs.x, y: abs.y, width: abs.width, height: abs.height };
    present.setRecording({ display, area: absArea });
    if (req.camera) {
      cur.camDone = false;
      // macOS 第一次用摄像头会弹授权框：最多等 5 秒，没答复就先开始录制
      const WAIT = t('摄像头还在等待授权，先开始录制');
      const camP = present.cameraForRecording(display, absArea);
      // 真正的结果晚到时也要更新控制条（去掉「等待授权」，换成实际原因）
      const settleWait = (warning) => {
        if (rec !== cur || cur.stopping) return;
        const i = cur.extraWarn.indexOf(WAIT); if (i >= 0) cur.extraWarn.splice(i, 1);
        if (warning && !cur.extraWarn.includes(warning)) cur.extraWarn.push(warning);
        if (i >= 0 || warning) sendBarWarn(cur);
        syncBarFx();
      };
      camP.then((r) => settleWait(r && r.warning), () => settleWait(''));
      Promise.race([camP, sleep(5000).then(() => ({ ok: false, warning: WAIT, timeout: true }))]).then((r) => {
        if (rec !== cur) return;
        if (r && r.timeout) addRecWarn(r.warning);
        cur.camDone = true; syncBarFx(); maybeGo();
      }).catch((e) => { log('camera for recording failed', e); if (rec === cur) { cur.camDone = true; maybeGo(); } });
    }
    if (cur.barWin) {
      cur.barWin.loadFile(R('renderer', 'recbar.html'), { query: { format, mic: req.mic ? '1' : '0', sys: req.systemAudio ? '1' : '0', cam: req.camera ? '1' : '0', fx: present.recFx() ? '1' : '0', spot: present.isSpot() ? '1' : '0' } });
      cur.barWin.webContents.once('did-finish-load', () => syncBarFx());
      const hideBar = (full && r.hideBarFull) || macHud;
      cur.barWin.once('ready-to-show', () => { if (rec === cur && cur.barWin && !cur.barWin.isDestroyed() && !hideBar) cur.barWin.showInactive(); });
      if (full && r.hideBarFull && !macHud) notify(t('正在录制全屏'), accelLabel('recordFull') ? t('再按 {k} 停止录制', { k: accelLabel('recordFull') }) : t('用托盘菜单停止录制'));
    } else syncBarFx();

    // 隐藏的录制窗口（负责采集与编码）
    cur.recWin = new BrowserWindow({
      show: !!process.env.HOPSNAP_SHOW_RECORDER, width: 400, height: 300, skipTaskbar: true,
      webPreferences: { preload: R('preload.js'), backgroundThrottling: false },
    });
    cur.recWin.webContents.on('console-message', (e) => { if (process.env.HOPSNAP_DEBUG || /error|fail/i.test(e.message)) log('[recorder]', e.message); });
    cur.recWin.webContents.on('render-process-gone', (_e, d) => {
      log('recorder renderer gone', d);
      if (rec === cur) finishRecording(cur.bytes ? 'ok' : 'error', t('录制进程意外退出'));
    });
    cur.recWin.loadFile(R('renderer', 'recorder.html'));
    const cfg = {
      sourceId, format,
      display: { bounds: b, scaleFactor: display.scaleFactor },
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      quality: r.quality, fps: r.fps, bitrate: r.bitrate,
      systemAudio: !!req.systemAudio, mic: !!req.mic, micDeviceId: r.micDeviceId,
      gifFps: r.gifFps, gifMaxWidth: r.gifMaxWidth,
      countdown: r.countdown || 0,
    };
    cur.recWin.webContents.once('did-finish-load', () => {
      if (rec !== cur) return;
      if (cur.stopping) { finishRecording('cancel'); return; }
      cur.recWin.webContents.send('rec:start', cfg);
    });
  } catch (e) {
    if (rec === cur) { rec.cancelled = true; finishRecording('error', e.message || String(e)); }
    else reportError(t('录屏失败'), e);
  }
}

function recSender(e) { return rec && rec.recWin && !rec.recWin.isDestroyed() && e.sender === rec.recWin.webContents; }
function sendTo(win, ch, ...args) { try { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); } catch {} }
function sessionBar(r) {
  // Save / pause / mic live on the recording bar. The notch only shows the timer.
  return r && r.barWin && !r.barWin.isDestroyed() ? r.barWin : null;
}

ipcMain.on('rec:started', (e, info) => {
  if (!recSender(e)) return;
  rec.startedAt = Date.now();
  rec.info = info;
  // MP4 不可用时会回退为 WebM，扩展名跟着改
  if (info && /webm/.test(info.mimeType || '') && rec.file.endsWith('.mp4') && !rec.fd) {
    rec.file = uniqueRecPath(path.dirname(rec.file), path.basename(rec.file, '.mp4'), 'webm');
  }
  sendTo(rec.frameWin, 'frame:recording');
  // 全屏录制时边框本来就隐藏，直接关掉以免老系统把它录成黑块
  if (rec.full && rec.frameWin && !rec.frameWin.isDestroyed()) { rec.frameWin.destroy(); rec.frameWin = null; }
  if (isMac && notch) notch.updateRec({ full: !!rec.full, quality: (settings.get().record || {}).quality, display: rec.display });
  { const w = [...((info && info.warnings) || []), ...rec.extraWarn]; sendTo(sessionBar(rec), 'recbar:state', { state: 'recording', warnings: w, info: info && { ...info, warnings: w } }); }
  log('recording started', info);
});
function writeRecBytes(buf) {
  if (rec.writeErr) return;
  try {
    if (!rec.fd) rec.fd = fs.openSync(rec.file + PART, 'w');
    fs.writeSync(rec.fd, buf);
    rec.bytes += buf.length;
  } catch (err) {
    // 写入失败：换到备用文件夹重新开始写（之前的内容一并转移）
    log('write chunk failed', rec.file, err.message);
    try {
      const prev = rec.fd ? rec.file + PART : null;
      if (rec.fd) { try { fs.closeSync(rec.fd); } catch {} rec.fd = null; }
      const alt = uniqueRecPath(fallbackDir(), path.parse(rec.file).name, path.extname(rec.file).slice(1));
      const fd = fs.openSync(alt + PART, 'w');
      if (prev) { try { fs.writeSync(fd, fs.readFileSync(prev)); } catch {} unlinkRetry(prev); }
      fs.writeSync(fd, buf);
      rec.fd = fd; rec.file = alt; rec.fallback = true; rec.bytes += buf.length;
    } catch (err2) { rec.writeErr = err2; log('fallback write failed', err2.message); }
  }
}
ipcMain.on('rec:chunk', (e, ab) => { if (recSender(e)) writeRecBytes(Buffer.from(ab)); });
ipcMain.on('rec:progress', (e, p) => {
  if (!recSender(e)) return;
  if (p && p.state === 'ready') { rec.ready = true; maybeGo(); }
  if (p && p.lowFps && !rec.lowFpsNotified) {
    rec.lowFpsNotified = true;
    log('low fps', p.lowFps, 'target', p.targetFps);
    notify(t('录制帧率偏低'), t('实际约 {low} fps（设定 {target} fps）。如果视频卡顿，可以在 设置 → 录屏 调低帧率或分辨率。', { low: p.lowFps, target: p.targetFps }));
  }
  if (p && p.warnings) rec.recWarn = p.warnings; // 录制进程自己的提示（麦克风 / 系统声音），合并显示时要保留
  if (p && rec.extraWarn.length) p = { ...p, warnings: [...(p.warnings || []), ...rec.extraWarn] };
  if (p && typeof p.elapsed === 'number' && isMac && notch && rec && !rec.stopping) notch.setElapsed(p.elapsed);
  sendTo(sessionBar(rec), 'recbar:state', p);
});
// 录制中的附加提示（摄像头打不开、区域太小…）显示在控制条上
function addRecWarn(msg) {
  if (!rec || rec.starting || rec.stopping || !rec.extraWarn || !msg || rec.extraWarn.includes(msg)) return;
  rec.extraWarn.push(msg);
  sendBarWarn(rec);
}
function sendBarWarn(r) {
  if (!r || r.stopping) return; // 正在保存 / 生成 GIF 时不改控制条状态
  sendTo(sessionBar(r), 'recbar:state', { state: r.startedAt ? (r.paused ? 'paused' : 'recording') : 'ready', warnings: [...(r.recWarn || []), ...r.extraWarn] });
}
function syncBarFx() {
  if (!rec || !present) return;
  sendTo(sessionBar(rec), 'recbar:fx', { cam: present.camOn(), spot: present.isSpot(), fx: present.recFx() });
}
function presentState() { return present ? { demo: present.isDemo(), spot: present.isSpot(), cam: present.camOn() } : { demo: false, spot: false, cam: false }; }
function toggleCamera(on) {
  if (!present) return Promise.resolve();
  const p = rec && !rec.starting && !rec.stopping && rec.abs
    ? present.setCamera(on, { display: rec.display, area: { x: rec.abs.x, y: rec.abs.y, width: rec.abs.width, height: rec.abs.height } })
      .then((r) => { if (r && r.warning) addRecWarn(r.warning); })
    : present.setCamera(on);
  // 不管成功与否都刷新托盘勾选和控制条按钮（失败时原生勾选框要还原）
  return p.catch((e) => log('toggle camera failed', e)).then(() => { buildTrayMenu(); syncBarFx(); });
}
ipcMain.on('rec:done', (e, info) => { if (recSender(e)) finishRecording(info && info.cancelled ? 'cancel' : 'ok'); });
ipcMain.on('rec:error', (e, msg) => { if (recSender(e)) finishRecording('error', msg); });
ipcMain.on('recbar:action', (e, action) => {
  if (!rec) return;
  if (e && e.sender) {
    const fromBar = rec.barWin && !rec.barWin.isDestroyed() && e.sender === rec.barWin.webContents;
    const fromNotch = !!(notch && notch.owns(e.sender));
    if (!fromBar && !fromNotch) return;
  }
  if (action === 'stop') return stopRecording();
  if (action === 'cancel') return stopRecording(true);
  if (action === 'pause' || action === 'resume') {
    rec.paused = action === 'pause';
    sendTo(rec.recWin, 'rec:pause', rec.paused);
  }
  if (action === 'mic-on' || action === 'mic-off') sendTo(rec.recWin, 'rec:mic', action === 'mic-on');
  if (action === 'cam-on' || action === 'cam-off') toggleCamera(action === 'cam-on');
  if (action === 'spot-on' || action === 'spot-off') present.setSpot(action === 'spot-on');
  if (action === 'fx-on' || action === 'fx-off') present.setRecFx(action === 'fx-on');
});
ipcMain.on('recbar:drag', (e, dx, dy) => {
  if (notch && notch.owns(e.sender)) return;
  const w = [rec && rec.barWin, doneBar && doneBar.win].find((x) => x && !x.isDestroyed() && x.webContents === e.sender);
  if (!w) return;
  const [x, y] = w.getPosition(); w.setPosition(Math.round(x + dx), Math.round(y + dy));
});
// 保存完成后的控制条：打开文件夹 / 播放 / 关闭
ipcMain.on('recbar:done', (e, action) => {
  if (!doneBar || !doneBar.win || doneBar.win.isDestroyed() || e.sender !== doneBar.win.webContents) return;
  const file = doneBar.file;
  if (action === 'folder' && file) shell.showItemInFolder(file);
  if (action === 'play' && file) shell.openPath(file).then((err) => { if (err) log('open video failed', err); });
  if (process.env.HOPSNAP_TEST) console.log('DONEBAR', action, file || '');
  closeDoneBar();
});
function maybeGo() {
  if (rec && rec.recWin && rec.countdownDone && rec.ready && rec.camDone !== false && !rec.goSent && !rec.stopping) { rec.goSent = true; sendTo(rec.recWin, 'rec:go'); }
}
ipcMain.on('frame:countdown-done', () => {
  if (!rec || rec.starting) return;
  const snd = settings.get().sound || {};
  if (snd.record) {
    // 先播放开始音，结束后再正式开录，避免提示音被录进系统声音
    playSound('rec_start');
    const cur = rec;
    setTimeout(() => { if (rec === cur) { rec.countdownDone = true; maybeGo(); } }, 480);
  } else { rec.countdownDone = true; maybeGo(); }
});

function stopRecording(cancel = false) {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.cancelled = cancel;
  // Ears and the pill go away at the click. The bar (hidden on Mac during the take) comes back for the existing save / preview.
  if (isMac && notch) notch.endRec();
  if (rec.starting) return; // startRecording 会自己收尾
  if (isMac && notch && rec.barWin && !rec.barWin.isDestroyed()) {
    try { if (!rec.barWin.isVisible()) rec.barWin.showInactive(); } catch {}
  }
  sendTo(sessionBar(rec), 'recbar:state', { state: rec.format === 'gif' && !cancel ? 'encoding' : 'stopping' });
  sendTo(rec.recWin, 'rec:stop', cancel);
  // 停止以后不再采集画面：马上收起光圈 / 聚光灯 / 摄像头（GIF 编码可能要好一会儿）
  try { if (present) present.setRecording(null); } catch (e) { log('present end failed', e); }
  // 兜底：编码器无响应时强制结束（已写入的数据保留）
  const cur = rec;
  setTimeout(() => { if (rec === cur) finishRecording(cur.bytes ? 'ok' : 'error', t('录制停止超时')); }, cancel ? 5000 : 180000);
}

let doneBar = null; // 保存中 / 已保存的控制条 { win, file }
function barOutsideRecord(cur) {
  const p = cur && cur.barPos, a = cur && cur.abs;
  if (!p || !a) return false;
  return p.y + p.h <= a.y || p.y >= a.y + a.height || p.x + p.w <= a.x || p.x >= a.x + a.width;
}
function syncDemoBarCapture() {
  // Live barWin can be captured by an external still when the switch is on.
  // Only if it sits outside the recording rect, so the video crop still misses it.
  // A full-screen crop that the bar had to overlap stays protected. frameWin and the present layer are untouched.
  if (!canExcludeFromCapture) return;
  const show = !!((settings.get().record || {}).demoCaptureBar);
  const wins = [];
  if (rec && rec.barWin && !rec.barWin.isDestroyed() && (!show || barOutsideRecord(rec))) wins.push(rec.barWin);
  if (doneBar && doneBar.win && !doneBar.notch && !doneBar.win.isDestroyed()) wins.push(doneBar.win);
  for (const win of wins) { try { win.setContentProtection(!show); } catch {} }
}
function closeDoneBar() {
  const d = doneBar; doneBar = null;
  if (!d || !d.win) return;
  try { if (!d.win.isDestroyed()) d.win.destroy(); } catch {}
}
function finishRecording(status, msg) {
  if (!rec) return;
  const r = rec; rec = null;
  if (fileTools) fileTools.setRecording(false);
  try { if (r.fd) fs.closeSync(r.fd); } catch {}
  r.fd = null;
  for (const w of [r.frameWin, r.recWin]) { try { if (w && !w.isDestroyed()) w.destroy(); } catch {} }
  try { if (present) present.setRecording(null); } catch (e) { log('present end failed', e); }
  buildTrayMenu();
  log('record finish', { status, msg, file: r.file, bytes: r.bytes, cancelled: r.cancelled, writeErr: r.writeErr && r.writeErr.message });
  const partial = status === 'error' && !r.cancelled && r.bytes > 0 && !r.writeErr && r.format !== 'gif';
  const keep = partial || (status === 'ok' && !r.cancelled && r.bytes > 0 && !r.writeErr);
  if (isMac && notch) notch.endRec();
  const bar = r.barWin && !r.barWin.isDestroyed() ? r.barWin : null;
  if (!keep) {
    try { if (bar) bar.destroy(); } catch {}
    try {
      if (r.file) unlinkRetry(r.file + PART);
      if (status === 'error') reportError(t('录屏失败'), msg || t('未知错误'));
      else if (r.writeErr) reportError(t('录屏保存失败'), t('无法写入文件：{msg}', { msg: r.writeErr.message }));
    } catch (e) { reportError(t('录屏收尾出错'), e); }
    return;
  }
  try { if (!partial && (settings.get().sound || {}).record) playSound('rec_stop'); } catch {}
  // 控制条留下来显示「正在保存 → 已保存」（全屏录制时隐藏的控制条也显示出来）
  closeDoneBar();
  if (bar) {
    doneBar = { win: bar, file: null };
    try { if (!bar.isVisible()) bar.showInactive(); } catch {}
    sendTo(bar, 'recbar:state', { state: 'finalizing', pct: 0 });
    syncDemoBarCapture();
  }
  saveRecording(r, partial, msg, bar).catch((e) => { reportError(t('录屏收尾出错'), e); if (doneBar && doneBar.win === bar) closeDoneBar(); });
}

async function saveRecording(r, partial, msg, bar) {
  const tmp = r.file + PART;
  const ext = path.extname(r.file).slice(1);
  let durationMs = 0;
  // MP4：把录制时的分段格式整理成普通 MP4（资源管理器能显示时长 / 缩略图，播放器能拖进度条，剪辑软件能导入）
  if (ext === 'mp4' && !(process.env.HOPSNAP_TEST && process.env.HOPSNAP_NO_FINALIZE)) {
    try {
      const t0 = Date.now();
      const res = await finalizeMp4(tmp, (p) => sendTo(bar, 'recbar:state', { state: 'finalizing', pct: p }));
      if (res.durationSec) durationMs = Math.round(res.durationSec * 1000);
      log('mp4 finalize', { ...res, ms: Date.now() - t0 });
    } catch (e) { log('mp4 finalize failed', e && e.message); } // 整理失败：原样保留（还是能播放的分段 MP4）
  }
  let file = r.file;
  if (fs.existsSync(file)) file = uniquePath(path.dirname(file), path.parse(file).name, ext);
  if (!(await renameRetry(tmp, file))) file = tmp; // 改名失败就保留 .part 名字，至少文件还在
  r.file = file;
  let bytes = r.bytes;
  try { bytes = fs.statSync(file).size; } catch {}
  if (partial) {
    notify(t('录屏中断，已保存录到的部分'), t('{name}（{key}）', { name: path.basename(file), key: msg || t('编码器出错') }), () => shell.showItemInFolder(file));
    if (process.env.HOPSNAP_TEST) console.log('REC_PARTIAL_KEPT', file);
  } else {
    const where = r.fallback ? t('（视频文件夹被系统保护，已改存到 {dir}）', { dir: path.dirname(file) }) : t('（点击打开文件夹）');
    notify(r.format === 'gif' ? t('GIF 录制完成') : t('录屏完成'), `${path.basename(file)}${where}`, () => shell.showItemInFolder(file));
    if (r.fallback && !process.env.HOPSNAP_TEST) {
      dialog.showMessageBox({ type: 'info', message: t('录屏已保存'), detail: t('原保存位置无法写入（可能被 Windows「受控文件夹访问」或杀毒软件拦截），文件已保存到：\n{file}\n\n可以在 设置 → 录屏 → 保存位置 换一个文件夹。', { file }), buttons: [t('打开文件夹'), t('好')] })
        .then((x) => { if (x.response === 0) shell.showItemInFolder(file); }).catch(() => {});
    }
  }
  if (process.env.HOPSNAP_TEST) console.log('REC_SAVED', JSON.stringify({ file, bytes, durationMs, partial }));
  if (bar && doneBar && doneBar.win === bar && !bar.isDestroyed()) {
    doneBar.file = file;
    sendTo(bar, 'recbar:state', { state: 'done', name: path.basename(file), bytes, duration: durationMs, partial, gif: r.format === 'gif' });
  }
}

// 启动时：上次录到一半程序被关掉 / 电脑断电，留下的 .part 整理好改回正式文件名
async function recoverRecordings() {
  const dirs = [...new Set([settings.get().record.saveDir, path.join(app.getPath('home'), 'Hopsnap'), path.join(app.getPath('home'), 'BillyShot')].map((d) => path.resolve(d)).filter((d) => fs.existsSync(d)))];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /\.(mp4|webm|gif)\.part$/i.test(n)); } catch { continue; }
    for (const n of names) {
      const full = path.join(dir, n);
      if (rec && rec.file && path.resolve(rec.file + PART) === full) continue; // 正在录的
      try {
        if (!fs.statSync(full).size) { unlinkRetry(full); continue; }
        const finalName = n.slice(0, -PART.length), ext = path.extname(finalName).slice(1);
        if (ext.toLowerCase() === 'mp4') { try { log('recover finalize', full, await finalizeMp4(full)); } catch (e) { log('recover finalize failed', full, e.message); } }
        const to = uniquePath(dir, path.parse(finalName).name, ext); // 只要求成品名没被占用（.part 就是它自己）
        if (await renameRetry(full, to)) {
          log('recovered recording', to);
          notify(t('上次的录屏没有正常结束'), t('已恢复录到的部分：{name}', { name: path.basename(to) }), () => shell.showItemInFolder(to));
        }
      } catch (e) { log('recover failed', full, e.message); }
    }
  }
}

// 系统声音：getDisplayMedia + loopback（Windows 原生支持；macOS 13+ 通过特性开关）
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const want = rec && rec.display ? String(rec.display.id) : '';
      const src = sources.find((s) => s.display_id === want) || sources[0];
      callback({ video: src, audio: 'loopback' });
    } catch (e) { console.error(e); callback({}); }
  }, { useSystemPicker: false });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler(() => true);
}

// ---------------------------------------------------------------- 测试钩子（仅自动化测试使用）
function setupTestHooks() {
  // 只在开发环境（未打包）且显式设置环境变量时启用，正式安装包里永远不会运行
  if (!process.env.HOPSNAP_TEST || app.isPackaged) return;
  const file = process.env.HOPSNAP_TEST_CMD || path.join(os.tmpdir(), 'hopsnap-cmd.json');
  setInterval(async () => {
    if (!fs.existsSync(file)) return;
    let cmd; try { cmd = JSON.parse(fs.readFileSync(file, 'utf8')); fs.unlinkSync(file); } catch { return; }
    console.log('TEST CMD', cmd.cmd);
    try {
      if (cmd.cmd === 'capture') startCapture('shot');
      if (cmd.cmd === 'captureRecord') startCapture('record');
      if (cmd.cmd === 'captureFull') captureFullToClipboard();
      if (cmd.cmd === 'recordFull') startFullRecording();
      if (cmd.cmd === 'stop') stopRecording();
      if (cmd.cmd === 'settings') openSettings(cmd.tab || 'general');
      if (cmd.cmd === 'perm') openPermWindow();
      if (cmd.cmd === 'fakePerm') { screenAtLaunch = cmd.atLaunch; permOverride = cmd.override || null; }   // 测试：模拟权限状态（启动时没权限 / 开关还没开）
      if (cmd.cmd === 'pinClipboard') pinClipboard();
      if (cmd.cmd === 'eval' && overlayWin) console.log('EVAL', JSON.stringify(await overlayWin.webContents.executeJavaScript(cmd.js)));
      if (cmd.cmd === 'evalSettings' && settingsWin) console.log('EVAL', JSON.stringify(await settingsWin.webContents.executeJavaScript(cmd.js)));
      if (cmd.cmd === 'clipboard') { const png = await clip.readImagePng(); if (png) { fs.writeFileSync('/tmp/hopsnap-clip.png', png); console.log('CLIP', JSON.stringify(nativeImage.createFromBuffer(png).getSize())); } else console.log('CLIP none'); }
      if (cmd.cmd === 'double') { startFullRecording(); setTimeout(() => startFullRecording(), cmd.gap || 30); }
      if (cmd.cmd === 'recAction') ipcMain.emit('recbar:action', {}, cmd.action);
      if (cmd.cmd === 'notchTime' && notch) { notch.debugElapsed(Number(cmd.ms) || 0); console.log('NOTCHTIME', Number(cmd.ms) || 0); }
      if (cmd.cmd === 'notchState') console.log('NOTCHSTATE', JSON.stringify(notch ? notch.debugState() : null));
      if (cmd.cmd === 'notchRec' && notch) {
        notch.beginRec({ display: cmd.display || screen.getPrimaryDisplay(), full: cmd.full !== false, quality: cmd.quality || '1080' });
        if (cmd.ms != null) notch.debugElapsed(Number(cmd.ms) || 0);
        console.log('NOTCHREC');
      }
      if (cmd.cmd === 'notchEnd' && notch) { notch.endRec(); console.log('NOTCHEND'); }
      if (cmd.cmd === 'fileTools' && fileTools) { fileTools.openWindow(); console.log('FILETOOLS'); }
      if (cmd.cmd === 'filePanel' && fileTools) { fileTools.previewPanel(cmd.view || {}); console.log('PANEL'); }
      if (cmd.cmd === 'fileArc' && fileTools) { fileTools.previewArc(cmd.files || []).then(() => console.log('ARC'), (e) => console.log('ARC ERR', e && e.message)); }
      if (cmd.cmd === 'setSettings') { settings.set(cmd.patch); if (cmd.patch && cmd.patch.present && present) present.applySettings(); console.log('SETTINGS OK'); }
      if (cmd.cmd === 'windows') console.log('WINDOWS', BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
      if (cmd.cmd === 'status') console.log('STATUS', JSON.stringify({ hotkeyStatus, rec: !!rec, pins: pins.size, overlayVisible: !!(overlayWin && overlayWin.isVisible()), busy: overlayBusy, escHeld, keysHeld, overlayScale: overlayWin && overlayWin.createdScale, overlayBounds: overlayWin && overlayWin.getBounds(), barPos: rec && rec.barPos, workArea: rec && rec.display && rec.display.workArea }));
      if (cmd.cmd === 'evalRec' && rec && rec.recWin) console.log('EVAL', JSON.stringify(await rec.recWin.webContents.executeJavaScript(cmd.js)));
      if (cmd.cmd === 'holdKeys') { holdEsc(); holdKeys(); console.log('HELD', JSON.stringify(keysHeld)); }
      if (cmd.cmd === 'trayClick') tray.emit('click');
      if (cmd.cmd === 'trayLabels' && trayMenu) console.log('TRAY', JSON.stringify(trayMenu.items.map((i) => i.label + (i.submenu ? ':' + i.submenu.items.map((x) => x.label + (x.checked ? '*' : '')).join('|') : ''))));
      if (cmd.cmd === 'lang') console.log('LANG', i18n.getLang());
      if (cmd.cmd === 'overlayKey' && overlayWin) overlayWin.webContents.send('overlay:key', cmd.key);
      if (cmd.cmd === 'applyHotkeysTest') { applyHotkeys(); console.log('APPLIED'); }
      if (cmd.cmd === 'trayDouble') { tray.emit('click'); setTimeout(() => tray.emit('double-click'), cmd.gap || 300); }
      if (cmd.cmd === 'failClip') { const orig = clip.writeImagePng; clip.writeImagePng = async () => { throw new Error('模拟剪贴板被占用'); }; setTimeout(() => { clip.writeImagePng = orig; }, cmd.ms || 4000); console.log('CLIP FAIL ON'); }
      if (cmd.cmd === 'settingsReset') { settings.reset(); setLaunchAtLogin(false); applyHotkeys(); console.log('RESET OK'); }
      if (cmd.cmd === 'logo') { settings.set({ general: { logo: cmd.name } }); console.log('LOGORES', JSON.stringify(await applyLogo({ system: true }))); }
      if (cmd.cmd === 'trayInfo') { const img = trayIcon(); console.log('TRAY', JSON.stringify({ size: img.getSize(), template: img.isTemplateImage(), hash: require('crypto').createHash('md5').update(img.toPNG()).digest('hex').slice(0, 8), file: logoFile(isMac ? 'trayMac.png' : 'tray.png') })); }
      if (cmd.cmd === 'themeInfo') console.log('THEMEINFO', JSON.stringify({ theme: themeName(), setting: themeSetting(), source: nativeTheme.themeSource, dark: themeDark(), bg: themeBg(), winBg: settingsWin && !settingsWin.isDestroyed() ? settingsWin.getBackgroundColor() : null,
        winId: settingsWin && !settingsWin.isDestroyed() ? settingsWin.id : null, glassBuilt: !!(settingsWin && settingsWin.glassBuilt),
        winBounds: settingsWin && !settingsWin.isDestroyed() ? settingsWin.getBounds() : null, winVisible: !!(settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()),
        settingsWins: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /settings\.html/.test(w.webContents.getURL())).length }));
      if (cmd.cmd === 'evalOverlay' && overlayWin) console.log('EVAL', JSON.stringify(await overlayWin.webContents.executeJavaScript(cmd.js)));
      if (cmd.cmd === 'present') {
        if (cmd.action === 'demo') present.setDemo(cmd.on);
        if (cmd.action === 'spot') present.setSpot(cmd.on);
        if (cmd.action === 'cam') toggleCamera(cmd.on);
        if (cmd.action === 'camFail') present.setTestFail(cmd.name || '');
        console.log('PRESENT OK');
      }
      if (cmd.cmd === 'presentStatus') console.log('PSTATUS', JSON.stringify({ ...present.status(), rec: !!rec, recFx: present.recFx(), extraWarn: rec ? rec.extraWarn : [], recAbs: rec && rec.abs }));
      if (cmd.cmd === 'evalLayer') { const w = present.layerWindows()[cmd.idx || 0]; console.log('EVAL', JSON.stringify(w ? await w.webContents.executeJavaScript(cmd.js) : 'NOLAYER')); }
      if (cmd.cmd === 'evalCam') { const w = present.camWindow(); console.log('EVAL', JSON.stringify(w ? await w.webContents.executeJavaScript(cmd.js) : 'NOCAM')); }
      if (cmd.cmd === 'evalBar') { const bw = rec && rec.barWin && !rec.barWin.isDestroyed() ? rec.barWin : (doneBar && doneBar.win && !doneBar.win.isDestroyed() ? doneBar.win : null); console.log('EVAL', JSON.stringify(bw ? await bw.webContents.executeJavaScript(cmd.js) : 'NOBAR')); }
      if (cmd.cmd === 'doneBar') console.log('DONEBAR_STATE', JSON.stringify(doneBar && doneBar.win && !doneBar.win.isDestroyed() ? { file: doneBar.file, visible: doneBar.win.isVisible() } : null));
      if (cmd.cmd === 'recover') { await recoverRecordings(); console.log('RECOVERED'); }
      if (cmd.cmd === 'hotkey') { const fn = { presentMode: () => present.setDemo(!present.isDemo()), spotlight: () => present.setSpot(!present.isSpot()) }[cmd.action]; if (fn) fn(); console.log('HOTKEY OK'); }
      if (cmd.cmd === 'trayMenu') {
        const flat = [];
        (function walk(items, prefix) {
          for (const i of items) {
            if (!i || !i.label) continue;
            const lab = i.label.split('\t')[0];
            flat.push({ label: lab, checked: i.checked, enabled: i.enabled, path: prefix ? `${prefix}/${lab}` : lab });
            if (i.submenu) walk(i.submenu, prefix ? `${prefix}/${lab}` : lab);
          }
        })(lastTrayTpl, '');
        console.log('TRAYMENU', JSON.stringify(flat));
      }
      if (cmd.cmd === 'trayItem') {
        let it = null;
        (function find(items) {
          for (const i of items) {
            if (!i) continue;
            if (i.label && i.label.startsWith(cmd.label)) { it = i; return true; }
            if (i.submenu && find(i.submenu)) return true;
          }
          return false;
        })(lastTrayTpl);
        if (it && typeof it.click === 'function') it.click({ checked: cmd.checked });
        console.log('TRAYITEM', !!it);
      }
      if (cmd.cmd === 'crashOverlay' && overlayWin) { overlayWin.webContents.forcefullyCrashRenderer(); console.log('CRASHED'); }
      if (cmd.cmd === 'cursor') console.log('CURSOR', JSON.stringify(screen.getCursorScreenPoint()));
      if (cmd.cmd === 'quit') { app.isQuitting = true; app.quit(); }
    } catch (e) { console.log('TEST ERR', e.message); }
  }, 200);
}

// ---------------------------------------------------------------- 启动
// 1.x 叫 BillyShot：第一次以呱咔 / Hopsnap 启动时，把旧的设置和截图历史搬过来（旧文件夹不动）
function migrateLegacyData() {
  try {
    const cur = app.getPath('userData');
    if (fs.existsSync(path.join(cur, 'settings.json'))) return;
    // 2.0 内测期短暂叫过 Snapfrog；1.x 叫 BillyShot
    const old = ['Snapfrog', 'BillyShot'].map((n) => path.join(app.getPath('appData'), n)).find((d) => fs.existsSync(path.join(d, 'settings.json')));
    if (!old) return;
    fs.mkdirSync(cur, { recursive: true });
    fs.copyFileSync(path.join(old, 'settings.json'), path.join(cur, 'settings.json'));
    const oh = path.join(old, 'history');
    if (fs.existsSync(oh)) fs.cpSync(oh, path.join(cur, 'history'), { recursive: true });
    console.log('migrated settings from', old);
  } catch (e) { console.error('migrate legacy data failed', e); }
}

app.whenReady().then(() => {
  migrateLegacyData();
  settings = new Settings();
  log('Hopsnap start', app.getVersion(), process.platform, os.release(), process.arch);
  if (isMac) screenAtLaunch = macScreenOk();
  applyLanguage();
  applyAppearance();
  nativeTheme.on('updated', () => applyTheme());
  if (isMac && app.dock) app.dock.hide();
  setupDisplayMediaHandler();
  present = createPresent({
    settings, log, notify, hotkeys, R, isMac, isWin, t, askAx: askAccessibilityOnce,
    onChange: () => { buildTrayMenu(); syncBarFx(); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:present', presentState()); },
    // 演示层出现后，录屏控制条要在它上面（聚光灯不把它压暗）
    raiseOthers: () => {
      if (notch) notch.moveTop();
      if (!rec) return;
      for (const w of [rec.frameWin, rec.barWin]) { if (w && !w.isDestroyed() && w.isVisible()) { try { w.moveTop(); } catch {} } }
    },
    settingsChanged: () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed'); },
    onCamError: (msg) => { if (rec) { addRecWarn(msg); } syncBarFx(); },
  });
  fileTools = createFileTools({
    BrowserWindow, ipcMain, screen, shell, dialog, Notification, nativeImage, app, settings, t, isMac, isWin, log, R,
    getTray: () => tray, trayIcon,
  });
  // The tray stays on every platform. The notch is Mac-only and never replaces it.
  if (isMac && !process.env.HOPSNAP_NO_NOTCH) {
    try {
      notch = createNotch({
        screen, BrowserWindow, log, R, protect, onCmd: runNotchCmd,
        timerPreference: () => ((settings.get().notch || {}).timer || ''),
      });
    } catch (e) { log('notch failed', e); notch = null; }
  }
  if (notch) log('notch', notch.geom);
  createTray();
  fileTools.attachTray(tray);
  fileTools.syncShiftDrag();
  // Mac：用户在系统设置里打开「辅助功能」后自动生效（鼠标快捷键、点击波纹），不用重开
  hotkeys.setAxGrantedHandler(() => {
    log('accessibility granted');
    applyHotkeys();
    if (present) present.applySettings();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed');
  });
  setTimeout(() => { macStartupChecks().catch((e) => log('mac startup checks', e.message)); }, 1200);
  scheduleUpdateCheck();
  // 选了紫色版：升级安装会把快捷方式 / .app 图标还原成头像版 → 启动时补回（已一致则什么都不做）
  applyLogo();
  setTimeout(() => {
    try { if (isWin) applyWinShortcutIcons(logoName()); } catch (e) { log('shortcut icons', e); }
    if (isMac && settings.get().general.logoMacOk) applyMacBundleIcon(logoName()).then((r) => { if (!r.unchanged && !r.skipped) settings.set({ general: { logoMacOk: r.ok && logoName() !== BUILTIN_LOGO } }); });
  }, 1500);
  applyHotkeys();
  createOverlay();
  setupTestHooks();
  // 上次没正常结束的录屏（.part）：启动后稍等一会儿再整理，不拖慢启动
  setTimeout(() => { recoverRecordings().catch((e) => log('recover recordings', e)); }, 2500);
  const rebuildOverlay = () => { rebuildOverlayWin(); };
  screen.on('display-removed', rebuildOverlay);
  screen.on('display-metrics-changed', (_e, _d, changed) => { if (changed && changed.includes('scaleFactor')) rebuildOverlay(); });
  // 演示层每块屏一个窗口：屏幕增减 / 分辨率 / 缩放变化时重建
  // 只有分辨率 / 位置 / 缩放变了才重建（任务栏、Dock 变化只调整范围），合并 300ms 内的多次变化
  let presentRebuildTimer = null, presentNeedRebuild = false;
  const presentDisplays = (rebuild) => {
    presentNeedRebuild = presentNeedRebuild || rebuild;
    clearTimeout(presentRebuildTimer);
    presentRebuildTimer = setTimeout(() => { const r = presentNeedRebuild; presentNeedRebuild = false; if (present) (r ? present.rebuild() : present.applySettings()); }, 300);
  };
  screen.on('display-added', () => presentDisplays(true));
  screen.on('display-removed', () => presentDisplays(true));
  screen.on('display-metrics-changed', (_e, _d, changed) => presentDisplays(!!(changed && changed.some((c) => c === 'bounds' || c === 'scaleFactor' || c === 'rotation'))));
  // 快捷键被占用（例如微信也用 Alt+A）：每次启动都检查并处理
  checkHotkeyConflicts();
  // 第一次打开：Mac 上还没屏幕录制权限时由权限助手引路（见 macStartupChecks），开始页留到授权重开之后再出现
  if (settings.get().general.firstRun && !(isMac && app.isPackaged && !macScreenOk())) {
    settings.set({ general: { firstRun: false } });
    openSettings('welcome');
  }
});

app.on('second-instance', () => openSettings('general'));
app.on('window-all-closed', (e) => { /* 常驻托盘，不退出 */ });
app.on('before-quit', () => { app.isQuitting = true; try { if (present) present.dispose(); } catch {} try { if (fileTools) fileTools.dispose(); } catch {} });
app.on('will-quit', () => hotkeys.dispose());
