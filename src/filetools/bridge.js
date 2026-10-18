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
const { ringPng } = require('./tray-ring');

function baseName(file) { return path.basename(file || ''); }

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
    maxY = Math.max(maxY, p.y + 210);
    minX = Math.min(minX, p.x - 80);
    maxX = Math.max(maxX, p.x + 80);
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
  let lastProbe = { ok: true, permission: 'none' };
  let trayBase = null;
  let trayTimer = null;
  let runStamp = { sig: '', at: 0 };

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
    try { arcWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { arcWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    arcWin.setMenu(null);
    arcWin.loadFile(R('renderer', 'arc.html'));
    arcWin.on('closed', () => { arcWin = null; arcPayload = null; });
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

  function showCatcher(how, cursor) {
    anchor = how || 'shift';
    const pt = cursor || screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    const placement = placeArc({ cursor: pt, workArea: area, count: 3, anchor: how === 'tray' ? 'tray' : undefined });
    const frame = contentFrame(placement, area, true);
    const win = ensureArc();
    win.setBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    if (!win.isVisible()) win.showInactive();
  }

  function ensurePanel() {
    if (panelWin && !panelWin.isDestroyed()) return panelWin;
    panelWin = new BrowserWindow({
      width: 500, height: 520, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
      webPreferences: { preload: R('preload.js'), spellcheck: false },
    });
    panelWin.setMenu(null);
    panelWin.loadFile(R('renderer', 'filepanel.html'));
    panelWin.on('close', (e) => {
      if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); }
    });
    return panelWin;
  }

  function sendPanel(view) {
    panelView = view;
    const win = ensurePanel();
    const push = () => { try { win.webContents.send('filetools:panel', view); } catch {} };
    if (!win.isVisible()) win.show();
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', push);
    else push();
  }

  function ensureTools() {
    if (toolsWin && !toolsWin.isDestroyed()) return toolsWin;
    toolsWin = new BrowserWindow({
      width: 400, height: 360, show: false, title: t('文件工具'),
      frame: !isMac, transparent: !!isMac, backgroundColor: isMac ? '#00000000' : '#161514',
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      autoHideMenuBar: true, resizable: false, fullscreenable: false,
      webPreferences: { preload: R('preload.js'), spellcheck: false },
    });
    toolsWin.setMenu(null);
    toolsWin.loadFile(R('renderer', 'filetools.html'));
    toolsWin.on('closed', () => { toolsWin = null; });
    return toolsWin;
  }

  function sendTools(extra) {
    const win = ensureTools();
    const payload = Object.assign({ platform: process.platform, recent: recent.slice(0, 8) }, extra || {});
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
      estimateBytes: msg.kind === 'compress-video' ? videoEstimate('video.compress', { level: 'medium' }, info.duration) : null,
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
    let job;
    try {
      const need = videoEstimate(action, options, msg.duration) || 0;
      job = runner.start({ action, inputs: files, options, needBytes: need });
    } catch (e) {
      sendPanel({ phase: 'error', message: e.message, files, names: files.map(baseName) });
      closeArc();
      return;
    }
    sendPanel({
      id: job.id, phase: job.state === 'queued' ? 'queued' : 'running',
      indeterminate: job.state !== 'queued',
      files, names: files.map(baseName), kind: action,
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
      phase: 'done', file, fileName: baseName(file),
      bytes: Number.isFinite(bytes) ? bytes : null,
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
      const size = trayBase.getSize();
      const png = await ringPng(Math.max(size.width, size.height, 18), ratio == null ? 0.3 : ratio, indeterminate || ratio == null);
      const base = trayBase.toPNG();
      const sharp = require('sharp');
      const composed = await sharp(base).composite([{ input: png }]).png().toBuffer();
      tray.setImage(nativeImage.createFromBuffer(composed));
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

  function startWatch() {
    if (!isMac || watcher) return;
    const root = outsideAsar(path.join(R('..'), 'native', 'mac'));
    const bin = path.join(root, 'ShiftDrag');
    const jxa = path.join(root, 'shift-drag.jxa.js');
    const cmd = fs.existsSync(bin) ? bin : 'osascript';
    const args = fs.existsSync(bin) ? [] : ['-l', 'JavaScript', jxa];
    try {
      watcher = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { log('shift-drag spawn', e.message); lastProbe = { ok: false }; return; }
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
        if (msg.type === 'ready') lastProbe = { ok: msg.ok !== false, permission: msg.permission || 'none', needsPermission: !!msg.needsPermission };
        else if (msg.type === 'shift-drag' || msg.type === 'move') showCatcher('shift', { x: msg.x, y: msg.y });
        else if (msg.type === 'shift-up') closeArc();
      }
    });
    watcher.on('exit', () => { watcher = null; });
  }

  function syncShiftDrag() {
    if (!isMac) return;
    const ft = (settings.get().fileTools) || {};
    const choice = decide(ft, lastProbe);
    // v1 不弹权限页（07 只是备用）。策略函数仍保留「暂不」，这里只在确定不需要权限时启动。
    if (choice.action === 'start' && !choice.prompt) startWatch();
    else stopWatch();
  }

  ipcMain.on('filetools:run', (_e, msg) => startFrom(msg || {}));
  ipcMain.on('filetools:panel', (_e, msg) => openSetup(msg || {}));
  ipcMain.on('filetools:close-arc', () => closeArc());
  ipcMain.on('filetools:close-panel', () => { if (panelWin && !panelWin.isDestroyed()) panelWin.hide(); });
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
    if (!arcPayload || !arcPayload.model) { showArc(files, anchor, screen.getCursorScreenPoint()); return; }
    const hit = hitTest(msg.dx || 0, msg.dy || 0, msg.angles || arcPayload.angles || []);
    if (hit.zone === 'key') runKey(arcPayload.model.keys[hit.index], files.length ? files : arcPayload.files);
    else if (hit.zone === 'outside' || hit.zone === 'cancel') closeArc();
  });
  ipcMain.on('filetools:estimate', async (_e, msg) => {
    try {
      const file = panelView && panelView.files && panelView.files[0];
      if (!file) return;
      const n = await image.estimateCompress(file, msg && msg.quality);
      if (panelView) sendPanel(Object.assign({}, panelView, { estimateBytes: n }));
    } catch { /* 估不出来就不写数字 */ }
  });

  return {
    openWindow,
    setRecording: (on) => runner.setRecording(!!on),
    attachTray,
    syncShiftDrag,
    dispose: () => { runner.dispose(); stopWatch(); closeArc(); },
    recent: () => recent.slice(),
    refreshLanguage() {
      if (toolsWin && !toolsWin.isDestroyed()) toolsWin.loadFile(R('renderer', 'filetools.html'));
      if (panelWin && !panelWin.isDestroyed()) panelWin.loadFile(R('renderer', 'filepanel.html'));
      if (arcWin && !arcWin.isDestroyed()) arcWin.loadFile(R('renderer', 'arc.html'));
    },
  };
}

module.exports = { createFileTools, contentFrame };
