// 生成呱咔 / Hopsnap 的全部图标资源（用 Electron 离屏渲染 src/renderer/frog.js 里的 SVG，不依赖 Python / PIL）
//   npm run assets      → assets/logos/frog/*、assets/icon.png、assets/icon256.png、assets/icon.ico、assets/icon-mac.png
// 托盘：Windows 彩色 16–48px（tray*.png），macOS 黑色模板图 18 / 36px（trayMac*.png，运行时 setTemplateImage）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const Frog = require('../src/renderer/frog.js');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'logos', 'frog');

let win = null;
const TMP = path.join(require('os').tmpdir(), 'frog-render.html');
async function render(svg, size, height = size) {
  if (!win) win = new BrowserWindow({ width: size, height, show: false, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  win.setContentSize(size, height);
  fs.writeFileSync(TMP, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
  await win.loadFile(TMP);
  await new Promise((r) => setTimeout(r, 150));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height });
  return img.toPNG();
}

// ICO：每个尺寸一个 PNG 条目（Vista 起支持；256 以下也用 PNG，资源管理器 / 任务栏都认）
function ico(pngs) {
  const n = pngs.length;
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(n, 4);
  const dir = Buffer.alloc(16 * n);
  let off = 6 + 16 * n;
  pngs.forEach(([size, buf], i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; dir[o + 1] = size >= 256 ? 0 : size; dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(off, o + 12);
    off += buf.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p[1])]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const w = (f, buf) => { fs.writeFileSync(f, buf); console.log('wrote', path.relative(ROOT, f), buf.length); };
  // 应用图标
  const icon1024 = await render(Frog.icon(1024), 1024);
  w(path.join(OUT, 'icon.png'), icon1024);
  w(path.join(OUT, 'mac.png'), icon1024);
  w(path.join(ROOT, 'assets', 'icon.png'), icon1024);
  w(path.join(ROOT, 'assets', 'icon-mac.png'), icon1024);
  const icon256 = await render(Frog.icon(256), 256);
  w(path.join(OUT, 'icon256.png'), icon256);
  w(path.join(ROOT, 'assets', 'icon256.png'), icon256);
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const s of icoSizes) icoPngs.push([s, s === 256 ? icon256 : await render(Frog.icon(s), s)]);
  const icoBuf = ico(icoPngs);
  w(path.join(OUT, 'icon.ico'), icoBuf);
  w(path.join(ROOT, 'assets', 'icon.ico'), icoBuf);
  // Windows 托盘（彩色）
  for (const [name, s] of [['tray.png', 16], ['tray@1.25x.png', 20], ['tray@1.5x.png', 24], ['tray@2x.png', 32], ['tray@2.5x.png', 40], ['tray@3x.png', 48]])
    w(path.join(OUT, name), await render(Frog.tray(s), s));
  // macOS 菜单栏模板图（黑色 + 透明，系统按深浅色自动反色）
  w(path.join(OUT, 'trayMac.png'), await render(Frog.mark(18), 18));
  w(path.join(OUT, 'trayMac@2x.png'), await render(Frog.mark(36), 36));
  // 预览图（README / 设计稿用）
  const sheet = ['idle', 'blink', 'happy', 'snap', 'puff', 'sad', 'x', 'wink'].map((m, i) => `<g transform="translate(${i * 130} 0)">${Frog.svg(m, 120)}</g>`).join('');
  w(path.join(OUT, 'moods.png'), await render(`<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="130" viewBox="0 0 1040 130"><rect width="1040" height="130" fill="#FAF6EC"/>${sheet}</svg>`, 1040, 130));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
