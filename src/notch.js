// Mac notch / no-notch pill. Windows never constructs this (see enabledOn).
//
// Capture exclusion
// ----------------
// Recording does not call ScreenCaptureKit itself. src/renderer/recorder.js
// asks Chromium for a desktop stream:
//   getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop',
//     chromeMediaSourceId } } })
// with the id from desktopCapturer.getSources. On macOS that path is
// ScreenCaptureKit inside Electron 44 (ScreenCaptureKitDeviceMac). System
// audio uses getDisplayMedia and drops the video track; it does not record
// pixels. Stills go through node-screenshots (CoreGraphics / SCK), with
// desktopCapturer as the fallback in src/capture.js.
//
// Chromium builds the SCContentFilter. There is no JS hook to pass
// excludingWindows. Electron's own capturer skips windows whose NSWindow
// sharingType is NSWindowSharingNone when ScreenCaptureKit is the capturer
// (electron#34362), which is the in-process form of that filter. The public
// Electron call is setContentProtection(true). In Electron 44.5.1 that sets
// sharingType to NSWindowSharingNone (native_window_mac.mm) and nothing else.
//
// Every notch, chin, hover and pill window is protected at creation, again
// on show, and again when a recording begins — before getUserMedia. Nothing
// in here ever clears it. syncDemoBarCapture may still unprotect the
// recording bar when that setting is on; it does not see these windows.
// protect() for the region frame is unchanged.
//
// Apple DTS (2025) says there is no public API that stops *other apps'*
// ScreenCaptureKit captures on macOS 15.4+. Private CGS exclusion is not
// used. The checklist item "the recording contains no notch UI" is the
// check that our own capturer honoured sharingType.
//
// Geometry: src/notch-geom.js reads NSScreen auxiliary areas and
// safeAreaInsets via osascript. Fallback width is 185pt, and only if that
// read fails. The timer defaults to a chin because a 78pt right ear cannot
// be proved clear of status items.
'use strict';

const { ipcMain } = require('electron');
const L = require('./notch-logic');
const { probeScreens } = require('./notch-geom');

let active = null;
let ipcBound = false;

function bindIpc() {
  if (ipcBound) return;
  ipcBound = true;
  const fromHere = (e) => active && e && e.sender && active.owns(e.sender);
  ipcMain.on('notch:cmd', (e, id) => { if (fromHere(e)) active.onCommand(id); });
  ipcMain.on('notch:press', (e) => { if (fromHere(e)) active.press(); });
  ipcMain.on('notch:collapse', (e) => { if (fromHere(e)) active.collapse(); });
}

function createNotch(deps) {
  if (!L.enabledOn(process.platform)) return null;
  const { screen, BrowserWindow, log, R, protect, onCmd, timerPreference } = deps;
  bindIpc();

  const wins = {};
  const lastSent = {};
  let notches = [];
  let probed = false;
  let recording = null;
  let hoverOpen = false;
  let stopOpen = false;
  let items = [];
  let liveKind = null;
  let closing = null;
  const dwell = L.createDwell(L.SPEC.dwellMs);
  let poll = null;
  let clock = null;
  let geomTimer = null;
  let geomToken = 0;

  function note(...args) { try { if (log) log(...args); } catch {} }

  function preference() {
    let saved = '';
    try { saved = timerPreference ? timerPreference() : ''; } catch {}
    return L.timerPlacement(L.readTimerPreference(process.env.BILLYSHOT_NOTCH_TIMER, saved));
  }

  function displaysNow() {
    let all = [];
    let primaryId = null;
    try { all = screen.getAllDisplays() || []; } catch {}
    try { primaryId = screen.getPrimaryDisplay().id; } catch {}
    return all.map((d) => ({
      id: d.id, internal: !!d.internal, primary: d.id === primaryId, label: d.label || '',
      bounds: d.bounds, workArea: d.workArea,
    }));
  }

  function shield(win) {
    if (!win || win.isDestroyed()) return;
    try { if (protect) protect(win); } catch {}
    try { win.setContentProtection(true); } catch {}
  }

  function shieldAll() {
    for (const w of Object.values(wins)) shield(w);
  }

  function ensure(role) {
    const cur = wins[role];
    if (cur && !cur.isDestroyed()) return cur;
    const win = new BrowserWindow({
      x: 0, y: -40, width: 120, height: 32, show: false,
      frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false,
      focusable: role === 'panel' || role === 'pill',
      acceptFirstMouse: true, alwaysOnTop: true, roundedCorners: false,
      enableLargerThanScreen: true, type: 'panel',
      webPreferences: { preload: R('preload.js'), backgroundThrottling: false },
    });
    // screen-saver sits above the menu bar and full-screen apps. The same
    // level the region frame already uses. pop-up-menu alone can land behind
    // a full-screen space on recent macOS.
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    try { if (win.setHiddenInMissionControl) win.setHiddenInMissionControl(true); } catch {}
    try { win.setWindowButtonVisibility(false); } catch {}
    shield(win);
    win.on('show', () => shield(win));
    win.loadFile(R('renderer', 'notch.html'), { query: { role } });
    win.webContents.on('did-finish-load', () => { lastSent[role] = ''; push(); });
    wins[role] = win;
    return win;
  }

  function place(win, bounds, opts) {
    if (!win || win.isDestroyed()) return;
    const show = !!(opts && opts.show) && bounds && bounds.width >= 2 && bounds.height >= 2;
    if (!show) {
      try { if (win.isVisible()) win.hide(); } catch {}
      return;
    }
    try {
      const cur = win.getBounds();
      if (cur.x !== bounds.x || cur.y !== bounds.y || cur.width !== bounds.width || cur.height !== bounds.height) {
        win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
      }
    } catch {}
    try {
      if (opts.ignore) win.setIgnoreMouseEvents(true, { forward: true });
      else win.setIgnoreMouseEvents(false);
    } catch {}
    if (!win.isVisible()) {
      try { win.showInactive(); } catch {}
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
      shield(win);
    }
  }

  function elapsedNow() {
    if (!recording) return 0;
    if (recording.frozen != null) return recording.frozen;
    if (recording.startedAt == null) return 0;
    return Math.max(0, Date.now() - recording.startedAt);
  }

  function targetNow() {
    if (!recording) return null;
    return L.statusTarget({
      display: recording.coversAll ? null : recording.display,
      notches,
      displays: displaysNow(),
      coversAll: !!recording.coversAll,
    });
  }

  function panelView(kind) {
    if (kind) {
      const first = liveKind !== kind;
      liveKind = kind;
      closing = null;
      return { show: true, kind, motion: first ? 'in' : '', ignore: false };
    }
    if (liveKind) {
      closing = { kind: liveKind, until: Date.now() + Math.round(L.SPEC.closeSpring.response * 1000) };
      liveKind = null;
    }
    if (closing && Date.now() < closing.until) {
      return { show: true, kind: closing.kind, motion: 'out', ignore: true };
    }
    closing = null;
    return { show: false, kind: null, motion: '', ignore: true };
  }

  function scene() {
    const placement = preference();
    const notch = L.primaryNotch(notches);
    const target = targetNow();
    const onNotch = !!(target && target.kind === 'notch');
    const kind = (!recording && hoverOpen && notch) ? 'hover' : (onNotch && stopOpen ? 'stop' : null);
    const panel = panelView(kind);
    const chinOn = onNotch && placement === 'chin' && !!recording && panel.kind !== 'stop';
    const ears = onNotch && !!recording;
    const hitNotch = ears ? target.notch : notch;
    const hit = hitNotch ? L.hitBounds(hitNotch, { recording: ears, placement }) : null;
    const chin = chinOn ? L.chinBounds(target.notch) : null;
    const sheet = panel.show && (panel.kind === 'stop' ? target && target.notch : notch)
      ? L.panelBounds(panel.kind === 'stop' ? target.notch : notch, panel.kind === 'stop' ? 'stop' : 'hover')
      : null;
    const pillOn = !!(target && target.kind === 'pill' && target.bounds);
    return {
      placement, notch, target, onNotch, ears, chinOn, pillOn, panel, hit, chin, sheet,
      pill: pillOn ? target.bounds : null,
    };
  }

  function send(role, state) {
    const win = wins[role];
    if (!win || win.isDestroyed()) return;
    const sig = JSON.stringify(state);
    if (lastSent[role] === sig) return;
    lastSent[role] = sig;
    try { win.webContents.send('notch:state', state); } catch {}
  }

  function baseState(sc) {
    const n = (sc.onNotch && sc.target && sc.target.notch) || sc.notch;
    const internal = recording && recording.display ? !!recording.display.internal : !!(n && n.internal);
    return {
      placement: sc.placement,
      notchW: n ? n.width : 0,
      notchH: n ? n.height : 0,
      leftEar: sc.hit ? sc.hit.leftEar : 0,
      rightEar: sc.hit ? sc.hit.rightEar : 0,
      items,
      elapsed: elapsedNow(),
      full: !!(recording && recording.full),
      quality: recording ? recording.quality : '',
      screenKey: recording ? (internal ? '内置显示器' : '外接显示器') : '',
      screenRaw: '',
    };
  }

  function push(existing) {
    const sc = existing || scene();
    const base = baseState(sc);
    send('hit', Object.assign({}, base, { show: sc.ears ? 'ears' : 'idle', motion: '' }));
    send('chin', Object.assign({}, base, { show: sc.chinOn ? 'chin' : 'idle', motion: '' }));
    send('panel', Object.assign({}, base, { show: sc.panel.kind || 'idle', motion: sc.panel.motion || '' }));
    send('pill', Object.assign({}, base, { show: sc.pillOn ? 'pill' : 'idle', motion: '' }));
  }

  function layout() {
    let sc;
    try { sc = scene(); } catch (e) { note('notch layout', e); return; }
    // scene() already advanced the open/close animation. Do not call it again
    // this frame or the "just opened" motion flag is consumed twice.
    try { place(ensure('hit'), sc.hit, { show: !!sc.hit, ignore: !sc.ears }); } catch (e) { note('notch hit', e); }
    try { place(ensure('chin'), sc.chin, { show: sc.chinOn, ignore: false }); } catch (e) { note('notch chin', e); }
    try { place(ensure('panel'), sc.sheet, { show: sc.panel.show, ignore: !!sc.panel.ignore }); } catch (e) { note('notch panel', e); }
    try { place(ensure('pill'), sc.pill, { show: sc.pillOn, ignore: false }); } catch (e) { note('notch pill', e); }
    push(sc);
  }

  function tick() {
    let p;
    try { p = screen.getCursorScreenPoint(); } catch { return; }
    const notch = L.primaryNotch(notches);
    const target = targetNow();
    const onNotch = !!(target && target.kind === 'notch');
    const placement = preference();
    if (recording && onNotch) {
      const hit = L.hitBounds(target.notch, { recording: true, placement });
      const chin = placement === 'chin' && !stopOpen ? L.chinBounds(target.notch) : null;
      const sheet = stopOpen ? L.panelBounds(target.notch, 'stop') : null;
      const ev = dwell.update(L.pointIn(p, hit) || L.pointIn(p, chin) || L.pointIn(p, sheet), Date.now());
      if (ev === 'open') stopOpen = true;
      if (ev === 'close') stopOpen = false;
      hoverOpen = false;
    } else if (!recording && notch) {
      const rect = { x: notch.x, y: notch.y, width: notch.width, height: notch.height };
      const sheet = hoverOpen ? L.panelBounds(notch, 'hover') : null;
      const ev = dwell.update(L.pointIn(p, rect) || L.pointIn(p, sheet), Date.now());
      if (ev === 'open') hoverOpen = true;
      if (ev === 'close') hoverOpen = false;
      stopOpen = false;
    } else {
      dwell.forceClose();
      hoverOpen = false;
      stopOpen = false;
    }
    layout();
  }

  function refreshGeom() {
    const token = ++geomToken;
    probeScreens().then((probe) => {
      if (token !== geomToken) return;
      const g = L.geometryFromProbe(probe, displaysNow());
      probed = g.probed;
      notches = g.notches;
      note('notch geometry', { probed, reason: probe && probe.reason, notches });
      layout();
    }).catch((e) => note('notch probe failed', e));
  }

  function scheduleGeom() {
    clearTimeout(geomTimer);
    geomTimer = setTimeout(refreshGeom, 300);
  }

  const api = {
    onCommand(id) {
      if (id !== 'shot' && id !== 'record' && id !== 'recordFull' && id !== 'stop') return;
      hoverOpen = false;
      if (id !== 'stop') stopOpen = false;
      dwell.forceClose();
      layout();
      if (onCmd) onCmd(id);
    },
    press() {
      const target = targetNow();
      if (!recording || !target || target.kind !== 'notch') return;
      dwell.forceOpen();
      stopOpen = true;
      layout();
    },
    collapse() {
      hoverOpen = false;
      stopOpen = false;
      dwell.forceClose();
      layout();
    },
    owns(wc) {
      return Object.values(wins).some((w) => w && !w.isDestroyed() && w.webContents === wc);
    },
    moveTop() {
      for (const w of Object.values(wins)) {
        try { if (w && !w.isDestroyed() && w.isVisible()) w.moveTop(); } catch {}
      }
    },
    sync(next) { items = next || []; push(); },
    reload() {
      for (const role of Object.keys(wins)) {
        const w = wins[role];
        try { if (w && !w.isDestroyed()) { lastSent[role] = ''; w.webContents.reload(); } } catch {}
      }
    },
    beginRec(info) {
      const display = info && info.display;
      recording = {
        display: display || null,
        full: !!(info && info.full),
        quality: info && info.quality ? info.quality : '',
        coversAll: !!(info && info.coversAll),
        startedAt: null,
        frozen: null,
      };
      hoverOpen = false;
      stopOpen = false;
      liveKind = null;
      closing = null;
      dwell.forceClose();
      shieldAll();
      layout();
    },
    updateRec(info) {
      if (!recording || !info) return;
      if (info.display) recording.display = info.display;
      if ('full' in info) recording.full = !!info.full;
      if ('quality' in info && info.quality) recording.quality = info.quality;
      if ('coversAll' in info) recording.coversAll = !!info.coversAll;
      layout();
    },
    setElapsed(ms) {
      if (!recording || recording.frozen != null) return;
      const n = Math.max(0, Number(ms) || 0);
      recording.startedAt = Date.now() - n;
      push();
    },
    debugElapsed(ms) {
      if (!recording) return;
      recording.frozen = Math.max(0, Number(ms) || 0);
      push();
    },
    endRec() {
      recording = null;
      stopOpen = false;
      hoverOpen = false;
      liveKind = null;
      closing = null;
      dwell.forceClose();
      layout();
    },
    debugState() {
      return {
        probed, placement: preference(), recording: !!recording,
        hoverOpen, stopOpen, elapsed: elapsedNow(), notches,
        frozen: recording ? recording.frozen : null,
      };
    },
    get geom() { return L.primaryNotch(notches); },
    get win() {
      return ['panel', 'pill', 'chin', 'hit'].map((k) => wins[k]).find((w) => w && !w.isDestroyed()) || null;
    },
  };

  try { notches = L.geometryFromProbe({ ok: false }, displaysNow()).notches; } catch {}
  for (const role of ['hit', 'chin', 'panel', 'pill']) {
    try { ensure(role); } catch (e) { note('notch window', role, e); }
  }
  try {
    screen.on('display-metrics-changed', scheduleGeom);
    screen.on('display-added', scheduleGeom);
    screen.on('display-removed', scheduleGeom);
  } catch {}
  refreshGeom();
  poll = setInterval(tick, 32);
  clock = setInterval(() => { if (recording && recording.startedAt != null) push(); }, 250);
  active = api;
  layout();
  return api;
}

module.exports = { createNotch };
