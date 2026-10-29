// 演示录屏（1.3.0）：演示层（鼠标光圈 / 点击波纹 / 聚光灯）+ 摄像头圆窗
// 这些窗口都不加防截屏保护：录屏和 Zoom / Teams 共享屏幕时观众都能看到。
const { BrowserWindow, screen, ipcMain, systemPreferences, shell } = require('electron');

const CAM_SIZES = { s: 160, m: 240, l: 340 };
const CAM_MIN = 96;
const CAM_MARGIN = 20;
const HEX = /^#[0-9a-f]{6}$/i;

function createPresent(deps) {
  const { settings, log, notify, hotkeys, R, isMac, isWin } = deps;
  const onChange = deps.onChange || (() => {});
  const raiseOthers = deps.raiseOthers || (() => {});
  const settingsChanged = deps.settingsChanged || (() => {});
  const askAx = deps.askAx || null;   // Mac：请系统把 Hopsnap 加进「辅助功能」列表（每个版本最多弹一次）
  const t = deps.t || ((x) => x); // 界面语言（主进程 i18n）
  const test = !!process.env.HOPSNAP_TEST;
  // Windows / macOS：不可聚焦，点不到也不会抢走焦点。Linux（只用于开发测试）上不可聚焦的窗口会脱离窗口管理器、
  // 永远压在最上面，层级没法调整，所以 Linux 上保持可聚焦（仍然鼠标穿透、显示时不激活）
  const noFocus = process.platform !== 'linux';

  let demo = false;          // 演示模式（不录屏也显示光圈 / 波纹）
  let spot = false;          // 聚光灯
  let rec = null;            // 录制中：{ fx, display, area }
  let layers = new Map();    // displayId -> BrowserWindow
  let hiddenForCapture = false;
  let posTimer = null;
  let lastPos = null, lastDisplayId = null;
  let hookOn = false, clickReq = false, offClick = null, axWarned = false, axWait = null;
  // Linux（只用于开发测试）：Electron 在 X11 上的 getCursorScreenPoint 只在自己窗口收到事件时才更新，
  // 改用鼠标钩子给的位置。Windows / macOS 直接问系统，不需要权限。
  const isLinux = process.platform === 'linux';
  let hookPos = null, moveHookOn = false, offMove = null;
  function cursorPoint() { return isLinux && hookPos ? { ...hookPos } : screen.getCursorScreenPoint(); }
  let cam = null;            // { win, owner, display, area, state, error, readyWaiters }
  let disposed = false;
  let testFail = '';         // 自动化测试：模拟摄像头错误

  // ------------------------------------------------------------ 设置（读出时校验，防止异常值）
  // 'single' is a stored legacy value only (not shown in settings). The layer draws concentric white rings for it.
  const RIPPLE_STYLES = ['water', 'single'];
  function P() {
    const p = settings.get().present || {};
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    return {
      halo: !!p.halo, clicks: !!p.clicks, withRecord: p.withRecord !== false,
      haloColor: HEX.test(p.haloColor) ? p.haloColor : '#ffd23f',
      haloSize: num(p.haloSize, 24, 160, 56), haloOpacity: num(p.haloOpacity, 0.1, 0.9, 0.35),
      clickLeft: HEX.test(p.clickLeft) ? p.clickLeft : '#ff4d6d',
      clickRight: HEX.test(p.clickRight) ? p.clickRight : '#3d8bff',
      rippleStyle: RIPPLE_STYLES.includes(p.rippleStyle) ? p.rippleStyle : 'water',
      spotRadius: num(p.spotRadius, 60, 500, 170), spotDim: num(p.spotDim, 0.2, 0.9, 0.6),
      camera: !!p.camera, cameraDeviceId: typeof p.cameraDeviceId === 'string' ? p.cameraDeviceId : '',
      cameraShape: p.cameraShape === 'rounded' ? 'rounded' : 'circle',
      cameraSize: CAM_SIZES[p.cameraSize] ? p.cameraSize : 'm',
      cameraMirror: p.cameraMirror !== false,
      cameraPos: p.cameraPos && Number.isFinite(p.cameraPos.cx) && Number.isFinite(p.cameraPos.cy) ? p.cameraPos : null,
    };
  }

  const fxOn = () => demo || !!(rec && rec.fx);
  const layerWanted = () => !disposed && (spot || (fxOn() && (P().halo || P().clicks)));

  function layerCfg() {
    const p = P(); const fx = fxOn();
    return {
      halo: fx && p.halo, clicks: fx && p.clicks, spot,
      haloColor: p.haloColor, haloSize: p.haloSize, haloOpacity: p.haloOpacity,
      clickLeft: p.clickLeft, clickRight: p.clickRight, rippleStyle: p.rippleStyle, spotRadius: p.spotRadius, spotDim: p.spotDim,
    };
  }

  // ------------------------------------------------------------ 演示层窗口
  function layerBounds(d) {
    const b = d.bounds;
    // Windows：盖满整个屏幕的置顶窗口会被当成「全屏程序」（屏蔽通知、任务栏异常），少 1 像素即可避免
    return { x: b.x, y: b.y, width: b.width, height: isWin ? b.height - 1 : b.height };
  }
  function createLayer(d) {
    const win = new BrowserWindow({
      ...layerBounds(d), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: !noFocus, skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true, show: false,
      type: isMac ? 'panel' : (isWin ? 'toolbar' : undefined), roundedCorners: false,
      webPreferences: { preload: R('preload.js'), backgroundThrottling: false, spellcheck: false },
    });
    win.displayId = d.id;
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.loadFile(R('renderer', 'present.html'));
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('present:cfg', layerCfg());
      lastPos = null; // 让轮询立刻把当前位置发过去
      if (!hiddenForCapture && layerWanted()) {
        win.showInactive();
        win.setBounds(layerBounds(d));
        raise();
        // 有的系统（X11 / 部分 Windows）显示窗口是异步的：稍后再把控制条、摄像头提到上面一次
        setTimeout(() => { if (!win.isDestroyed() && win.isVisible()) raise(); }, 150);
      }
    });
    win.webContents.on('render-process-gone', (_e, info) => {
      log('present layer gone', info);
      if (layers.get(d.id) === win) { layers.delete(d.id); try { win.destroy(); } catch {} setTimeout(update, 500); }
    });
    if (process.env.HOPSNAP_DEBUG) win.webContents.on('console-message', (e) => console.log('[present]', e.message));
    return win;
  }
  // 摄像头圆窗、录屏控制条要在演示层上面（聚光灯不能把它们压暗）
  function raise() {
    if (hiddenForCapture) return; // 截图界面开着时不要把圆窗 / 控制条提到截图界面上面
    if (cam && cam.win && !cam.win.isDestroyed() && cam.win.isVisible()) { try { cam.win.moveTop(); } catch {} }
    raiseOthers();
  }
  function closeLayers() {
    for (const w of layers.values()) { try { if (!w.isDestroyed()) w.destroy(); } catch {} }
    layers.clear();
  }
  function syncLayers() {
    if (!layerWanted()) { closeLayers(); return; }
    const ds = screen.getAllDisplays();
    const ids = new Set(ds.map((d) => d.id));
    for (const [id, w] of layers) { if (!ids.has(id) || w.isDestroyed()) { try { w.destroy(); } catch {} layers.delete(id); } }
    for (const d of ds) {
      const w = layers.get(d.id);
      if (!w) layers.set(d.id, createLayer(d));
      else { try { w.setBounds(layerBounds(d)); } catch {} }
    }
  }
  function broadcast(ch, payload) {
    for (const w of layers.values()) { try { if (!w.isDestroyed()) w.webContents.send(ch, payload); } catch {} }
  }

  // 鼠标位置：60Hz 轮询（DIP 坐标，不需要任何系统权限）
  function tick() {
    if (!layers.size) return;
    const p = cursorPoint();
    if (lastPos && p.x === lastPos.x && p.y === lastPos.y) return;
    lastPos = p;
    const d = screen.getDisplayNearestPoint(p);
    for (const [id, w] of layers) {
      if (w.isDestroyed()) continue;
      if (id === d.id) w.webContents.send('present:pos', { on: true, x: p.x - d.bounds.x, y: p.y - d.bounds.y });
      else if (lastDisplayId === id || lastDisplayId === null) w.webContents.send('present:pos', { on: false });
    }
    lastDisplayId = d.id;
  }
  function syncTimer() {
    if (layers.size && !posTimer) { lastPos = null; lastDisplayId = null; posTimer = setInterval(tick, 16); }
    if (!layers.size && posTimer) { clearInterval(posTimer); posTimer = null; }
  }

  // 水波纹的折射：点击那一刻抓下点击处周围一小块屏幕（RGBA，物理像素），发给演示层做「透过水看」的效果。
  // 抓不到（没有原生抓屏库、Mac 没有屏幕录制权限、同时在抓的太多）就不折射，只画反光，照样是透明水波。
  const PATCH_HALF = 220;        // 抓点击处上下左右各 220 DIP（波纹看得见的范围）
  let nsLib, patchBusy = 0, clickSeq = 0;
  function screenshotsLib() {
    if (nsLib === undefined) { try { nsLib = require('node-screenshots'); } catch (e) { log('present: node-screenshots unavailable ' + e.message); nsLib = null; } }
    return nsLib;
  }
  function canPatch() {
    if (process.env.HOPSNAP_TEST_NOPATCH || !screenshotsLib() || patchBusy >= 2) return false;
    if (isMac) { try { return systemPreferences.getMediaAccessStatus('screen') === 'granted'; } catch { return false; } }
    return true;
  }
  async function grabPatch(d, cx, cy) {
    const lib = screenshotsLib();
    let pt = { x: Math.round(d.bounds.x + d.bounds.width / 2), y: Math.round(d.bounds.y + d.bounds.height / 2) };
    if (isWin) { try { pt = screen.dipToScreenPoint(pt); } catch {} }
    const mon = lib.Monitor.fromPoint(pt.x, pt.y);
    if (!mon) return null;
    const img = await mon.captureImage();
    const sx = img.width / d.bounds.width, sy = img.height / d.bounds.height;   // 每个 DIP 多少物理像素
    if (!(sx > 0.4 && sx < 5 && Math.abs(sx - sy) < 0.1)) return null;          // 抓到的不是这块屏（混合缩放偶发）
    const x0 = Math.max(0, cx - PATCH_HALF), y0 = Math.max(0, cy - PATCH_HALF);
    const x1 = Math.min(d.bounds.width, cx + PATCH_HALF), y1 = Math.min(d.bounds.height, cy + PATCH_HALF);
    const px = Math.round(x0 * sx), py = Math.round(y0 * sy);
    const pw = Math.min(img.width - px, Math.round((x1 - x0) * sx)), ph = Math.min(img.height - py, Math.round((y1 - y0) * sy));
    if (pw < 2 || ph < 2) return null;
    const part = await img.crop(px, py, pw, ph);
    const data = await part.toRaw(true);
    return { x: px / sx, y: py / sy, w: pw / sx, h: ph / sy, pw, ph, data };
  }
  let lastPatchMs = 0;
  // 点击：共用 uiohook 鼠标钩子；坐标用当时的光标位置（避免各平台物理像素 / 逻辑像素换算）
  function onClick(e) {
    const c = layerCfg();
    if (!layers.size || hiddenForCapture || !c.clicks) return;
    if (isLinux && Number.isFinite(e.x)) hookPos = { x: e.x, y: e.y };
    const p = cursorPoint();
    const d = screen.getDisplayNearestPoint(p);
    const w = layers.get(d.id);
    if (!w || w.isDestroyed()) return;
    const x = p.x - d.bounds.x, y = p.y - d.bounds.y, id = ++clickSeq;
    const refract = c.rippleStyle === 'water' && canPatch();
    w.webContents.send('present:click', { id, x, y, refract, button: e.button === 1 ? 'left' : 'right' });
    if (!refract) return;
    patchBusy++;
    const t0 = Date.now();
    grabPatch(d, x, y).then((pp) => {
      lastPatchMs = Date.now() - t0;
      if (!w.isDestroyed()) w.webContents.send('present:patch', pp ? { id, ...pp } : { id });
    }).catch((err) => {
      log('present: patch failed ' + (err && err.message));
      if (!w.isDestroyed()) w.webContents.send('present:patch', { id });
    }).finally(() => { patchBusy--; });
  }
  function syncHook() {
    const wantMove = isLinux && layers.size > 0;
    if (wantMove !== moveHookOn) {
      if (wantMove) { offMove = hotkeys.onMouseMove((e) => { hookPos = { x: e.x, y: e.y }; }); hotkeys.useHook('present-move', true); }
      else { hotkeys.useHook('present-move', false); if (offMove) { offMove(); offMove = null; } hookPos = null; }
      moveHookOn = wantMove;
    }
    const want = layers.size > 0 && layerCfg().clicks;
    if (want === clickReq) return;
    if (want) {
      if (isMac && !hotkeys.axTrusted()) {
        // 没授权：提示一次（系统授权框每个版本最多弹一次，见 main.js askAccessibilityOnce），
        // 然后静默等待；用户打开开关后自动开始显示波纹，不用重开程序
        if (!axWarned) {
          notify(t('点击波纹需要「辅助功能」权限'), t('系统设置 → 隐私与安全性 → 辅助功能 里勾选 Hopsnap。鼠标光圈和聚光灯不受影响。'));
          if (askAx) askAx();
        }
        axWarned = true;
        if (!axWait) axWait = hotkeys.whenAxTrusted(() => { axWait = null; if (!disposed) update(); });
        return;
      }
      if (!offClick) offClick = hotkeys.onMouseDown(onClick);
      clickReq = true; // 已登记使用钩子（不管启动成没成功，关的时候都要注销）
      hookOn = hotkeys.useHook('present', true);
      if (!hookOn) log('present: mouse hook unavailable, click ripples disabled');
    } else {
      hotkeys.useHook('present', false);
      if (offClick) { offClick(); offClick = null; }
      clickReq = false; hookOn = false;
    }
  }

  function update() {
    if (disposed) return;
    syncLayers();
    broadcast('present:cfg', layerCfg());
    syncTimer();
    syncHook();
    onChange();
  }

  // 都没开的时候打开演示模式：默认开启光圈和波纹
  function ensureFx() {
    const p = P();
    if (p.halo || p.clicks) return false;
    settings.set({ present: { halo: true, clicks: true } });
    settingsChanged();
    return true;
  }

  // ------------------------------------------------------------ 截图时临时隐藏（截图里不要光圈）
  async function hideForCapture() {
    if (!layers.size || hiddenForCapture) { hiddenForCapture = true; return; }
    hiddenForCapture = true;
    for (const w of layers.values()) { try { if (!w.isDestroyed()) w.hide(); } catch {} }
    await new Promise((r) => setTimeout(r, 90)); // 等合成器把画面刷新掉
  }
  function restoreAfterCapture() {
    if (!hiddenForCapture) return;
    hiddenForCapture = false;
    if (cam && cam.showLater) { cam.showLater = false; showCam(cam); }
    if (!layerWanted()) return;
    const ds = screen.getAllDisplays();
    for (const w of layers.values()) {
      try {
        if (w.isDestroyed()) continue;
        w.showInactive();
        const d = ds.find((x) => x.id === w.displayId); if (d) w.setBounds(layerBounds(d));
      } catch {}
    }
    raise();
  }

  // ------------------------------------------------------------ 摄像头圆窗
  function camDims(sizeKey, shape) {
    const h = CAM_SIZES[sizeKey] || CAM_SIZES.m;
    return { w: shape === 'rounded' ? Math.round(h * 4 / 3) : h, h };
  }
  // 在 area（屏幕 DIP 坐标）里放圆窗：记住的位置在区域内就用，否则放右下角；放不下就缩小，还放不下返回 null
  function placeCamera(display, recArea) {
    const p = P();
    // 放在任务栏 / 菜单栏之外（区域和工作区的交集；交集太小就用整个区域）
    const wa = display.workArea || display.bounds;
    const ix = Math.max(recArea.x, wa.x), iy = Math.max(recArea.y, wa.y);
    const iw = Math.min(recArea.x + recArea.width, wa.x + wa.width) - ix, ih = Math.min(recArea.y + recArea.height, wa.y + wa.height) - iy;
    const area = iw >= CAM_MIN + CAM_MARGIN * 2 && ih >= CAM_MIN + CAM_MARGIN * 2 ? { x: ix, y: iy, width: iw, height: ih } : recArea;
    let { w, h } = camDims(p.cameraSize, p.cameraShape);
    const k = Math.min(1, (area.width - CAM_MARGIN * 2) / w, (area.height - CAM_MARGIN * 2) / h);
    if (k < 1) { w = Math.floor(w * k); h = Math.floor(h * k); }
    if (h < CAM_MIN || w < CAM_MIN) return null;
    const b = display.bounds;
    if (p.cameraPos) {
      const x = Math.round(b.x + p.cameraPos.cx * b.width - w / 2), y = Math.round(b.y + p.cameraPos.cy * b.height - h / 2);
      if (x >= area.x && y >= area.y && x + w <= area.x + area.width && y + h <= area.y + area.height) return { x, y, width: w, height: h };
    }
    return { x: Math.round(area.x + area.width - w - CAM_MARGIN), y: Math.round(area.y + area.height - h - CAM_MARGIN), width: w, height: h };
  }
  function camCfg() {
    const p = P();
    return { deviceId: p.cameraDeviceId, shape: p.cameraShape, mirror: p.cameraMirror, size: p.cameraSize, outside: !!(cam && cam.outside), recording: !!(cam && /record/.test(cam.owner)), simulateError: test ? testFail : '' };
  }
  async function camPermission() {
    if (!isMac) return true;
    try {
      const st = systemPreferences.getMediaAccessStatus('camera');
      if (st === 'granted') return true;
      if (st === 'not-determined') return await systemPreferences.askForMediaAccess('camera');
      return false;
    } catch { return true; }
  }
  function openCamWindow(display, bounds, owner, area) {
    const win = new BrowserWindow({
      ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, acceptFirstMouse: true,
      focusable: !noFocus, skipTaskbar: true, alwaysOnTop: true, show: false, roundedCorners: false,
      type: isMac ? 'panel' : (isWin ? 'toolbar' : undefined),
      webPreferences: { preload: R('preload.js'), backgroundThrottling: false, spellcheck: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    const me = { win, owner, display, area, state: 'loading', error: '', outside: false, waiters: [] };
    cam = me;
    win.loadFile(R('renderer', 'camera.html'));
    onChange();
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('cam:cfg', camCfg());
      if (owner === 'manual') showCam(me); // 录屏用的等出画再显示
    });
    win.on('closed', () => { if (cam === me) { cam = null; settle(me, false); onChange(); } });
    win.webContents.on('render-process-gone', () => { if (cam === me) closeCamera(); });
    if (process.env.HOPSNAP_DEBUG) win.webContents.on('console-message', (e) => console.log('[camera]', e.message));
    return me;
  }
  // 显示圆窗：显示后再设一次位置大小（Windows 不同缩放的屏幕上，隐藏窗口第一次显示时尺寸可能不对）
  function showCam(c) {
    if (!c || c.win.isDestroyed()) return;
    if (hiddenForCapture) { c.showLater = true; return; } // 截图界面开着：截完再显示，不盖住截图界面
    const b = c.win.getBounds();
    c.win.showInactive();
    try { c.win.setBounds(b); } catch {}
    raise();
  }
  function settle(c, ok) { const ws = c.waiters; c.waiters = []; ws.forEach((fn) => fn(ok)); }
  function waitReady(c, ms) {
    if (c.state !== 'loading') return Promise.resolve(c.state === 'ok');
    return new Promise((res) => { let done = false; const fin = (v) => { if (!done) { done = true; res(v); } }; c.waiters.push(fin); setTimeout(() => fin(c.state === 'ok'), ms); });
  }
  // 「一直没有画面」计时：每个圆窗只有一个，重新打开 / 出画 / 出错 / 关闭时清掉重来
  function armNoFrames(c, ms) {
    clearTimeout(c.loadTimer);
    c.loadTimer = setTimeout(() => {
      if (cam !== c || c.state !== 'loading') return;
      log('camera no frames', c.owner);
      closeCamera();
      if (/record/.test(c.owner)) { if (deps.onCamError) deps.onCamError(t('摄像头没有画面')); } else notify(t('摄像头打不开'), t('摄像头没有画面'));
    }, ms);
  }
  function closeCamera() {
    const c = cam; cam = null;
    if (!c) return;
    clearTimeout(c.loadTimer); clearTimeout(c.errTimer);
    settle(c, false);
    try { if (!c.win.isDestroyed()) c.win.destroy(); } catch {}
    onChange();
  }
  function camError(msg) {
    // 区分常见原因，给用户能看懂的提示
    if (/NotReadable|Could not start|TrackStart|in use/i.test(msg)) return t('摄像头正被其他程序使用（例如 Zoom / Teams / 微信）');
    if (/NotFound|DevicesNotFound|OverConstrained/i.test(msg)) return t('没有找到摄像头');
    if (/NotAllowed|Permission|denied/i.test(msg)) return isMac ? t('没有摄像头权限（系统设置 → 隐私与安全性 → 摄像头）') : t('没有摄像头权限');
    return t('摄像头打开失败');
  }

  // 录屏用：显示圆窗，等出画（最多 2.5 秒）。返回 { ok, warning }
  // 打开摄像头的操作排队执行（macOS 第一次会弹授权框，等待期间录屏可能已经结束、或又点了一次）
  let camChain = Promise.resolve();
  function camLocked(fn) { const r = camChain.then(fn, fn); camChain = r.catch(() => {}); return r; }
  let camGen = 0; // 用户关掉摄像头时 +1，排队中 / 等授权中的打开请求作废
  function cameraForRecording(display, area) { const myRec = rec, gen = camGen; return camLocked(() => cameraForRecordingNow(display, area, myRec, gen)); }
  async function cameraForRecordingNow(display, area, myRec, gen) {
    if (!rec || rec !== myRec || gen !== camGen || disposed) return { ok: false, warning: '' };
    const bounds = placeCamera(display, area);
    if (!bounds) return { ok: false, warning: t('区域太小，未显示摄像头') };
    if (!(await camPermission())) return { ok: false, warning: camError('NotAllowed') };
    if (!rec || rec !== myRec || gen !== camGen || disposed) return { ok: false, warning: '' }; // 等授权期间录屏已经结束 / 摄像头被关掉
    // 手动打开、但正在显示错误的圆窗：关掉，不把报错带进录像
    if (cam && !cam.win.isDestroyed() && cam.state === 'error') { const err = cam.error; closeCamera(); return { ok: false, warning: err }; }
    if (cam && !cam.win.isDestroyed()) {
      // 手动打开的圆窗：沿用，挪进录制区域
      if (!/record/.test(cam.owner)) cam.owner = cam.owner === 'manual' ? 'manual+record' : 'record';
      if (cam.state === 'loading') { try { cam.win.hide(); } catch {} } // 还没出画：先藏起来，出画后再显示（不录「启动中…」）
      cam.display = display; cam.area = area;
      const cb = cam.win.getBounds();
      const inside = cb.x >= area.x && cb.y >= area.y && cb.x + cb.width <= area.x + area.width && cb.y + cb.height <= area.y + area.height;
      if (!inside) cam.win.setBounds(bounds);
      sendCam();
    } else openCamWindow(display, bounds, 'record', area);
    const c = cam;
    const ok = await waitReady(c, 2500);
    if (!ok && c.state === 'error') return { ok: false, warning: c.error };
    if (!ok) {
      // 2.5 秒还没出画：先开始录制，再等一会儿；一直没有画面就关掉并提示（不留一个看不见的「开着」的摄像头）
      armNoFrames(c, test ? 3000 : 6000);
    }
    return { ok, warning: '' };
  }
  function sendCam() { if (cam && !cam.win.isDestroyed()) cam.win.webContents.send('cam:cfg', camCfg()); }
  function updateOutside() {
    if (!cam || cam.win.isDestroyed()) return;
    let out = false;
    if (cam.owner !== 'manual' && cam.area) {
      const b = cam.win.getBounds(), a = cam.area;
      out = b.x < a.x - 1 || b.y < a.y - 1 || b.x + b.width > a.x + a.width + 1 || b.y + b.height > a.y + a.height + 1;
    }
    if (out !== cam.outside) { cam.outside = out; sendCam(); }
  }
  function saveCamPos() {
    if (!cam || cam.win.isDestroyed()) return;
    const b = cam.win.getBounds();
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const d = screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) });
    const db = d.bounds;
    settings.set({ present: { cameraPos: { cx: +((c.x - db.x) / db.width).toFixed(4), cy: +((c.y - db.y) / db.height).toFixed(4) } } });
  }
  // 改大小 / 形状：以中心为准缩放，限制在所在屏幕的工作区内
  function resizeCam() {
    if (!cam || cam.win.isDestroyed()) return;
    const p = P();
    const { w, h } = camDims(p.cameraSize, p.cameraShape);
    const b = cam.win.getBounds();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const d = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
    const wa = d.workArea;
    const x = Math.max(wa.x, Math.min(Math.round(cx - w / 2), wa.x + wa.width - w));
    const y = Math.max(wa.y, Math.min(Math.round(cy - h / 2), wa.y + wa.height - h));
    cam.win.setBounds({ x, y, width: w, height: h });
    sendCam(); updateOutside();
  }

  ipcMain.on('cam:state', (e, st) => {
    if (!cam || e.sender !== cam.win.webContents) return;
    if (st && st.loading) {
      // 圆窗重新打开摄像头（换设备）：录制中先藏起来（不把「启动中…」录进去），一直没画面就关掉
      const c = cam; c.state = 'loading'; log('camera reopening', c.owner);
      if (/record/.test(c.owner)) { c.showLater = false; try { c.win.hide(); } catch {} }
      armNoFrames(c, test ? 4000 : 10000); // 每次重新打开都重新计时
      return;
    }
    if (st && st.ok) {
      cam.state = 'ok'; cam.error = ''; clearTimeout(cam.errTimer); clearTimeout(cam.loadTimer); settle(cam, true); log('camera ok', st.w, st.h, st.label || '');
      // 录屏用的圆窗出画以后才显示（不把「启动中…」录进去）
      if (!cam.win.isVisible()) showCam(cam);
      onChange();
    }
    else {
      cam.state = 'error'; cam.error = camError(String((st && st.error) || '')); clearTimeout(cam.loadTimer);
      log('camera error', st && st.error);
      settle(cam, false);
      const c = cam;
      if (deps.onCamError) deps.onCamError(c.error);
      // 录屏用的圆窗：马上关掉（原因显示在控制条上，不要把报错录进视频）；手动打开的显示原因 3 秒后关闭
      if (/record/.test(c.owner)) closeCamera();
      else { clearTimeout(c.errTimer); c.errTimer = setTimeout(() => { if (cam === c && c.state === 'error') closeCamera(); }, test ? 1500 : 3000); }
      if (c.owner === 'manual') notify(t('摄像头打不开'), c.error);
    }
  });
  ipcMain.on('cam:drag', (e, dx, dy) => {
    if (!cam || e.sender !== cam.win.webContents) return;
    const [x, y] = cam.win.getPosition();
    cam.win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('cam:drag-end', (e) => {
    if (!cam || e.sender !== cam.win.webContents) return;
    saveCamPos(); updateOutside();
  });
  ipcMain.on('cam:action', (e, action) => {
    if (!cam || e.sender !== cam.win.webContents) return;
    const p = P();
    if (action === 'size') { const order = ['s', 'm', 'l']; settings.set({ present: { cameraSize: order[(order.indexOf(p.cameraSize) + 1) % 3] } }); resizeCam(); }
    if (action === 'shape') { settings.set({ present: { cameraShape: p.cameraShape === 'circle' ? 'rounded' : 'circle' } }); resizeCam(); }
    if (action === 'close') { closeCamera(); }
    if (action === 'size' || action === 'shape') settingsChanged();
    onChange();
  });

  async function openManual(gen) {
    if (cam && !cam.win.isDestroyed()) return { ok: true };
    if (!(await camPermission())) { notify(t('摄像头打不开'), camError('NotAllowed')); onChange(); return { ok: false }; }
    if (disposed || gen !== camGen) return { ok: false };
    if (cam && !cam.win.isDestroyed()) return { ok: true }; // 等授权期间已经被打开了
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = placeCamera(d, d.workArea);
    if (!bounds) { onChange(); return { ok: false }; }
    const c = openCamWindow(d, bounds, 'manual', null);
    // 一直没有画面（驱动卡住、虚拟摄像头不出帧）：提示并关掉
    armNoFrames(c, test ? 4000 : 10000);
    return { ok: true };
  }

  // ------------------------------------------------------------ 对外接口
  const api = {
    isDemo: () => demo, isSpot: () => spot, camOn: () => !!(cam && !cam.win.isDestroyed()),
    // 控制条「鼠标效果」按钮显示的是画面上实际有没有光圈 / 波纹（演示模式开着也算）
    recFx: () => { const c = layerCfg(); return !!(rec && (c.halo || c.clicks)); },
    setDemo(on) {
      on = !!on; if (on === demo) return;
      demo = on;
      if (on && ensureFx()) notify(t('已开启鼠标光圈和点击波纹'), t('录屏时也会显示。可以在 设置 → 演示 里调整颜色、大小，或关掉「录屏时自动显示」'));
      log('present demo', on);
      update();
    },
    setSpot(on) {
      on = !!on; if (on === spot) return; spot = on;
      log('present spotlight', on); update();
    },
    // 录屏开始 / 结束
    setRecording(info) {
      if (info) {
        const p = P();
        // 录前就开着的聚光灯，录完保持；录制中才打开的，录完自动关掉
        rec = { fx: p.withRecord && (p.halo || p.clicks), display: info.display, area: info.area, spotBefore: spot };
      } else {
        if (rec && !rec.spotBefore) spot = false;
        rec = null;
        if (cam && cam.owner === 'record') closeCamera();
        else if (cam && cam.owner === 'manual+record') {
          cam.owner = 'manual'; cam.area = null; cam.outside = false; sendCam();
          if (!cam.win.isVisible()) showCam(cam); // 录制中藏起来的（正在换摄像头）：录完显示出来
        }
      }
      update();
    },
    setRecFx(on) {
      if (!rec) return;
      if (on && ensureFx()) notify(t('已开启鼠标光圈和点击波纹'), t('可以在 设置 → 演示 里调整'));
      rec.fx = !!on;
      if (!on && demo) { demo = false; log('present demo off (from record bar)'); }
      update();
    },
    cameraForRecording,
    // 录制中 / 手动 开关摄像头
    async setCamera(on, ctx) {
      if (!on) { camGen++; closeCamera(); return { ok: true }; }
      if (cam && !cam.win.isDestroyed()) return { ok: true };
      if (ctx && ctx.display && ctx.area) return cameraForRecording(ctx.display, ctx.area);
      { const gen = camGen; return camLocked(() => (gen === camGen ? openManual(gen) : { ok: false })); }
    },

    hideForCapture, restoreAfterCapture,
    applySettings() {
      update();
      if (cam && !cam.win.isDestroyed()) {
        const p = P(); const b = cam.win.getBounds(); const { w, h } = camDims(p.cameraSize, p.cameraShape);
        if (b.width !== w || b.height !== h) resizeCam(); else sendCam();
      }
    },
    rebuild() { closeLayers(); update(); },
    status() {
      return {
        demo, spot, rec: rec && { fx: rec.fx }, layers: [...layers.values()].filter((w) => !w.isDestroyed()).map((w) => ({ displayId: w.displayId, bounds: w.getBounds(), visible: w.isVisible(), focusable: w.isFocusable() })),
        hookOn, timer: !!posTimer, hiddenForCapture, lastPatchMs,
        cam: cam && !cam.win.isDestroyed() ? { owner: cam.owner, state: cam.state, error: cam.error, bounds: cam.win.getBounds(), visible: cam.win.isVisible(), outside: cam.outside } : null,
      };
    },
    layerWindows: () => [...layers.values()],
    camWindow: () => (cam && !cam.win.isDestroyed() ? cam.win : null),
    dispose() {
      disposed = true;
      if (posTimer) { clearInterval(posTimer); posTimer = null; }
      closeLayers(); closeCamera();
      try { hotkeys.useHook('present', false); hotkeys.useHook('present-move', false); } catch {}
      if (offMove) { offMove(); offMove = null; }
      if (offClick) { offClick(); offClick = null; }
      if (axWait) { axWait(); axWait = null; }
    },
    setTestFail(name) { if (test) testFail = String(name || ''); },
    openCameraSettings() { if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'); },
  };
  return api;
}

module.exports = { createPresent, CAM_SIZES };
