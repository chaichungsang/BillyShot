// 全局快捷键：键盘用 globalShortcut，鼠标（中键/侧键 + 修饰键）用 uiohook-napi
const { globalShortcut, systemPreferences } = require('electron');

const isMac = process.platform === 'darwin';

let uIOhook = null;
let hookStarted = false;
let mouseBindings = []; // { action, button, ctrl, alt, shift, meta }
let handler = () => {};
let paused = false;
// Mac 辅助功能（1.3.5）：没授权时不启动鼠标钩子。libuiohook 启动时会用「弹框」的方式检查授权，
// 每次启动 / 每次重新注册快捷键都弹一次系统授权框，而且没授权时钩子收不到任何事件。
// 改成：没授权就不启动，每 2 秒静默查一次（不弹框），用户在系统设置里打开开关后自动启动，不用重开程序。
let axTimer = null;
let axListeners = new Set();   // 一次性：授权后各调用一次
let onAxGranted = () => {};     // 授权后通知主进程（刷新快捷键状态、设置页、演示层）
const hookUsers = new Set();   // 除鼠标快捷键外还在用钩子的功能（如演示层的点击波纹）
const clickListeners = new Set();
const moveListeners = new Set();

const MOUSE_NAMES = { MouseMiddle: 3, Mouse4: 4, Mouse5: 5, MouseRight: 2 };

function parseMouse(str) {
  if (!str) return null;
  const parts = str.split('+').map((s) => s.trim());
  const btnName = parts.pop();
  const button = MOUSE_NAMES[btnName];
  if (!button) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    button,
    ctrl: mods.has('ctrl') || mods.has('control'),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
    meta: mods.has('command') || mods.has('cmd') || mods.has('super') || mods.has('meta'),
  };
}

function loadHook() {
  if (uIOhook) return uIOhook;
  try {
    uIOhook = require('uiohook-napi').uIOhook;
    // 移动 + 按住拖动（EVENT_MOUSE_MOVED = 9，EVENT_MOUSE_DRAGGED = 10）
    uIOhook.on('input', (e) => {
      if (!moveListeners.size || (e.type !== 9 && e.type !== 10)) return;
      for (const fn of moveListeners) { try { fn(e); } catch {} }
    });
    uIOhook.on('mousedown', (e) => {
      for (const fn of clickListeners) { try { fn(e); } catch (err) { console.error('click listener failed', err); } }
      if (paused) return;
      for (const b of mouseBindings) {
        if (e.button === b.button && !!e.ctrlKey === b.ctrl && !!e.altKey === b.alt &&
            !!e.shiftKey === b.shift && !!e.metaKey === b.meta) {
          // 稍等片刻，让鼠标侧键原本的动作（如浏览器后退）先结束，再弹出截图
          setTimeout(() => handler(b.action, 'mouse'), 120);
          break;
        }
      }
    });
  } catch (e) {
    console.error('uiohook load failed', e);
    uIOhook = null;
  }
  return uIOhook;
}

/**
 * 注册所有快捷键，返回每个动作的注册结果 { action: { keyboard: 'ok'|'fail'|'', mouse: 'ok'|'fail'|'needPermission'|'' } }
 */
function register(hotkeys, onTrigger) {
  handler = onTrigger;
  globalShortcut.unregisterAll();
  mouseBindings = [];
  const status = {};
  for (const [action, bind] of Object.entries(hotkeys)) {
    status[action] = { keyboard: '', mouse: '' };
    if (bind.keyboard) {
      let ok = false;
      try { ok = globalShortcut.register(bind.keyboard, () => { if (!paused) handler(action, 'keyboard'); }); } catch { ok = false; }
      status[action].keyboard = ok ? 'ok' : 'fail';
    }
    if (bind.mouse) {
      const m = parseMouse(bind.mouse);
      if (m) { mouseBindings.push({ action, ...m }); status[action].mouse = 'ok'; } else status[action].mouse = 'fail';
    }
  }
  if (mouseBindings.length) {
    startHook();
    if (!axTrusted()) {
      for (const b of mouseBindings) status[b.action].mouse = 'needPermission';
    } else if (!hookStarted) {
      // 钩子加载或启动失败（常见于杀毒软件拦截）：如实显示为失败
      for (const b of mouseBindings) if (status[b.action].mouse === 'ok') status[b.action].mouse = 'fail';
    }
  } else if (hookStarted && uIOhook && !hookUsers.size) {
    try { uIOhook.stop(); } catch {}
    hookStarted = false;
  }
  return status;
}

// Mac：辅助功能有没有授权（不弹系统框）。其他系统总是 true
function axTrusted() {
  if (!isMac) return true;
  try { return systemPreferences.isTrustedAccessibilityClient(false); } catch { return false; }
}
const wantHook = () => mouseBindings.length > 0 || hookUsers.size > 0 || axListeners.size > 0;
// 没授权时静默等待授权：打开开关后几秒内自动生效
function watchAx() {
  if (!isMac || axTimer) return;
  axTimer = setInterval(() => {
    if (!wantHook()) { clearInterval(axTimer); axTimer = null; return; }
    if (!axTrusted()) return;
    clearInterval(axTimer); axTimer = null;
    if (mouseBindings.length || hookUsers.size) startHook();
    const fns = [...axListeners]; axListeners.clear();
    for (const fn of fns) { try { fn(); } catch (e) { console.error('ax listener failed', e); } }
    try { onAxGranted(); } catch (e) { console.error('ax granted handler failed', e); }
  }, 2000);
}
// 有功能需要辅助功能权限、但还没授权时登记一下：授权后回调一次（演示层的点击波纹用）
function whenAxTrusted(fn) { axListeners.add(fn); if (axTrusted()) { axListeners.delete(fn); fn(); return () => {}; } watchAx(); return () => axListeners.delete(fn); }
function startHook() {
  if (hookStarted) return true;
  if (!axTrusted()) { watchAx(); return false; }   // Mac 没授权：不启动（避免 libuiohook 每次弹授权框）
  const hook = loadHook();
  if (!hook) return false;
  try { hook.start(); hookStarted = true; } catch (e) { console.error('uiohook start failed', e); }
  return hookStarted;
}

// 其他功能共用鼠标钩子（引用计数）：返回钩子是否在运行
function useHook(name, on) {
  if (on) hookUsers.add(name); else hookUsers.delete(name);
  if (on) startHook();
  else if (!hookUsers.size && !mouseBindings.length && hookStarted && uIOhook) {
    try { uIOhook.stop(); } catch {}
    hookStarted = false;
  }
  return hookStarted;
}
function onMouseDown(fn) { clickListeners.add(fn); return () => clickListeners.delete(fn); }
function onMouseMove(fn) { moveListeners.add(fn); return () => moveListeners.delete(fn); }

// 设置界面录入快捷键时暂停，避免触发
function setPaused(v) {
  paused = !!v;
  if (paused) globalShortcut.unregisterAll();
}

function dispose() {
  globalShortcut.unregisterAll();
  if (axTimer) { clearInterval(axTimer); axTimer = null; }
  if (hookStarted && uIOhook) { try { uIOhook.stop(); } catch {} hookStarted = false; }
}

function isPaused() { return paused; }

module.exports = { register, setPaused, isPaused, dispose, parseMouse, useHook, onMouseDown, onMouseMove, axTrusted, whenAxTrusted, setAxGrantedHandler: (fn) => { onAxGranted = fn || (() => {}); } };
