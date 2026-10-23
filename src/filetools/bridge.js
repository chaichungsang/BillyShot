// 主进程这边的文件工具：动作弧、预览面板、快捷键小窗、队列、托盘进度环。
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { JobRunner } = require('./jobs');
const { ringModel, groupOf, naturalSort, imageFormat, estimateVideoBytes, LEVELS } = require('./plan');
const { placeArc, point, hitTest, HUB } = require('./arc-layout');
const { durationSeconds } = require('./video-ops');
const { ffmpegBin } = require('./ffmpeg-bin');
const image = require('./image-ops');
const { isHeic } = require('./heic');
const { decide } = require('./shift-drag-policy');
const { panelTitle } = require('./panel-title');
const { composeRing } = require('./tray-ring');

function baseName(file) { return path.basename(file || ''); }

// 动作弧 / Shift 拖接收窗的窗口层级。见 ensureArc 里的说明。
const ARC_LEVEL = 'pop-up-menu';

function contentFrame(placement, area, column) {
  const pad = 36;
  let minX = -HUB / 2, maxX = HUB / 2, minY = -HUB / 2, maxY = HUB / 2;
  placement.angles.forEach((a) => {
    const p = point(a, placement.radius);
    minX = Math.min(minX, p.x - 78);
    maxX = Math.max(maxX, p.x + 78);
    minY = Math.min(minY, p.y - 40);
    maxY = Math.max(maxY, p.y + 56);
  });
  if (column && placement.angles.length) {
    const p = point(placement.angles[placement.angles.length - 1], placement.radius);
    // 列在「改尺寸」标签基线下面，右边还要给提示留 12px。
    maxY = Math.max(maxY, p.y + 250);
    minX = Math.min(minX, p.x - 90);
    maxX = Math.max(maxX, p.x + 280);
  }
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);
  let x = Math.round(placement.hub.x + minX - pad);
  let y = Math.round(placement.hub.y + minY - pad);
  x = Math.max(area.x, Math.min(x, area.x + area.width - width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - height));
  return {
    x, y, width, height,
    hubx: placement.hub.x - x,
    huby: placement.hub.y - y,
    angles: placement.angles,
    radius: placement.radius,
  };
}

function createFileTools(deps) {
  const { BrowserWindow, ipcMain, screen, shell, dialog, Notification, nativeImage, app, settings, t, isMac, isWin, log, R, getTray, trayIcon } = deps;
  const recent = [];
  let arcWin = null;
  let panelWin = null;
  let toolsWin = null;
  let arcPayload = null;
  let panelView = null;
  let anchor = 'tray';
  let watcher = null;
  let watchWanted = false;
  let watchBackoff = 800;
  let lastProbe = { ok: true, permission: 'none' };
  let trayBase = null;
  let trayTimer = null;
  let runStamp = { sig: '', at: 0 };
  // Shift 拖：松手（helper 的 up）和松手落下的 drop 是两条路，谁先到不一定。
  // up 先到时不能马上把接收窗收起来，否则 drop 落不进来；等一小会儿，没 drop 再收。
  let catching = false;
  let upTimer = null;

  const runner = new JobRunner({
    onUpdate: (job, info) => onJob(job, info || {}),
  });

  function revealLabel() { return isMac ? '在 Finder 中显示' : '在资源管理器中显示'; }

  async function inspect(files) {
    const list = (files || []).filter(Boolean);
    const group = groupOf(list);
    let width = null, height = null, duration = null, warning = '';
    if (group === 'image') {
      try {
        const m = await image.meta(list[0]);
        width = m.width; height = m.height;
      } catch (e) {
        if (e && (e.code === 'HEIC_UNSUPPORTED' || isHeic(list[0]))) warning = e.message;
      }
    } else if (group === 'video') {
      try { duration = await durationSeconds(ffmpegBin(), list[0]); } catch { duration = null; }
    }
    const model = ringModel({ files: list, duration, width });
    return { files: list, model, width, height, duration, warning, format: imageFormat(list[0] || '') };
  }

  function badgeOf(info) {
    if (!info || !info.model) return '';
    if (info.model.group === 'pdf') return info.files.length > 1 ? String(info.files.length) : 'PDF';
    if (info.model.group === 'video') return (path.extname(info.files[0] || '').slice(1) || 'mov').toUpperCase();
    return (imageFormat(info.files[0] || '') || 'png').toUpperCase();
  }
  function subOf(info) {
    if (!info || !info.model) return '';
    if (info.model.group === 'image' && info.width) return '宽 ' + info.width;
    if (info.model.group === 'pdf') return info.files.length + ' 个文件';
    if (info.duration) {
      const s = Math.round(info.duration);
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    return '';
  }

  function ensureArc() {
    if (arcWin && !arcWin.isDestroyed()) return arcWin;
    arcWin = new BrowserWindow({
      width: 480, height: 520, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, movable: false, skipTaskbar: true, focusable: true, showInactive: true,
      alwaysOnTop: true, fullscreenable: false,
      webPreferences: { preload: R('preload.js'), spellcheck: false },
    });
    // 层级必须低于系统拖放图标的层级（kCGDraggingWindowLevel = 500）。
    // 'screen-saver'（1000）比它高，macOS 不会把拖放交给这个窗口，Shift 拖松手时文件直接落到下面的 Finder。
    // 'pop-up-menu'（101）仍然盖在普通窗口和浮动面板上面。
    try { arcWin.setAlwaysOnTop(true, ARC_LEVEL); } catch {}
    try { arcWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    arcWin.setMenu(null);
    arcWin.loadFile(R('renderer', 'arc.html'));
    arcWin.on('closed', () => { arcWin = null; arcPayload = null; pendingCatch = null; });
    arcWin.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closeArc(); }
    });
    return arcWin;
  }

  function sendArc() {
    if (!arcWin || arcWin.isDestroyed() || !arcPayload) return;
    const push = () => { try { arcWin.webContents.send('filetools:arc', arcPayload); } catch {} };
    if (arcWin.webContents.isLoading()) arcWin.webContents.once('did-finish-load', push);
    else push();
  }

  function closeArc() {
    arcPayload = null;
    if (arcWin && !arcWin.isDestroyed()) arcWin.hide();
  }

  async function showArc(files, how, cursor) {
    anchor = how || 'tray';
    const info = await inspect(files);
    if (!info.model) { closeArc(); return info; }
    const pt = cursor || screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    const placement = placeArc({ cursor: pt, workArea: area, count: info.model.keys.length, anchor: anchor === 'tray' ? 'tray' : undefined });
    const frame = contentFrame(placement, area, info.model.group === 'image');
    const win = ensureArc();
    win.setBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    arcPayload = {
      files: info.files, model: info.model, hubx: frame.hubx, huby: frame.huby,
      angles: frame.angles, radius: frame.radius, badge: badgeOf(info), sub: subOf(info), warning: info.warning,
    };
    if (!win.isVisible()) win.showInactive();
    sendArc();
    return info;
  }

  let pendingCatch = null; // 窗口加载完要发的接收圈位置（只留最新的）
  function showCatcher(how, cursor) {
    anchor = how || 'shift';
    const pt = cursor || screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    const placement = placeArc({ cursor: pt, workArea: area, count: 3, anchor: how === 'tray' ? 'tray' : undefined });
    const frame = contentFrame(placement, area, true);
    const win = ensureArc();
    win.setBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    // 接收窗：旧的弧不算数，drop 进来一律按「还没画弧」处理（主进程收到后再画）。
    // 渲染端画一个能接住 drop 的小圈（完全透明的像素在 macOS 上会让拖放穿过去）。
    arcPayload = null;
    const catchMsg = { hubx: frame.hubx, huby: frame.huby };
    // 冷启动时窗口还在加载，helper 每次 move 都会走到这里。只挂一个 did-finish-load，
    // 加载完只发最新的位置（以前每次 move 挂一个，十几个之后 Node 报 MaxListenersExceededWarning）。
    if (win.webContents.isLoading()) {
      const first = !pendingCatch;
      pendingCatch = catchMsg;
      if (first) {
        win.webContents.once('did-finish-load', () => {
          const m = pendingCatch;
          pendingCatch = null;
          if (m) { try { win.webContents.send('filetools:catch', m); } catch {} }
        });
      }
    } else {
      pendingCatch = null;
      try { win.webContents.send('filetools:catch', catchMsg); } catch {}
    }
    if (!win.isVisible()) win.showInactive();
  }

  const DROP_GRACE_MS = 700;
  function clearUpTimer() { if (upTimer) { clearTimeout(upTimer); upTimer = null; } }

  // ShiftDrag helper 的一行消息。单独拿出来，测试可以直接喂。
  function onHelperMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      lastProbe = { ok: msg.ok !== false, permission: msg.permission || 'none', needsPermission: !!msg.needsPermission };
    } else if (msg.type === 'shift-drag' || msg.type === 'move') {
      clearUpTimer();
      catching = true;
      showCatcher('shift', { x: msg.x, y: msg.y });
    } else if (msg.type === 'up') {
      if (!catching) return;
      clearUpTimer();
      upTimer = setTimeout(() => {
        upTimer = null;
        if (catching) { catching = false; closeArc(); }
      }, DROP_GRACE_MS);
    } else if (msg.type === 'shift-up') {
      if (!catching) return;
      clearUpTimer();
      catching = false;
      closeArc();
    }
  }

  // 面板窗口无边框、透明，只有自绘的 ×（没有假的红绿灯）。
  // 窗口高度跟着内容走：渲染端画完报 filetools:panel-size，主进程改窗口高度并刷新阴影。
  // 以前窗口固定 520 高，macOS 按旧内容算出的阴影会在面板下面留一条空的深色条。
  const PANEL_W = 500;
  const PANEL_MIN_H = 120;
  const PANEL_MAX_H = 720;
  let panelShowTimer = null;
  function ensurePanel() {
    if (panelWin && !panelWin.isDestroyed()) return panelWin;
    panelWin = new BrowserWindow({
      width: PANEL_W, height: 300, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
      // macOS：面板不在前台时，第一下点 × 或按钮就生效，不是只把窗口激活。
      acceptFirstMouse: true,
      webPreferences: { preload: R('preload.js'), spellcheck: false },
    });
    panelWin.setMenu(null);
    panelWin.loadFile(R('renderer', 'filepanel.html'));
    panelWin.on('close', (e) => {
      if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); }
    });
    return panelWin;
  }

  function showPanelNow() {
    if (panelShowTimer) { clearTimeout(panelShowTimer); panelShowTimer = null; }
    if (panelWin && !panelWin.isDestroyed() && !panelWin.isVisible()) panelWin.show();
  }

  function fitPanel(height) {
    if (!panelWin || panelWin.isDestroyed()) return;
    const h = Math.round(Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, Number(height) || 0)));
    const cur = panelWin.getContentSize ? panelWin.getContentSize() : [PANEL_W, 0];
    if (cur[1] !== h || cur[0] !== PANEL_W) panelWin.setContentSize(PANEL_W, h);
    if (isMac && typeof panelWin.invalidateShadow === 'function') panelWin.invalidateShadow();
  }

  function sendPanel(view) {
    const kindAction = { 'compress-image': 'image.compress', 'compress-video': 'video.compress', trim: 'video.trim', resize: 'image.resize' };
    let action = view.action;
    if (!action && view.kind && kindAction[view.kind]) action = kindAction[view.kind];
    else if (!action && typeof view.kind === 'string' && view.kind.includes('.')) action = view.kind;
    view = Object.assign({}, view, action ? { action } : {});
    view.title = panelTitle(view);
    panelView = view;
    const win = ensurePanel();
    const push = () => { try { win.webContents.send('filetools:panel', view); } catch {} };
    // 先让渲染端画好并报高度，再显示；渲染端没回话也最多等 250 ms。
    if (!win.isVisible() && !panelShowTimer) panelShowTimer = setTimeout(showPanelNow, 250);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', push);
    else push();
  }

  // 文件工具小窗。macOS：和面板一样无边框，没有系统红绿灯（以前 hiddenInset 的灰色绿灯压在标题上），
  // 顶栏只有标题和自绘的 ×，Esc 关闭；不在前台时第一下点击就生效（acceptFirstMouse）。
  // Windows：用系统标题栏（标题和关闭按钮在内容上方，不会压住内容），渲染端不画自己的顶栏。
  function toolsWindowOptions() {
    return {
      width: 400, height: 360, show: false, title: t('文件工具'),
      frame: !isMac, transparent: !!isMac, backgroundColor: isMac ? '#00000000' : '#161514',
      ...(isMac ? { hasShadow: true } : { titleBarStyle: 'default' }),
      acceptFirstMouse: true,
      autoHideMenuBar: true, resizable: false, fullscreenable: false,
      webPreferences: { preload: R('preload.js'), spellcheck: false },
    };
  }

  function ensureTools() {
    if (toolsWin && !toolsWin.isDestroyed()) return toolsWin;
    toolsWin = new BrowserWindow(toolsWindowOptions());
    toolsWin.setMenu(null);
    toolsWin.loadFile(R('renderer', 'filetools.html'));
    toolsWin.on('closed', () => { toolsWin = null; });
    return toolsWin;
  }

  function sendTools(extra) {
    const win = ensureTools();
    let hotkey = '';
    try { hotkey = ((settings.get().hotkeys || {}).fileTools || {}).keyboard || ''; } catch {}
    const payload = Object.assign({ platform: process.platform, recent: recent.slice(0, 8), hotkey }, extra || {});
    const push = () => { try { win.webContents.send('filetools:window', payload); } catch {} };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', push);
    else push();
  }

  function openWindow() {
    const win = ensureTools();
    sendTools({});
    win.show();
    win.focus();
  }

  function videoEstimate(action, options, duration) {
    if (!duration) return null;
    if (action === 'video.mp4') return estimateVideoBytes('8M', duration);
    if (action === 'video.compress') {
      const level = LEVELS[(options && options.level) || 'medium'] || LEVELS.medium;
      return estimateVideoBytes(level.bitrate, duration);
    }
    return null;
  }

  function durationEstimate(action, options, duration) {
    const bytes = videoEstimate(action, options, duration);
    if (!(Number.isFinite(bytes) && bytes > 0)) return { estimateBytes: null, estimateFromDuration: false };
    return { estimateBytes: bytes, estimateFromDuration: true };
  }

  async function openSetup(msg) {
    const info = await inspect(msg.files || []);
    let disk = '';
    let blocked = false;
    try {
      const action = msg.kind === 'compress-image' ? 'image.compress'
        : msg.kind === 'compress-video' ? 'video.compress'
          : msg.kind === 'resize' ? 'image.resize'
            : msg.gif ? 'video.gif' : 'video.trim';
      const planned = runner.plan({ action, inputs: info.files, options: msg.gif ? { start: 0, end: 15 } : {} });
      const need = videoEstimate(action, { level: 'medium' }, info.duration) || 0;
      const free = runner.checkDisk(planned.finalPath, need);
      if (!free.ok) { blocked = true; disk = free.message; }
    } catch { /* 还没开始，路径算不出来就先不拦 */ }
    sendPanel({
      kind: msg.kind, gif: !!msg.gif, confirm: msg.confirm || '',
      start: msg.start, end: msg.end, files: info.files,
      names: info.files.map(baseName), width: info.width, height: info.height,
      duration: info.duration, format: info.format, quality: 72, level: 'medium', lock: true,
      blocked, disk, phase: 'setup',
      ...(msg.kind === 'compress-video'
        ? durationEstimate('video.compress', { level: 'medium' }, info.duration)
        : { estimateBytes: null, estimateFromDuration: false }),
    });
    closeArc();
  }

  function once(sig) {
    const now = Date.now();
    if (runStamp.sig === sig && now - runStamp.at < 600) return false;
    runStamp = { sig, at: now };
    return true;
  }

  function startFrom(msg) {
    let files = (msg.files || []).slice();
    const action = msg.action;
    if (!action || !files.length) return;
    if (action === 'pdf.make') files = naturalSort(files);
    const options = msg.options || {};
    if (!once(action + '|' + files.join('|') + '|' + JSON.stringify(options))) return;
    const duration = msg.duration != null ? msg.duration : (panelView && panelView.duration);
    let job;
    try {
      const need = videoEstimate(action, options, duration) || 0;
      job = runner.start({ action, inputs: files, options, needBytes: need });
    } catch (e) {
      sendPanel({ phase: 'error', message: e.message, files, names: files.map(baseName) });
      closeArc();
      return;
    }
    const est = (action === 'video.compress' || action === 'video.mp4')
      ? durationEstimate(action, options, duration)
      : { estimateBytes: null, estimateFromDuration: false };
    sendPanel({
      id: job.id, phase: job.state === 'queued' ? 'queued' : 'running',
      indeterminate: job.state !== 'queued',
      files, names: files.map(baseName), kind: action,
      level: options.level || (panelView && panelView.level) || '',
      ...est,
    });
    closeArc();
  }

  function runKey(key, files) {
    if (!key) return;
    if (key.action === 'video.gif' && key.route === 'trim') {
      openSetup({ files, kind: 'trim', gif: true, start: 0, end: 15, confirm: key.confirm || '剪切并转 GIF' });
      return;
    }
    if (key.grey && key.action !== 'video.gif') return;
    if (key.action === 'image.compress') { openSetup({ files, kind: 'compress-image' }); return; }
    if (key.action === 'video.compress') { openSetup({ files, kind: 'compress-video' }); return; }
    if (key.action === 'video.trim') { openSetup({ files, kind: 'trim' }); return; }
    if (key.action === 'image.resize' || key.action === 'image.convert') return;
    startFrom({ action: key.action, files, options: {} });
  }

  function onJob(job, info) {
    const state = info.state || job.state;
    if (panelView && panelView.id === job.id) {
      if (state === 'running') {
        const p = info.progress || {};
        sendPanel(Object.assign({}, panelView, {
          phase: 'running', id: job.id,
          ratio: p.ratio, indeterminate: !p || p.indeterminate || p.ratio == null,
        }));
      } else if (state === 'queued') sendPanel(Object.assign({}, panelView, { phase: 'queued', id: job.id }));
      else if (state === 'error') sendPanel(Object.assign({}, panelView, { phase: 'error', message: info.message || job.message }));
      else if (state === 'cancelled') { if (panelWin && !panelWin.isDestroyed()) panelWin.hide(); }
    }
    if (state === 'running' && info.progress) paintTray(info.progress.indeterminate ? null : info.progress.ratio, !!info.progress.indeterminate);
    if (state === 'done') finishJob(job, info);
    if (state === 'error' || state === 'cancelled' || state === 'done') restoreTraySoon();
    sendTools({});
  }

  function finishJob(job, info) {
    const file = info.file || job.finalPath;
    let bytes = info.bytes;
    if (!(bytes >= 0)) { try { bytes = fs.statSync(file).size; } catch { bytes = null; } }
    recent.unshift({ file, name: baseName(file), bytes, reveal: revealLabel() });
    if (recent.length > 8) recent.pop();
    flashTray();
    const panelOpen = panelWin && !panelWin.isDestroyed() && panelWin.isVisible();
    const showDone = () => sendPanel({
      phase: 'done', action: job.action, file, fileName: baseName(file),
      bytes: Number.isFinite(bytes) ? bytes : null,
      measured: Number.isFinite(bytes),
      revealLabel: revealLabel(), files: job.inputs,
    });
    let notified = false;
    try {
      if (!Notification || !Notification.isSupported()) throw new Error('unsupported');
      const n = new Notification({ title: t('完成'), body: baseName(file) });
      n.on('click', () => { try { shell.showItemInFolder(file); } catch {} });
      n.show();
      notified = true;
    } catch (e) { log('filetools notify', e.message); }
    if (panelOpen || !notified) showDone();
  }

  async function paintTray(ratio, indeterminate) {
    const tray = getTray && getTray();
    if (!tray || tray.isDestroyed() || !nativeImage) return;
    try {
      if (!trayBase) trayBase = trayIcon();
      // 每个缩放倍数各画一张（Windows 125% / 150% 用 tray@1.25x / @1.5x），环按那张 PNG 的像素尺寸画。
      const factors = (trayBase.getScaleFactors && trayBase.getScaleFactors()) || [1];
      const out = nativeImage.createEmpty();
      for (const scaleFactor of (factors.length ? factors : [1])) {
        const base = trayBase.toPNG({ scaleFactor });
        const buffer = await composeRing(base, ratio == null ? 0.3 : ratio, indeterminate || ratio == null);
        out.addRepresentation({ scaleFactor, buffer });
      }
      if (!tray.isDestroyed()) tray.setImage(out);
    } catch (e) { log('tray ring', e.message); }
  }

  function restoreTraySoon() {
    clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
      const tray = getTray && getTray();
      if (tray && trayBase && !tray.isDestroyed()) { try { tray.setImage(trayBase); } catch {} }
    }, 700);
  }

  function flashTray() { paintTray(1, false); restoreTraySoon(); }

  function attachTray(tray) {
    if (!isMac || !tray) return;
    let timer = null;
    tray.on('drag-enter', () => {
      clearTimeout(timer);
      timer = setTimeout(() => showCatcher('tray', trayPoint(tray)), 250);
    });
    tray.on('drag-leave', () => clearTimeout(timer));
    tray.on('drag-end', () => clearTimeout(timer));
    tray.on('drop-files', (_e, files) => {
      clearTimeout(timer);
      showArc(files, 'tray', trayPoint(tray));
    });
    tray.on('drop-text', () => clearTimeout(timer));
  }

  function trayPoint(tray) {
    try {
      const b = tray.getBounds();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height + 8) };
    } catch { return screen.getCursorScreenPoint(); }
  }

  function stopWatch() {
    if (watcher) { try { watcher.kill(); } catch {} watcher = null; }
  }

  function outsideAsar(p) {
    return p.replace(/app\.asar(?=$|\/|\\)/, 'app.asar.unpacked');
  }

  function scheduleWatch() {
    const wait = watchBackoff;
    watchBackoff = Math.min(watchBackoff * 2, 15000);
    setTimeout(() => { if (watchWanted && !watcher) startWatch(); }, wait);
  }

  function startWatch() {
    if (!isMac || watcher || !watchWanted) return;
    const root = outsideAsar(path.join(R('..'), 'native', 'mac'));
    const bin = path.join(root, 'ShiftDrag');
    // 默认只跑编译好的 Swift helper。没有它时不退回 osascript；托盘拖放和快捷键仍然可用。
    if (!fs.existsSync(bin)) {
      log('shift-drag helper missing');
      lastProbe = { ok: false, permission: 'none' };
      return;
    }
    try {
      watcher = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      log('shift-drag spawn', e.message);
      watcher = null;
      lastProbe = { ok: false };
      scheduleWatch();
      return;
    }
    watchBackoff = 800;
    let buf = '';
    watcher.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        onHelperMessage(msg);
      }
    });
    watcher.on('exit', () => {
      watcher = null;
      if (watchWanted) scheduleWatch();
    });
  }

  function syncShiftDrag() {
    if (!isMac) return;
    const ft = (settings.get().fileTools) || {};
    const choice = decide(ft, lastProbe);
    // v1 不弹权限页（07 只是备用）。策略函数仍保留「暂不」，这里只在确定不需要权限时启动。
    if (choice.action === 'start' && !choice.prompt) {
      watchWanted = true;
      startWatch();
    } else {
      watchWanted = false;
      stopWatch();
    }
  }

  ipcMain.on('filetools:run', (_e, msg) => startFrom(msg || {}));
  ipcMain.on('filetools:panel', (_e, msg) => openSetup(msg || {}));
  ipcMain.on('filetools:close-arc', () => closeArc());
  ipcMain.on('filetools:panel-size', (e, msg) => {
    if (!panelWin || panelWin.isDestroyed() || (e && e.sender && e.sender !== panelWin.webContents)) return;
    fitPanel(msg && msg.height);
    if (panelShowTimer) showPanelNow();
  });
  ipcMain.on('filetools:close-panel', () => { if (panelWin && !panelWin.isDestroyed()) panelWin.hide(); });
  ipcMain.on('filetools:close-window', () => { if (toolsWin && !toolsWin.isDestroyed()) toolsWin.close(); });
  ipcMain.on('filetools:cancel', () => {
    if (panelView && panelView.id) runner.cancel(panelView.id);
    else if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
  });
  ipcMain.on('filetools:reveal', (_e, msg) => { if (msg && msg.file) shell.showItemInFolder(msg.file); });
  ipcMain.on('filetools:pick', async () => {
    const win = toolsWin && !toolsWin.isDestroyed() ? toolsWin : undefined;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return;
    const info = await inspect(r.filePaths);
    sendTools({ files: info.files, model: info.model, names: info.files.map(baseName), warning: info.warning || (info.model ? '' : '没有可处理的文件') });
  });
  ipcMain.on('filetools:inspect', async (_e, msg) => {
    const info = await inspect((msg && msg.files) || []);
    sendTools({ files: info.files, model: info.model, names: info.files.map(baseName), warning: info.warning || (info.model ? '' : '没有可处理的文件') });
  });
  ipcMain.on('filetools:drop', (_e, msg) => {
    const files = (msg && msg.files) || [];
    if (catching) { catching = false; clearUpTimer(); }
    if (!arcPayload || !arcPayload.model) { showArc(files, anchor, screen.getCursorScreenPoint()); return; }
    const hit = hitTest(msg.dx || 0, msg.dy || 0, msg.angles || arcPayload.angles || []);
    if (hit.zone === 'key') runKey(arcPayload.model.keys[hit.index], files.length ? files : arcPayload.files);
    else if (hit.zone === 'outside' || hit.zone === 'cancel') closeArc();
  });
  ipcMain.on('filetools:estimate', async (_e, msg) => {
    try {
      if (!panelView) return;
      if (panelView.action === 'video.compress' || panelView.kind === 'compress-video') {
        const level = (msg && msg.level) || panelView.level || 'medium';
        sendPanel(Object.assign({}, panelView, { level }, durationEstimate('video.compress', { level }, panelView.duration)));
        return;
      }
      const file = panelView.files && panelView.files[0];
      if (!file) return;
      const n = await image.estimateCompress(file, msg && msg.quality);
      const computed = Number.isFinite(n) && n > 0;
      if (panelView) sendPanel(Object.assign({}, panelView, {
        estimateBytes: computed ? n : null,
        estimateFromDuration: false,
        estimateComputed: computed,
      }));
    } catch { /* 估不出来就不写数字 */ }
  });

  return {
    openWindow,
    setRecording: (on) => runner.setRecording(!!on),
    attachTray,
    syncShiftDrag,
    dispose: () => { clearUpTimer(); if (panelShowTimer) { clearTimeout(panelShowTimer); panelShowTimer = null; } runner.dispose(); stopWatch(); closeArc(); },
    helperMessage: onHelperMessage,
    recent: () => recent.slice(),
    refreshLanguage() {
      if (toolsWin && !toolsWin.isDestroyed()) toolsWin.loadFile(R('renderer', 'filetools.html'));
      if (panelWin && !panelWin.isDestroyed()) panelWin.loadFile(R('renderer', 'filepanel.html'));
      if (arcWin && !arcWin.isDestroyed()) arcWin.loadFile(R('renderer', 'arc.html'));
    },
  };
}

module.exports = { createFileTools, contentFrame, ARC_LEVEL };
