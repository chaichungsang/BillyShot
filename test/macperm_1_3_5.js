// 1.3.5 Mac 辅助功能：没授权时不启动 uiohook（libuiohook 启动会弹系统授权框），授权后自动启动
// 用 node 直接跑：node test/macperm_1_3_5.js（模拟 macOS 的 electron / uiohook-napi，不需要 Mac）
'use strict';
const Module = require('module');
const path = require('path');

let trusted = false;
const promptCalls = [];   // isTrustedAccessibilityClient 的参数
let starts = 0, stops = 0;
const fakeElectron = {
  systemPreferences: { isTrustedAccessibilityClient: (p) => { promptCalls.push(!!p); return trusted; } },
  globalShortcut: { register: () => true, unregisterAll: () => {}, unregister: () => {} },
};
const handlers = {};
const fakeHook = { uIOhook: { on: (ev, fn) => { handlers[ev] = fn; }, start: () => { starts++; }, stop: () => { stops++; } } };
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return fakeElectron;
  if (req === 'uiohook-napi') return fakeHook;
  return origLoad.apply(this, arguments);
};
Object.defineProperty(process, 'platform', { value: 'darwin' });
const hotkeys = require(path.join(__dirname, '..', 'src', 'hotkeys.js'));

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + ' -- ' + info); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const HK = { capture: { keyboard: 'Control+Command+A', mouse: '' }, recordRegion: { keyboard: '', mouse: 'Ctrl+Mouse4' } };
  let granted = 0; hotkeys.setAxGrantedHandler(() => { granted++; });

  // 1 没授权 + 设了鼠标快捷键：不启动钩子、不弹框、状态 needPermission
  let st = hotkeys.register(HK, () => {});
  ok('没授权：鼠标快捷键显示「需要授权」', st.recordRegion.mouse === 'needPermission', JSON.stringify(st));
  ok('没授权：不启动 uiohook（不会触发 libuiohook 的系统授权框）', starts === 0, 'starts=' + starts);
  ok('没授权：键盘快捷键照常', st.capture.keyboard === 'ok');
  // 2 反复注册（改设置 / 关设置窗口都会重新注册）：仍不启动、也不带弹框参数
  for (let i = 0; i < 5; i++) hotkeys.register(HK, () => {});
  ok('反复注册 5 次：不启动钩子', starts === 0, 'starts=' + starts);
  ok('hotkeys 自己从不让系统弹授权框（参数全是 false）', promptCalls.every((p) => p === false), JSON.stringify(promptCalls));
  // 3 演示层要用钩子（点击波纹）：没授权也不启动
  ok('useHook 没授权：返回 false、不启动', hotkeys.useHook('present', true) === false && starts === 0);
  hotkeys.useHook('present', false);
  // 4 用户在系统设置里打开开关：几秒内自动启动，通知主进程
  let cb = 0; hotkeys.whenAxTrusted(() => { cb++; });
  trusted = true;
  await sleep(2600);
  ok('授权后 2 秒内自动启动钩子（不用重开程序）', starts === 1, 'starts=' + starts);
  ok('授权后通知主进程一次', granted === 1, 'granted=' + granted);
  ok('whenAxTrusted 回调一次', cb === 1, 'cb=' + cb);
  st = hotkeys.register(HK, () => {});
  ok('授权后重新注册：鼠标快捷键 ok，钩子不重复启动', st.recordRegion.mouse === 'ok' && starts === 1, JSON.stringify(st) + ' starts=' + starts);
  // 5 鼠标快捷键生效
  let fired = null; hotkeys.register(HK, (a) => { fired = a; });
  handlers.mousedown({ button: 4, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
  await sleep(200);
  ok('授权后鼠标快捷键能触发', fired === 'recordRegion', String(fired));
  // 6 去掉鼠标快捷键：钩子停掉
  hotkeys.register({ capture: HK.capture }, () => {});
  ok('不用鼠标快捷键后停掉钩子', stops === 1, 'stops=' + stops);
  // 7 没有任何功能需要钩子时，不再轮询
  trusted = false; const before = promptCalls.length;
  await sleep(2300);
  ok('没人需要钩子时不轮询辅助功能状态', promptCalls.length === before, `${before} -> ${promptCalls.length}`);
  hotkeys.dispose();
  console.log(`\n== Mac 辅助功能 1.3.5: PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail ? 1 : 0);
})();
