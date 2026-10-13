// 屏幕抓取：优先 node-screenshots（原生、快），失败回退到 Electron desktopCapturer
const { screen, desktopCapturer } = require('electron');

const isWin = process.platform === 'win32';

let ns = null;
function nativeLib() {
  if (ns !== null) return ns;
  try { ns = require('node-screenshots'); } catch (e) { console.error('node-screenshots unavailable', e.message); ns = false; }
  return ns;
}

function cursorDisplay() {
  const pt = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(pt);
}

const INVISIBLE_WIN = /^(NVIDIA GeForce Overlay|NVIDIA Share|AMD DVR Overlay|Windows Input Experience|Windows 输入体验|Microsoft Text Input Application|Microsoft 文本输入应用程序|Windows Shell Experience Host|Windows Shell 体验主机|Xbox Game Bar|Xbox 游戏栏)$/i;

function toDipRect(r) {
  if (isWin) {
    try { return screen.screenToDipRect(null, r); } catch { return r; }
  }
  return r;
}

function listWindows(display) {
  const lib = nativeLib();
  if (!lib) return [];
  try {
    const all = lib.Window.all();
    const b = display.bounds;
    const out = [];
    for (const w of all) {
      try {
        if (safe(() => w.isMinimized())) continue;
        const title = safe(() => w.title()) || '';
        if (safe(() => w.pid()) === process.pid) {
          // 自己的覆盖层/录制窗口不参与识别，设置窗口和贴图可以
          if (!title || /Overlay|Recorder|RecBar|RecFrame|Present/.test(title)) continue;
        }
        const raw = { x: w.x(), y: w.y(), width: w.width(), height: w.height() };
        if (raw.width < 30 || raw.height < 20) continue;
        const r = toDipRect(raw);
        // 转为覆盖窗口内的局部坐标，并裁剪到当前屏幕
        let x1 = Math.max(r.x, b.x), y1 = Math.max(r.y, b.y);
        let x2 = Math.min(r.x + r.width, b.x + b.width), y2 = Math.min(r.y + r.height, b.y + b.height);
        if (x2 - x1 < 20 || y2 - y1 < 20) continue;
        // 系统里看不见的置顶窗口（显卡覆盖层、输入法面板等）不参与识别，否则悬停总是选中整屏
        if (isWin && INVISIBLE_WIN.test(title)) continue;
        // 程序名只有 macOS 用得到；Windows 上读取它要查每个进程的版本信息，会拖慢截图
        const appName = process.platform === 'darwin' ? (safe(() => w.appName()) || '') : '';
        if (process.platform === 'darwin' && /^(Window Server|Dock|Control Center|控制中心|Notification Center|通知中心|SystemUIServer)$/i.test(appName)) {
          // 菜单栏/程序坞等系统层，保留全宽菜单栏以外的跳过
          if (y2 - y1 < 40) continue;
        }
        out.push({ x: x1 - b.x, y: y1 - b.y, w: x2 - x1, h: y2 - y1, z: safe(() => w.z()) ?? 0, title, appName });
      } catch { /* 单个窗口读取失败忽略 */ }
    }
    // z 越大越靠前
    out.sort((a, b2) => b2.z - a.z);
    return out;
  } catch (e) {
    console.error('list windows failed', e.message);
    return [];
  }
}

function safe(fn) { try { return fn(); } catch { return undefined; } }

async function captureNative(display) {
  const lib = nativeLib();
  if (!lib) throw new Error('no native');
  const c = display.bounds;
  let pt = { x: Math.round(c.x + c.width / 2), y: Math.round(c.y + c.height / 2) };
  if (isWin) { try { pt = screen.dipToScreenPoint(pt); } catch {} }
  let mon = lib.Monitor.fromPoint(pt.x, pt.y);
  if (!mon) {
    const all = lib.Monitor.all();
    mon = all.find((m) => m.isPrimary()) || all[0];
  }
  if (!mon) throw new Error('no monitor');
  const img = await mon.captureImage();
  const data = await img.toRaw(true);
  return { kind: 'raw', width: img.width, height: img.height, data };
}

async function captureFallback(display) {
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.bounds.width * sf), height: Math.round(display.bounds.height * sf) },
  });
  let src = sources.find((s) => s.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null) ||
            sources.find((s) => s.id.startsWith(`screen:${display.id}:`)) || sources[0];
  if (!src) throw new Error('no screen source');
  const size = src.thumbnail.getSize();
  return { kind: 'png', width: size.width, height: size.height, data: src.thumbnail.toPNG() };
}

async function captureDisplay(display, { withWindows = true } = {}) {
  const windows = withWindows ? listWindows(display) : [];
  let image;
  try {
    image = await captureNative(display);
    // 校验尺寸：若明显不匹配（多屏混合 DPI 下偶发），回退
    const expW = display.bounds.width * display.scaleFactor;
    if (Math.abs(image.width - expW) / expW > 0.2) throw new Error(`size mismatch ${image.width} vs ${expW}`);
  } catch (e) {
    console.warn('native capture failed, fallback:', e.message);
    image = await captureFallback(display);
  }
  return {
    display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
    image,
    windows,
  };
}

module.exports = { captureDisplay, cursorDisplay };
