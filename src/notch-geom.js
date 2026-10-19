// Read the hardware notch with public NSScreen properties.
//
// Electron does not expose auxiliaryTopLeftArea, auxiliaryTopRightArea or
// safeAreaInsets. A native addon would need a per-arch Mach-O build, and
// this repo sets npmRebuild/nodeGypRebuild to false. `swift -e` needs the
// Xcode toolchain, which a packaged app cannot assume.
//
// osascript's JavaScript dialect is on every Mac and can call those same
// public AppKit properties. No private API (nothing from SkyLight / CGS).
// If the probe fails, the controller uses the fallback in notch-logic.js.
'use strict';

const { execFile } = require('child_process');

const SCRIPT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function parseRect(r) {
  try {
    var s = ObjC.unwrap($.NSStringFromRect(r));
    var m = String(s).match(/\\{\\{([-\\d.]+),\\s*([-\\d.]+)\\},\\s*\\{([-\\d.]+),\\s*([-\\d.]+)\\}\\}/);
    if (m) return { x: n(m[1]), y: n(m[2]), w: n(m[3]), h: n(m[4]) };
  } catch (e) {}
  try {
    var u = ObjC.deepUnwrap(r);
    if (u && u.size) return { x: n(u.origin.x), y: n(u.origin.y), w: n(u.size.width), h: n(u.size.height) };
  } catch (e2) {}
  return { x: 0, y: 0, w: 0, h: 0 };
}
function safeTop(s) {
  try {
    var u = ObjC.deepUnwrap(s.safeAreaInsets);
    if (u && u.top != null) return n(u.top);
  } catch (e) {}
  try {
    var v = s.safeAreaInsets;
    if (v && v.top != null) return n(v.top);
  } catch (e2) {}
  return 0;
}
var screens = $.NSScreen.screens;
var out = [];
for (var i = 0; i < screens.count; i++) {
  var s = screens.objectAtIndex(i);
  var f = parseRect(s.frame);
  var l = parseRect(s.auxiliaryTopLeftArea);
  var r = parseRect(s.auxiliaryTopRightArea);
  out.push({ x: f.x, y: f.y, w: f.w, h: f.h, leftW: l.w, leftH: l.h, rightW: r.w, rightH: r.h, safeTop: safeTop(s) });
}
JSON.stringify(out);
`;

function probeScreens() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ ok: false, reason: 'not-darwin' });
      return;
    }
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, reason: String((err && err.message) || err).slice(0, 300) });
        return;
      }
      const line = String(stdout || '').trim().split('\n').filter((l) => l.trim().startsWith('[')).pop();
      if (!line) { resolve({ ok: false, reason: 'empty' }); return; }
      try {
        const rows = JSON.parse(line);
        if (!Array.isArray(rows)) { resolve({ ok: false, reason: 'shape' }); return; }
        resolve({ ok: true, rows });
      } catch (e) {
        resolve({ ok: false, reason: 'parse' });
      }
    });
  });
}

module.exports = { probeScreens, SCRIPT };
