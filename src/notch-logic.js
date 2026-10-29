// Pure notch decisions. No Electron, no AppKit. The Mac controller and the
// renderer both load this so labels, geometry and the timer cannot drift.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotchLogic = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // pt. Electron window bounds are in the same points. Do not treat the
  // 186×32 drawing in the design frames as the hardware size.
  const SPEC = {
    dwellMs: 200,
    earLeft: 34,
    earRight: 78,
    hoverW: 300,
    hoverH: 104,
    stopW: 300,
    stopH: 96,
    pillW: 166,
    pillH: 30,
    pillGap: 6,
    pillRadius: 15,
    keyW: 84,
    keyH: 58,
    keyGap: 8,
    keyRadius: 12,
    panelRadius: 22,
    fallbackWidth: 185, // Boring Notch's published fallback, used only when the probe fails
    chinH: 28,
    dot: 8,
    openSpring: { response: 0.38, damping: 0.8 },
    closeSpring: { response: 0.45, damping: 1 },
    reduceMs: 150,
  };

  const HOVER_IDS = ['shot', 'record', 'recordFull'];

  function enabledOn(platform) { return platform === 'darwin'; }

  // H:MM:SS with at least one hour digit, so 0:00:00 and 1:00:00 are the
  // same width in tabular figures. A second hour digit appears only at 10h.
  function formatElapsed(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return `${h}:${p(m)}:${p(sec)}`;
  }

  function timerSlotText(ms) {
    const hourDigits = formatElapsed(ms).indexOf(':');
    return '0'.repeat(Math.max(1, hourDigits)) + ':00:00';
  }

  function spokenParts(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return { key: '{h} 小时 {m} 分 {s} 秒', vars: { h, m, s: sec } };
    return { key: '{m} 分 {s} 秒', vars: { m, s: sec } };
  }

  // Pointer must stay inside for dwellMs. Leaving cancels. forceOpen is the
  // ear click, which does not wait.
  function createDwell(ms) {
    const need = ms == null ? SPEC.dwellMs : ms;
    let since = null;
    let open = false;
    return {
      update(inside, now) {
        if (inside) {
          if (since == null) since = now;
          if (!open && now - since >= need) { open = true; return 'open'; }
          return 'stay';
        }
        since = null;
        if (open) { open = false; return 'close'; }
        return 'stay';
      },
      forceOpen() { open = true; since = null; },
      forceClose() { open = false; since = null; },
      isOpen() { return open; },
    };
  }

  function menuBarHeight(display) {
    if (!display || !display.bounds || !display.workArea) return 0;
    const h = Math.round(display.workArea.y - display.bounds.y);
    if (h < 0 || h > 80) return 0;
    return h;
  }

  function notchFromRow(row, display) {
    if (!row || !display || !display.bounds) return null;
    const leftW = Number(row.leftW) || 0;
    const rightW = Number(row.rightW) || 0;
    const width = Math.round(Number(row.w) - leftW - rightW);
    const safeTop = Number(row.safeTop) || 0;
    const auxH = Math.max(Number(row.leftH) || 0, Number(row.rightH) || 0);
    const height = Math.round(safeTop > 1 ? safeTop : auxH);
    if (!(leftW > 1 && rightW > 1 && width >= 60 && height >= 20)) return null;
    const b = display.bounds;
    return {
      displayId: display.id,
      internal: !!display.internal,
      fallback: false,
      x: Math.round(b.x + leftW),
      y: Math.round(b.y),
      width,
      height,
      leftAux: leftW,
      rightAux: rightW,
      safeTop,
      displayBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    };
  }

  // Only when NSScreen could not be read. A successful read that reports no
  // notch must stay a pill, even if the menu bar is tall.
  function fallbackNotch(display) {
    if (!display || !display.internal || !display.bounds) return null;
    const bar = menuBarHeight(display);
    if (bar < 30 || bar > 64) return null;
    const b = display.bounds;
    const width = SPEC.fallbackWidth;
    return {
      displayId: display.id,
      internal: true,
      fallback: true,
      x: Math.round(b.x + (b.width - width) / 2),
      y: Math.round(b.y),
      width,
      height: bar,
      leftAux: null,
      rightAux: null,
      safeTop: bar,
      displayBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    };
  }

  function matchDisplay(row, displays, used) {
    const cands = (displays || []).filter((d) => d && d.bounds && !used.has(d.id)
      && Math.abs(d.bounds.width - Number(row.w)) < 3
      && Math.abs(d.bounds.height - Number(row.h)) < 3);
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    if ((Number(row.leftW) || 0) > 1 && (Number(row.rightW) || 0) > 1) {
      const internal = cands.find((d) => d.internal);
      if (internal) return internal;
    }
    return cands[0];
  }

  function geometryFromProbe(probe, displays) {
    const list = displays || [];
    if (!probe || !probe.ok) {
      return { probed: false, notches: list.map(fallbackNotch).filter(Boolean) };
    }
    const used = new Set();
    const notches = [];
    for (const row of probe.rows || []) {
      const d = matchDisplay(row, list, used);
      if (!d) continue;
      used.add(d.id);
      const n = notchFromRow(row, d);
      if (n) notches.push(n);
    }
    return { probed: true, notches };
  }

  function primaryNotch(notches) {
    return (notches || []).find((n) => n.internal) || (notches || [])[0] || null;
  }

  // Status icons sit in the right auxiliary area and grow toward the notch.
  // Their frames are not a public API, so a 78pt right ear cannot be ruled
  // safe. The timer therefore lives in a chin under the notch unless the
  // user opts into ears (HOPSNAP_NOTCH_TIMER=ear or settings notch.timer).
  function earWidthRisk() {
    return { rightEarPt: SPEC.earRight, leftEarPt: SPEC.earLeft, ruledOut: false, placement: 'chin' };
  }

  function readTimerPreference(envValue, settingsValue) {
    const v = String(envValue || settingsValue || '');
    return v === 'ear' || v === 'chin' ? v : '';
  }

  function timerPlacement(preference) {
    return preference === 'ear' ? 'ear' : 'chin';
  }

  function hitBounds(notch, opts) {
    if (!notch) return null;
    const recording = !!(opts && opts.recording);
    const placement = timerPlacement(opts && opts.placement);
    const left = recording ? SPEC.earLeft : 0;
    const right = recording && placement === 'ear' ? SPEC.earRight : 0;
    return {
      x: Math.round(notch.x - left),
      y: Math.round(notch.y),
      width: Math.round(left + notch.width + right),
      height: Math.round(notch.height),
      leftEar: left,
      rightEar: right,
    };
  }

  function chinBounds(notch) {
    if (!notch) return null;
    return {
      x: Math.round(notch.x),
      y: Math.round(notch.y + notch.height),
      width: Math.round(notch.width),
      height: SPEC.chinH,
    };
  }

  function panelBounds(notch, kind) {
    if (!notch) return null;
    const w = kind === 'stop' ? SPEC.stopW : SPEC.hoverW;
    const h = kind === 'stop' ? SPEC.stopH : SPEC.hoverH;
    const b = notch.displayBounds;
    let x = Math.round(notch.x + notch.width / 2 - w / 2);
    if (b) x = Math.max(b.x + 4, Math.min(x, b.x + b.width - w - 4));
    return { x, y: Math.round(notch.y + notch.height), width: w, height: h };
  }

  function pillBounds(display) {
    if (!display || !display.bounds) return null;
    const b = display.bounds;
    const bar = menuBarHeight(display);
    const w = SPEC.pillW;
    const h = SPEC.pillH;
    let x = Math.round(b.x + (b.width - w) / 2);
    x = Math.max(b.x + 4, Math.min(x, b.x + b.width - w - 4));
    return { x, y: Math.round(b.y + bar + SPEC.pillGap), width: w, height: h };
  }

  function pointIn(p, r) {
    if (!p || !r) return false;
    return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
  }

  function statusTarget({ display, notches, displays, coversAll }) {
    let d = display || null;
    if (coversAll || !d) {
      const list = displays || [];
      d = list.find((x) => x && x.primary) || list.find((x) => x && x.internal) || list[0] || null;
    }
    if (!d) return { kind: 'none' };
    const notch = (notches || []).find((n) => n.displayId === d.id);
    if (notch) return { kind: 'notch', display: d, notch };
    return { kind: 'pill', display: d, bounds: pillBounds(d) };
  }

  function qualityText(quality) {
    const q = String(quality == null ? '' : quality);
    if (q === '2160') return '4K';
    if (q === 'source') return '原画';
    if (/^\d+$/.test(q)) return q + 'p';
    return '';
  }

  // First three tray actions. Hover always uses the idle three, in this
  // order, with the same labels and the same accelerators. While recording,
  // the tray's second row becomes Stop; the notch shows the stop panel
  // instead of pretending the hover keys changed.
  function menuAndHover({ recording, label, accel }) {
    const lab = typeof label === 'function' ? label : (s) => s;
    const acc = typeof accel === 'function' ? accel : () => '';
    const shot = { id: 'shot', label: lab('截图'), accel: acc('capture') || '', enabled: true };
    const region = { id: 'record', label: lab('录制区域'), accel: acc('recordRegion') || '', enabled: true };
    const full = { id: 'recordFull', label: lab('录制全屏'), accel: acc('recordFull') || '', enabled: !recording };
    const stop = { id: 'stop', label: lab('■ 停止录制'), accel: '', enabled: true };
    return {
      menu: [shot, recording ? stop : region, Object.assign({}, full)],
      hover: [shot, region, Object.assign({}, full, { enabled: true })],
    };
  }

  // Matches the previous template: a tab before the accelerator (even when
  // the binding is empty), and no tab on the stop row (that row never had one).
  function trayLabel(entry) {
    if (!entry) return '';
    if (entry.id === 'stop') return entry.label;
    return `${entry.label}\t${entry.accel || ''}`;
  }

  function hoverMatchesIdleMenu(menu, hover) {
    if (!menu || !hover || hover.length !== 3 || menu.length < 3) return false;
    if (hover.map((h) => h.id).join(',') !== HOVER_IDS.join(',')) return false;
    if (menu[1].id !== 'record') return false;
    return hover.every((h, i) => h.id === menu[i].id && h.label === menu[i].label && h.accel === menu[i].accel);
  }

  return {
    SPEC, HOVER_IDS, enabledOn,
    formatElapsed, timerSlotText, spokenParts, createDwell,
    menuBarHeight, notchFromRow, fallbackNotch, matchDisplay, geometryFromProbe, primaryNotch,
    earWidthRisk, readTimerPreference, timerPlacement,
    hitBounds, chinBounds, panelBounds, pillBounds, pointIn, statusTarget, qualityText,
    menuAndHover, trayLabel, hoverMatchesIdleMenu,
  };
});
