'use strict';
// globalShortcut.register 返回 false 或抛错时，每个「动作 + 这组键」只提醒一次。
// 换了一组新键再失败，会再提醒一次。同一组键下次启动不再弹。

function registerResult(outcome) {
  if (typeof outcome === 'function') {
    try { return outcome() ? 'ok' : 'fail'; } catch { return 'fail'; }
  }
  if (outcome === true) return 'ok';
  if (outcome === false) return 'fail';
  return outcome ? 'ok' : 'fail';
}

function failureId(action, accelerator) {
  return String(action) + '\n' + String(accelerator || '');
}

function noticeForRegisterFailure(status, hotkeys, notified, names) {
  const next = Object.assign({}, notified || {});
  const fresh = [];
  for (const [action, st] of Object.entries(status || {})) {
    if (!st || st.keyboard !== 'fail') continue;
    const accelerator = hotkeys && hotkeys[action] && hotkeys[action].keyboard;
    if (!accelerator) continue;
    const id = failureId(action, accelerator);
    if (next[id]) continue;
    next[id] = true;
    fresh.push({ action, accelerator, name: (names && names[action]) || action });
  }
  if (!fresh.length) return { notify: false, notified: next, title: '', body: '', list: '' };
  const list = fresh.map((f) => `${f.name}（${f.accelerator}）`).join('、');
  return {
    notify: true,
    notified: next,
    title: '有快捷键没能注册',
    body: list + ' 没能注册。请到 设置 → 快捷键 换一个。',
    list,
  };
}

module.exports = { registerResult, noticeForRegisterFailure, failureId };
