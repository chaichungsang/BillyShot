'use strict';

const { execFileSync } = require('child_process');

// AppKit reports auxiliary menu-bar areas on either side of the notch.
// Electron display bounds use the top-left of that same screen, so the notch
// sits inset by the left area's width.
const SWIFT = `
import AppKit
import Foundation
struct Row: Encodable {
  let x, y, w, h, leftW, leftH, rightW, rightH: Double
  let notch: Bool
}
var rows: [Row] = []
for s in NSScreen.screens {
  let f = s.frame
  let l = s.auxiliaryTopLeftArea ?? .zero
  let r = s.auxiliaryTopRightArea ?? .zero
  rows.append(Row(
    x: f.origin.x, y: f.origin.y, w: f.size.width, h: f.size.height,
    leftW: l.width, leftH: l.height, rightW: r.width, rightH: r.height,
    notch: l.width > 1 && r.width > 1 && l.height > 1))
}
let data = try! JSONEncoder().encode(rows)
print(String(data: data, encoding: .utf8)!)
`;

function detect(screen) {
  let raw = '';
  try {
    raw = execFileSync('swift', ['-e', SWIFT], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const line = String(raw).trim().split('\n').filter((l) => l.startsWith('[')).pop();
  if (!line) return null;
  let rows;
  try { rows = JSON.parse(line); } catch { return null; }
  const displays = screen.getAllDisplays();
  for (const row of rows) {
    if (!row.notch) continue;
    const d = displays.find((disp) => Math.abs(disp.bounds.width - row.w) < 3 && Math.abs(disp.bounds.height - row.h) < 3);
    if (!d) continue;
    const width = Math.round(row.w - row.leftW - row.rightW);
    const height = Math.round(row.leftH);
    if (width < 60 || height < 20) continue;
    return {
      displayId: d.id,
      x: Math.round(d.bounds.x + row.leftW),
      y: Math.round(d.bounds.y),
      width,
      height,
      displayBounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    };
  }
  return null;
}

const MENU_W = 440;
const REC_W = 430;
const ROW_H = 28;

function createNotch({ screen, BrowserWindow, log, R, protect, onCmd, getItems }) {
  const found = detect(screen);
  if (!found) return null;
  let geom = found;
  let face = 'idle-mark';
  let items = [];
  let recCfg = null;
  let relayoutTimer = null;
  let openedAt = 0;

  const win = new BrowserWindow({
    x: geom.x, y: geom.y, width: geom.width, height: geom.height,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,
    focusable: false, alwaysOnTop: true, roundedCorners: false,
    type: 'panel',
    webPreferences: { preload: R('preload.js') },
  });
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
  try { if (win.setHiddenInMissionControl) win.setHiddenInMissionControl(true); } catch {}
  try { win.setWindowButtonVisibility(false); } catch {}
  protect(win);
  win.loadFile(R('renderer', 'notch.html'));
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  win.webContents.on('did-finish-load', () => push());

  function expanded() {
    return face === 'idle-menu' || face === 'rec-full' || face === 'saving' || face === 'done';
  }
  function itemRows() {
    let n = 0;
    let group = '';
    for (const it of items) {
      if (it.group && it.group !== group) { n += 1; group = it.group; }
      n += 1;
    }
    return n;
  }
  function boundsFor(next) {
    const b = geom.displayBounds;
    if (next === 'idle-mark' || next === 'rec-compact') {
      return { x: geom.x, y: geom.y, width: geom.width, height: geom.height };
    }
    const wide = next === 'idle-menu' ? MENU_W : REC_W;
    const tall = next === 'idle-menu'
      ? geom.height + 8 + itemRows() * ROW_H + 14
      : geom.height + 8 + 46;
    let x = Math.round(geom.x + geom.width / 2 - wide / 2);
    x = Math.max(b.x + 4, Math.min(x, b.x + b.width - wide - 4));
    const height = Math.min(tall, b.y + b.height - geom.y - 8);
    return { x, y: geom.y, width: wide, height };
  }
  function applyBounds() {
    const box = boundsFor(face);
    try { win.setBounds(box); } catch {}
    try { win.setFocusable(expanded()); } catch {}
    if (!expanded()) {
      try { win.setIgnoreMouseEvents(false); } catch {}
    }
  }
  function push() {
    if (win.isDestroyed()) return;
    applyBounds();
    try {
      win.webContents.send('notch:state', {
        face,
        notchW: geom.width,
        notchH: geom.height,
        items,
        recCfg,
      });
    } catch {}
  }
  function setFace(next) {
    if ((next === 'idle-menu' || next === 'rec-full') && face !== next) openedAt = Date.now();
    face = next;
    push();
    if (expanded()) { try { win.focus(); } catch {} }
    else { try { win.blur(); } catch {} }
  }
  function collapse() {
    if (face === 'idle-menu') setFace('idle-mark');
    else if (face === 'rec-full') setFace('rec-compact');
  }
  function toggle() {
    if (face === 'idle-mark') setFace('idle-menu');
    else if (face === 'idle-menu') setFace('idle-mark');
    else if (face === 'rec-compact') setFace('rec-full');
    else if (face === 'rec-full') setFace('rec-compact');
  }

  win.on('blur', () => {
    if (Date.now() - openedAt < 250) return;
    if (face === 'idle-menu' || face === 'rec-full') collapse();
  });

  const { ipcMain } = require('electron');
  const fromHere = (e) => e && e.sender === win.webContents;
  ipcMain.on('notch:toggle', (e) => { if (fromHere(e)) toggle(); });
  ipcMain.on('notch:collapse', (e) => { if (fromHere(e)) collapse(); });
  ipcMain.on('notch:cmd', (e, id) => { if (fromHere(e) && onCmd) onCmd(id); });
  ipcMain.on('notch:hit', (e, hit) => {
    if (!fromHere(e) || win.isDestroyed() || !expanded()) return;
    try { win.setIgnoreMouseEvents(!hit, { forward: true }); } catch {}
  });

  screen.on('display-metrics-changed', () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      const next = detect(screen);
      if (!next) return;
      geom = next;
      applyBounds();
      push();
    }, 300);
  });

  return {
    win,
    get geom() { return geom; },
    get face() { return face; },
    sync(nextItems) {
      items = nextItems || [];
      push();
    },
    setFace,
    collapse,
    beginRec(cfg) {
      recCfg = cfg || {};
      setFace('rec-compact');
    },
    showIdle() {
      recCfg = null;
      setFace('idle-mark');
    },
    reload() {
      if (!win.isDestroyed()) win.loadFile(R('renderer', 'notch.html'));
    },
  };
}

module.exports = { createNotch };
