// Notch MVP decisions that don't need a Mac or Electron.
// node test/notch_logic.js
'use strict';

const path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'notch-logic'));
const geom = require(path.join(__dirname, '..', 'src', 'notch-geom'));

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (info ? ' -- ' + info : '')); }
};

const mac = {
  id: 1, internal: true, primary: true,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 32, width: 1512, height: 900 },
};
const ext = {
  id: 2, internal: false, primary: false,
  bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1512, y: 24, width: 1920, height: 1056 },
};
const row = { x: 0, y: 0, w: 1512, h: 982, leftW: 663, leftH: 32, rightW: 663, rightH: 32, safeTop: 37 };

(function geometry() {
  const n = L.notchFromRow(row, mac);
  ok('width is screen minus both auxiliary areas', n && n.width === 1512 - 663 - 663, JSON.stringify(n));
  ok('height prefers safeAreaInsets.top over the aux height', n && n.height === 37, JSON.stringify(n));
  ok('x is the left auxiliary width', n && n.x === 663 && n.y === 0);
  ok('does not hardcode 186×32', n && !(n.width === 186 && n.height === 32));

  const auxOnly = L.notchFromRow(Object.assign({}, row, { safeTop: 0 }), mac);
  ok('falls back to auxiliary height when safe top is missing', auxOnly && auxOnly.height === 32);

  ok('zero auxiliary areas are not a notch', L.notchFromRow({ w: 1512, h: 982, leftW: 0, rightW: 0, leftH: 0, rightH: 0, safeTop: 0 }, mac) === null);

  const live = L.geometryFromProbe({ ok: true, rows: [row, { w: 1920, h: 1080, leftW: 0, rightW: 0, leftH: 24, rightH: 24, safeTop: 0 }] }, [mac, ext]);
  ok('a successful probe keeps the real notch and skips the external display', live.probed && live.notches.length === 1 && live.notches[0].displayId === 1);

  const none = L.geometryFromProbe({ ok: true, rows: [{ w: 1440, h: 900, leftW: 0, rightW: 0, leftH: 24, rightH: 24, safeTop: 0 }] }, [{
    id: 3, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 840 },
  }]);
  ok('a successful "no notch" read does not invent one', none.probed && none.notches.length === 0);

  const missed = L.geometryFromProbe({ ok: false, reason: 'osascript' }, [mac, ext]);
  ok('probe failure uses the 185pt fallback on a tall internal menu bar', missed.notches.length === 1 && missed.notches[0].fallback && missed.notches[0].width === 185 && missed.notches[0].height === 32, JSON.stringify(missed.notches));
  ok('probe failure does not put a notch on the external display', missed.notches.every((n) => n.displayId === 1));

  const air = L.geometryFromProbe({ ok: false }, [{
    id: 4, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 },
  }]);
  ok('a classic 24pt menu bar is not given a fake notch', air.notches.length === 0);

  const twinA = { id: 10, internal: false, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 24, width: 1512, height: 900 } };
  const twinB = { id: 11, internal: true, bounds: { x: 1600, y: 0, width: 1512, height: 982 }, workArea: { x: 1600, y: 32, width: 1512, height: 900 } };
  const matched = L.geometryFromProbe({ ok: true, rows: [row] }, [twinA, twinB]);
  ok('two displays of the same size: the notch row goes to the internal one', matched.notches.length === 1 && matched.notches[0].displayId === 11);
})();

(function timer() {
  ok('0 is H:MM:SS', L.formatElapsed(0) === '0:00:00');
  ok('12:34 keeps the hour digit', L.formatElapsed((12 * 60 + 34) * 1000) === '0:12:34');
  ok('one hour', L.formatElapsed(3600 * 1000) === '1:00:00');
  ok('just under an hour stays one hour digit', L.formatElapsed(3600 * 1000 - 1) === '0:59:59');
  ok('0:00:00 and 1:00:00 share a slot', L.timerSlotText(0) === L.timerSlotText(3600 * 1000) && L.timerSlotText(0) === '0:00:00');
  ok('10 hours widens the slot by one digit and the text matches it', L.timerSlotText(10 * 3600 * 1000).length === L.formatElapsed(10 * 3600 * 1000).length);
  const spoken = L.spokenParts((12 * 60 + 34) * 1000);
  ok('voiceover parts skip a zero hour', spoken.key === '{m} 分 {s} 秒' && spoken.vars.m === 12 && spoken.vars.s === 34);
  const hour = L.spokenParts(3600 * 1000 + 2000);
  ok('voiceover parts include hours past 60 minutes', hour.vars.h === 1 && hour.vars.m === 0 && hour.vars.s === 2);
})();

(function dwell() {
  const d = L.createDwell(200);
  ok('enter does not open', d.update(true, 0) === 'stay' && !d.isOpen());
  ok('199ms is still a pass-through', d.update(true, 199) === 'stay' && !d.isOpen());
  ok('leaving before 200ms cancels', d.update(false, 200) === 'stay' && !d.isOpen());
  const d2 = L.createDwell(200);
  d2.update(true, 1000);
  ok('200ms inside opens', d2.update(true, 1200) === 'open' && d2.isOpen());
  ok('staying does not re-fire', d2.update(true, 1500) === 'stay');
  ok('leaving closes', d2.update(false, 1600) === 'close' && !d2.isOpen());
  const d3 = L.createDwell(200);
  d3.update(true, 0);
  d3.forceOpen();
  ok('a click opens without waiting the dwell', d3.isOpen());
})();

(function menu() {
  const accel = (a) => ({ capture: 'Control+Command+A', recordRegion: 'Control+Command+R', recordFull: 'Control+Command+Shift+R' }[a] || '');
  const idle = L.menuAndHover({ recording: false, label: (s) => s, accel });
  ok('hover ids are shot, record, recordFull', idle.hover.map((h) => h.id).join(',') === 'shot,record,recordFull');
  ok('idle hover matches the first three menu rows', L.hoverMatchesIdleMenu(idle.menu, idle.hover));
  ok('accelerators are the menu bindings', idle.hover.map((h) => h.accel).join('|') === 'Control+Command+A|Control+Command+R|Control+Command+Shift+R');
  ok('tray labels keep the tab the old template used', idle.menu.map(L.trayLabel).join(' || ') === '截图\tControl+Command+A || 录制区域\tControl+Command+R || 录制全屏\tControl+Command+Shift+R');

  const rec = L.menuAndHover({ recording: true, label: (s) => s, accel });
  ok('while recording the second menu row is the existing stop item', rec.menu[1].id === 'stop' && rec.menu[1].label === '■ 停止录制' && L.trayLabel(rec.menu[1]) === '■ 停止录制');
  ok('full-screen entry disables while recording', rec.menu[2].enabled === false && rec.menu[2].id === 'recordFull');
  ok('hover source stays the three idle actions, in order', rec.hover.map((h) => h.id).join(',') === 'shot,record,recordFull' && rec.hover[1].label === '录制区域');
  ok('stop carries no new accelerator', rec.menu[1].accel === '');
})();

(function placement() {
  const risk = L.earWidthRisk();
  ok('78pt right ear is not ruled safe', risk.ruledOut === false && risk.rightEarPt === 78 && risk.placement === 'chin');
  ok('default placement is the chin', L.timerPlacement('') === 'chin' && L.timerPlacement('nope') === 'chin');
  ok('ear placement is opt-in', L.timerPlacement('ear') === 'ear' && L.readTimerPreference('ear', '') === 'ear');

  const n = L.notchFromRow(row, mac);
  const idleHit = L.hitBounds(n, { recording: false, placement: 'chin' });
  ok('idle hit area is exactly the notch rectangle', idleHit.x === n.x && idleHit.y === n.y && idleHit.width === n.width && idleHit.height === n.height && idleHit.leftEar === 0 && idleHit.rightEar === 0);

  const recHit = L.hitBounds(n, { recording: true, placement: 'chin' });
  const chin = L.chinBounds(n);
  ok('chin mode keeps the 34pt left ear and no right ear', recHit.leftEar === 34 && recHit.rightEar === 0 && recHit.width === n.width + 34);
  ok('chin sits under the notch, not in the right menu-bar area', chin.x === n.x && chin.y === n.y + n.height && chin.width === n.width);

  const earHit = L.hitBounds(n, { recording: true, placement: 'ear' });
  ok('opt-in ears reserve 78pt on the right', earHit.rightEar === 78 && earHit.width === 34 + n.width + 78);

  const panel = L.panelBounds(n, 'hover');
  ok('hover panel is 300×104 and starts at the bottom of the notch', panel.width === 300 && panel.height === 104 && panel.y === n.y + n.height);
  const beside = { x: n.x - 20, y: n.y + 4 };
  ok('a menu-bar point beside the notch is outside the idle hit and the panel', !L.pointIn(beside, idleHit) && !L.pointIn(beside, panel));
  ok('the panel does not intersect the menu-bar row', panel.y >= n.y + n.height);

  const pill = L.pillBounds(ext);
  ok('pill is 166×30, centred, 6pt under the menu bar', pill.width === 166 && pill.height === 30 && pill.y === ext.bounds.y + 24 + 6 && pill.x === ext.bounds.x + Math.round((ext.bounds.width - 166) / 2), JSON.stringify(pill));
  ok('pill top is below the menu bar', pill.y >= ext.workArea.y);
})();

(function target() {
  const notches = L.geometryFromProbe({ ok: true, rows: [row] }, [mac, ext]).notches;
  const onMac = L.statusTarget({ display: mac, notches, displays: [mac, ext], coversAll: false });
  ok('recording the notch display uses the notch', onMac.kind === 'notch' && onMac.notch.displayId === 1);
  const onExt = L.statusTarget({ display: ext, notches, displays: [mac, ext], coversAll: false });
  ok('recording the external display uses the pill on that display', onExt.kind === 'pill' && onExt.display.id === 2 && onExt.bounds.x >= ext.bounds.x);
  const all = L.statusTarget({ display: null, notches, displays: [ext, mac], coversAll: true });
  ok('a capture with no single display lands on the primary', all.kind === 'notch' && all.display.id === 1);
  ok('darwin only', L.enabledOn('darwin') === true && L.enabledOn('win32') === false && L.enabledOn('linux') === false);
  ok('4K quality label', L.qualityText('2160') === '4K' && L.qualityText(1080) === '1080p' && L.qualityText('source') === '原画');
})();

(async function probeGate() {
  const r = await geom.probeScreens();
  if (process.platform === 'darwin') ok('darwin probe returns a result object', r && typeof r.ok === 'boolean');
  else ok('non-mac probe does not spawn osascript', r && r.ok === false && r.reason === 'not-darwin', JSON.stringify(r));
  console.log(fail ? `\n${pass} passed, ${fail} failed` : `\n${pass} passed`);
  process.exit(fail ? 1 : 0);
})();
