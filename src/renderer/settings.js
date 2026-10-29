'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const isMac = api.platform === 'darwin';
document.body.classList.add(api.platform);
$$('.mod').forEach((m) => (m.textContent = isMac ? '⌘' : 'Ctrl+'));

let S = null, STATUS = {};
const ACTIONS = [
  ['capture', tx('截图（框选 + 编辑）')],
  ['captureFull', tx('全屏截图直接复制')],
  ['recordRegion', tx('区域录屏 / 停止')],
  ['recordFull', tx('全屏录屏 / 停止')],
  ['pinClipboard', tx('贴图（钉住剪贴板图片）')],
  ['presentMode', tx('演示模式（鼠标光圈 / 点击波纹）开关')],
  ['spotlight', tx('聚光灯 开关')],
];

function get(path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), S); }
function patchOf(path, value) { const keys = path.split('.'); const out = {}; let o = out; keys.forEach((k, i) => { if (i === keys.length - 1) o[k] = value; else o = o[k] = {}; }); return out; }
async function set(path, value) { const r = await api.invoke('settings:set', patchOf(path, value)); S = r.settings; STATUS = r.status || STATUS; renderHotkeys(); renderKeyHints(); }
function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1400); }

// -------------------------------------------------- 吉祥物
$$('.mascot').forEach((el) => Frog.mount(el, el.dataset.mood || 'idle'));
// 开始页的小青蛙偶尔眨一下眼
(function blink() {
  const el = $('#heroFrog'); if (!el) return;
  setInterval(() => {
    if (document.hidden || !$('section[data-tab="welcome"].on')) return;
    if ((el.dataset.mood || 'idle') !== 'idle') return;
    Frog.mount(el, 'blink'); setTimeout(() => Frog.mount(el, el.dataset.mood || 'idle'), 160);
  }, 4200);
})();

// -------------------------------------------------- 导航
function showTab(tab) {
  if (!$(`section[data-tab="${tab}"]`)) tab = 'welcome';
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $$('section').forEach((s) => s.classList.toggle('on', s.dataset.tab === tab));
  if (tab === 'history') loadHistory();
  if (tab === 'welcome') loadRecent();
}
$$('nav a').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.tab)));
$$('[data-go]').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.go)));
api.on('settings:tab', showTab);
$('#qCapture').addEventListener('click', () => api.invoke('app:action', 'capture'));
$('#qRecord').addEventListener('click', () => api.invoke('app:action', 'record'));
$('#qRecordFull').addEventListener('click', () => api.invoke('app:action', 'recordFull'));
$$('[data-act]').forEach((b) => b.addEventListener('click', () => api.invoke('app:action', b.dataset.act)));

// -------------------------------------------------- 联动：从属设置随开关显示 / 隐藏
// data-dep="present.halo"（开关为真才显示）| "capture.imageFormat=jpg"（等于某值）| "a|b"（任一满足）
function depOk(expr) {
  return expr.split('|').some((part) => {
    const [k, v] = part.split('=');
    const cur = get(k.trim());
    return v === undefined ? !!cur : String(cur) === v.trim();
  });
}
function applyDeps() { $$('[data-dep]').forEach((el) => el.classList.toggle('dep-off', !depOk(el.dataset.dep))); }

// -------------------------------------------------- 普通设置绑定
function bindFields() {
  $$('[data-k]').forEach((el) => {
    const k = el.dataset.k; const v = get(k);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : String(v);
    const em = $(`[data-v="${k}"]`); if (em) em.textContent = v;
    if (el._bound) return; el._bound = true;
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) val = Number(val);
      const em2 = $(`[data-v="${k}"]`); if (em2) em2.textContent = val;
      set(k, val).then(() => { toast(tx('已保存')); updateAudioTips(); applyDeps(); });
    });
  });
  applyDeps();
  $$('[data-pick]').forEach((b) => {
    if (b._bound) return; b._bound = true;
    b.addEventListener('click', async () => { const p = await api.invoke('dialog:pickDir', get(b.dataset.pick)); if (p) { await set(b.dataset.pick, p); bindFields(); toast(tx('已保存')); } });
  });
  $$('[data-open]').forEach((b) => { if (b._bound) return; b._bound = true; b.addEventListener('click', () => api.invoke('shell:openPath', get(b.dataset.open))); });
  updateAudioTips();
  renderSwatches();
}

// -------------------------------------------------- 演示：颜色、聚光灯、摄像头
const SWATCHES = ['#ffd23f', '#ff6b6b', '#ff4d6d', '#3d8bff', '#4dabf7', '#51cf66', '#cc5de8', '#ffffff'];
function renderSwatches() {
  $$('[data-color]').forEach((box) => {
    const k = box.dataset.color; const cur = String(get(k) || '').toLowerCase();
    box.innerHTML = '';
    for (const c of SWATCHES) {
      const b = document.createElement('button'); b.className = 'swatch' + (c === cur ? ' on' : ''); b.style.background = c; b.title = c; b.dataset.c = c;
      b.addEventListener('click', () => set(k, c).then(() => { renderSwatches(); toast(tx('已保存')); }));
      box.appendChild(b);
    }
  });
}
let PST = { demo: false, spot: false, cam: false };
function renderPresent() {
  const sb = $('#spotToggle'), cb = $('#camPreview');
  if (sb) { sb.textContent = PST.spot ? tx('关闭聚光灯') : tx('打开聚光灯'); sb.classList.toggle('primary', !!PST.spot); }
  if (cb) { cb.textContent = PST.cam ? tx('关闭摄像头') : tx('打开摄像头'); cb.classList.toggle('primary', !!PST.cam); }
}
api.on('settings:present', (st) => { PST = st || PST; renderPresent(); });
$('#spotToggle').addEventListener('click', async () => { PST = await api.invoke('app:action', 'spotToggle'); renderPresent(); });
$('#camPreview').addEventListener('click', async () => { PST = await api.invoke('app:action', 'cameraPreview'); renderPresent(); });
async function scanCams(ask) {
  try {
    if (ask) { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#camSel'); const cur = S.present.cameraDeviceId;
    sel.innerHTML = ''; { const o = document.createElement('option'); o.value = ''; o.textContent = tx('系统默认'); sel.appendChild(o); }
    devs.forEach((d, i) => { if (!d.deviceId || d.deviceId === 'default') return; const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || tx('摄像头 {n}', { n: i + 1 }); sel.appendChild(o); });
    if (cur && ![...sel.options].some((o) => o.value === cur)) { const o = document.createElement('option'); o.value = cur; o.textContent = tx('上次选的摄像头（未连接）'); sel.appendChild(o); }
    sel.value = cur || '';
    if (ask) toast(tx('找到 {n} 个摄像头', { n: devs.length }));
  } catch (e) { toast(tx('无法访问摄像头：') + (/NotReadable/.test(e.name) ? tx('正被其他程序使用') : e.message)); }
}
$('#camScan').addEventListener('click', () => scanCams(true));

// 录音提示：系统声音 + 麦克风同时开时建议戴耳机；麦克风选成「立体声混音」类设备时提醒
const MIX_RE = /stereo mix|立体声混音|立體聲混音|what u hear|wave out mix|loopback|blackhole|soundflower/i;
function updateAudioTips() {
  const e = $('#echoTip'), m = $('#mixTip'); if (!e || !m) return;
  e.hidden = !(get('record.systemAudio') && get('record.mic'));
  const sel = $('#micSel'); const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
  m.hidden = !(get('record.mic') && opt && opt.value && MIX_RE.test(opt.textContent || ''));
}

// -------------------------------------------------- 快捷键录入
const CODE_MAP = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', PrintScreen: 'PrintScreen', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Pause: 'Pause', ScrollLock: 'Scrolllock', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};
function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
  if (/^Numpad[0-9]$/.test(c)) return 'num' + c.slice(6);
  return CODE_MAP[c] || null;
}
function mods(e, forMouse) {
  const m = [];
  if (e.ctrlKey) m.push(isMac ? 'Control' : 'Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  if (e.metaKey) m.push(isMac ? 'Command' : (forMouse ? 'Meta' : 'Super'));
  return m;
}
const MOUSE_LABEL = { MouseMiddle: tx('鼠标中键'), Mouse4: tx('鼠标侧键(后退)'), Mouse5: tx('鼠标侧键(前进)'), MouseRight: tx('鼠标右键') };
function prettyMouse(v) { if (!v) return ''; const p = v.split('+'); const b = p.pop(); return [...p, MOUSE_LABEL[b] || b].join(' + '); }
function prettyKey(v) {
  if (!v) return '';
  if (!isMac) return v.replace(/\+/g, ' + ');
  return v.replace('Control', '⌃').replace('Command', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, ' ');
}

function statusEl(st) {
  const s = document.createElement('i'); s.className = 'st';
  if (st === 'ok') { s.classList.add('ok'); s.title = tx('已生效'); }
  else if (st === 'fail') { s.classList.add('fail'); s.title = tx('被其他软件占用或无效，请换一个'); }
  else if (st === 'needPermission') { s.classList.add('perm'); s.title = tx('需要在系统设置中授权「辅助功能」'); }
  else s.style.visibility = 'hidden';
  return s;
}
let listening = null;
function renderHotkeys() {
  const tb = $('#hkTable tbody'); if (!tb || listening) return;
  tb.innerHTML = '';
  for (const [action, label] of ACTIONS) {
    const tr = document.createElement('tr');
    const b = S.hotkeys[action] || { keyboard: '', mouse: '' };
    const st = STATUS[action] || {};
    const td0 = document.createElement('td'); td0.textContent = label; tr.appendChild(td0);
    for (const kind of ['keyboard', 'mouse']) {
      const td = document.createElement('td');
      const box = document.createElement('div'); box.className = 'hkbox';
      const inp = document.createElement('input'); inp.className = 'hkin'; inp.readOnly = true;
      inp.value = kind === 'keyboard' ? prettyKey(b.keyboard) : prettyMouse(b.mouse);
      inp.placeholder = kind === 'keyboard' ? tx('点击后按下组合键') : tx('点击后按鼠标中键/侧键');
      inp.dataset.action = action; inp.dataset.kind = kind;
      setupRecorder(inp);
      const clr = document.createElement('button'); clr.className = 'clr'; clr.textContent = '×'; clr.title = tx('清除');
      clr.addEventListener('click', () => saveBinding(action, kind, ''));
      box.appendChild(inp); box.appendChild(clr);
      if (b[kind]) box.appendChild(statusEl(st[kind]));
      td.appendChild(box); tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
}

async function saveBinding(action, kind, value) {
  // 冲突检测：同一组合不能分配给两个功能
  if (value) {
    for (const [a] of ACTIONS) {
      if (a !== action && S.hotkeys[a] && S.hotkeys[a][kind] === value) {
        await api.invoke('settings:set', { hotkeys: { [a]: { [kind]: '' } } });
        toast(tx('已从「{name}」移除同一快捷键', { name: ACTIONS.find((x) => x[0] === a)[1] }));
      }
    }
  }
  listening = null;
  await api.invoke('hotkeys:pause', false);
  const r = await api.invoke('settings:set', { hotkeys: { [action]: { [kind]: value } } });
  S = r.settings; STATUS = r.status || STATUS;
  renderHotkeys(); renderKeyHints();
  const st = (STATUS[action] || {})[kind];
  if (value && st === 'fail') toast(tx('这个快捷键被其他软件占用了，请换一个'));
  else if (value) toast(tx('快捷键已生效'));
}

function setupRecorder(inp) {
  const kind = inp.dataset.kind, action = inp.dataset.action;
  const startListen = async () => {
    if (listening === inp) return;
    listening = inp;
    await api.invoke('hotkeys:pause', true);
    inp.classList.add('listening');
    inp.value = '';
    inp.placeholder = kind === 'keyboard' ? tx('请按下组合键…（Esc 取消）') : tx('请按鼠标中键 / 侧键…（可按住 Ctrl/Alt/Shift）');
  };
  const stopListen = async () => {
    if (listening !== inp) return;
    listening = null;
    await api.invoke('hotkeys:pause', false);
    renderHotkeys();
  };
  inp.addEventListener('focus', startListen);
  inp.addEventListener('blur', () => setTimeout(stopListen, 50));
  if (kind === 'keyboard') {
    // Windows 上 PrintScreen 只有 keyup 事件
    inp.addEventListener('keyup', (e) => {
      if (listening !== inp || e.code !== 'PrintScreen') return;
      e.preventDefault(); e.stopPropagation();
      const m = mods(e, false);
      inp.value = prettyKey([...m, 'PrintScreen'].join('+'));
      saveBinding(action, kind, [...m, 'PrintScreen'].join('+'));
      inp.blur();
    });
    inp.addEventListener('keydown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (listening !== inp) return;
      if (e.key === 'Escape') { inp.blur(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) { saveBinding(action, kind, ''); inp.blur(); return; }
      const k = keyName(e);
      const m = mods(e, false);
      inp.value = prettyKey([...m, k || ''].filter(Boolean).join('+'));
      if (!k) return; // 只按了修饰键
      const fnKey = /^F\d+$/.test(k) || k === 'PrintScreen' || k === 'Pause';
      if (!m.length && !fnKey) { inp.value = ''; inp.placeholder = tx('需要配合 Ctrl / Alt / Shift 等修饰键'); return; }
      saveBinding(action, kind, [...m, k].join('+'));
      inp.blur();
    });
  } else {
    inp.addEventListener('mousedown', (e) => {
      if (listening !== inp) { return; }
      const map = { 1: 'MouseMiddle', 2: 'MouseRight', 3: 'Mouse4', 4: 'Mouse5' };
      const name = map[e.button];
      if (!name) return; // 左键用于激活
      e.preventDefault(); e.stopPropagation();
      const m = mods(e, true);
      if (name === 'MouseRight' && !m.length) { inp.placeholder = tx('右键需要配合 Ctrl / Alt / Shift'); return; }
      saveBinding(action, kind, [...m, name].join('+'));
      inp.blur();
    });
    inp.addEventListener('contextmenu', (e) => e.preventDefault());
    inp.addEventListener('auxclick', (e) => e.preventDefault());
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') inp.blur();
      if (e.key === 'Backspace' || e.key === 'Delete') { saveBinding(action, kind, ''); inp.blur(); }
    });
  }
}
// 阻止侧键触发"后退"
window.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });

function renderKeyHints() {
  $$('[data-show]').forEach((el) => {
    const h = S.hotkeys[el.dataset.show] || {};
    el.textContent = [prettyKey(h.keyboard), prettyMouse(h.mouse)].filter(Boolean).join('  /  ') || tx('未设置');
  });
}
$('#hkReset').addEventListener('click', async () => {
  const d = await api.invoke('settings:reset');
  // reset 会重置全部设置；这里仅保留快捷键重置的效果，其他设置写回
  const keep = { ...S }; delete keep.hotkeys;
  const r = await api.invoke('settings:set', keep);
  S = r.settings; STATUS = r.status; renderHotkeys(); renderKeyHints(); toast(tx('已恢复默认快捷键'));
});
$('#resetAll').addEventListener('click', async () => {
  if (!confirm(tx('确定恢复全部默认设置？'))) return;
  const r = await api.invoke('settings:reset'); S = r.settings; STATUS = r.status; bindFields(); renderHotkeys(); renderKeyHints(); toast(tx('已恢复默认'));
});

// -------------------------------------------------- 声音试听
const audioCache = {};
$$('[data-play]').forEach((b) => b.addEventListener('click', () => {
  let name = b.dataset.play;
  if (name === 'capture') name = S.sound.capture === 'off' ? '' : S.sound.capture;
  if (!name) { toast(tx('截图音效已关闭')); return; }
  const a = (audioCache[name] = audioCache[name] || new Audio(`../../assets/sounds/${name}.wav`));
  a.volume = (S.sound.volume ?? 70) / 100; a.currentTime = 0; a.play().catch(() => {});
}));

// -------------------------------------------------- 麦克风
async function scanMics(ask) {
  try {
    if (ask) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const sel = $('#micSel'); const cur = S.record.micDeviceId;
    sel.innerHTML = `<option value="">${tx('系统默认')}</option>`;
    devs.forEach((d, i) => { if (d.deviceId === 'default') return; const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || tx('麦克风 {n}', { n: i + 1 }); sel.appendChild(o); });
    sel.value = cur || '';
    updateAudioTips();
    if (ask) toast(tx('找到 {n} 个麦克风', { n: devs.length }));
  } catch (e) { toast(tx('无法访问麦克风：') + e.message); }
}
$('#micScan').addEventListener('click', () => scanMics(true));

// -------------------------------------------------- 历史
async function histCopy(id) {
  const r = await api.invoke('history:copy', id).catch((e) => ({ ok: false, error: e.message }));
  toast(r && r.ok ? tx('已复制到剪贴板') : tx('复制失败：') + ((r && r.error) || tx('剪贴板被占用，请重试')));
}
async function loadHistory() {
  const grid = $('#histGrid');
  const items = await api.invoke('history:list');
  grid.innerHTML = '';
  if (!items.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${Frog.svg('sad', 96, 'class="mascot"')}<div>${tx('还没有截图。按截图快捷键试试吧。')}</div></div>`; return; }
  for (const it of items) {
    const d = document.createElement('div'); d.className = 'item';
    const t = new Date(it.time);
    d.innerHTML = `<img src="${it.thumb}" title="${tx('点击复制到剪贴板')}"><div class="meta">${t.toLocaleString(I18N.locale())} · ${it.width}×${it.height}</div><div class="acts"><button data-a="copy">${tx('复制')}</button><button data-a="pin">${tx('贴图')}</button><button data-a="save">${tx('另存')}</button><button data-a="del">${tx('删除')}</button></div>`;
    $('img', d).addEventListener('click', () => histCopy(it.id));
    $$('button', d).forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'copy') await histCopy(it.id);
      if (a === 'pin') { const r = await api.invoke('history:pin', it.id).catch((e) => ({ ok: false, error: e.message })); if (r && r.ok === false) toast(tx('贴图失败：') + (r.error || '')); }
      if (a === 'save') { const r = await api.invoke('history:save', it.id).catch((e) => ({ ok: false, error: e.message })); if (r && r.ok) toast(tx('已保存')); else if (r && !r.canceled) toast(tx('保存失败：') + (r.error || tx('无法写入'))); }
      if (a === 'del') { await api.invoke('history:delete', it.id); loadHistory(); }
    }));
    grid.appendChild(d);
  }
}
$('#histRefresh').addEventListener('click', loadHistory);
$('#histClear').addEventListener('click', async () => { if (confirm(tx('清空全部截图历史？'))) { await api.invoke('history:clear'); loadHistory(); loadRecent(); } });
api.on('history:changed', () => { if ($('section[data-tab="history"]').classList.contains('on')) loadHistory(); if ($('section[data-tab="welcome"]').classList.contains('on')) loadRecent(); });
// 开始页：最近 4 张，点击复制
async function loadRecent() {
  const box = $('#recentGrid'); if (!box) return;
  const items = (await api.invoke('history:list')).slice(0, 4);
  box.innerHTML = '';
  if (!items.length) {
    const k = (S && S.hotkeys.capture && (prettyKey(S.hotkeys.capture.keyboard) || prettyMouse(S.hotkeys.capture.mouse))) || tx('未设置');
    box.innerHTML = `<div class="empty" style="grid-column:1/-1">${Frog.svg('wink', 84, 'class="mascot"')}<div>${tx('还没有截图')}<br><small>${tx('按下 {k} 试试', { k })}</small></div></div>`;
    return;
  }
  for (const it of items) {
    const d = document.createElement('div'); d.className = 'thumb'; d.title = `${new Date(it.time).toLocaleString(I18N.locale())} · ${it.width}×${it.height}`;
    d.innerHTML = `<img src="${it.thumb}" alt="">`;
    d.addEventListener('click', () => histCopy(it.id));
    box.appendChild(d);
  }
}

// 主进程改了设置（例如快捷键被占用后自动换键）时刷新界面；正在录入快捷键时不打断
api.on('settings:changed', async () => {
  if (listening) return;
  const r = await api.invoke('settings:get');
  S = r.settings; STATUS = r.status || {};
  bindFields(); renderHotkeys(); renderKeyHints();
});

// -------------------------------------------------- macOS 权限状态（1.3.5）
async function renderMacPerm() {
  if (!isMac || !$('#macPerm')) return;
  let st = null; try { st = await api.invoke('app:action', 'macPermState'); } catch {}
  if (!st || !st.mac) return;
  $$('.mperm').forEach((el) => {
    const v = st[el.dataset.perm], ok = v === 'granted';
    const optional = !ok && el.dataset.perm === 'accessibility' && !st.axNeeded;   // 没用鼠标快捷键 / 点击波纹：不需要，不标红
    const compact = !!el.closest('#welcomePerm');
    el.classList.toggle('ok', ok); el.classList.toggle('bad', !ok && !optional);
    el.querySelector('em').textContent = ok ? tx('已允许') : optional ? (compact ? tx('可选') : tx('未允许（用鼠标快捷键 / 点击波纹时才需要）')) : tx('未允许');
  });
  // 开始页：权限都好了就把那一行收起来（只在需要时出现）
  const wp = $('#welcomePerm'); if (wp) wp.parentElement.hidden = st.screen === 'granted' && (st.accessibility === 'granted' || !st.axNeeded);
  const hf = $('#heroFrog'); if (hf) { hf.dataset.mood = st.screen === 'granted' ? 'idle' : 'sad'; Frog.mount(hf, hf.dataset.mood); }
}
if (isMac) {
  window.addEventListener('focus', renderMacPerm);
  setInterval(() => { if (document.hasFocus() && ($('section[data-tab="general"].on') || $('section[data-tab="welcome"].on'))) renderMacPerm(); }, 3000);
  api.on('settings:changed', renderMacPerm);
}
// 关于 → 检查更新
if ($('#checkUpdate')) $('#checkUpdate').addEventListener('click', async () => {
  const st = $('#updateStatus'); st.className = 'status-inline'; st.textContent = tx('检查中…');
  let r = null; try { r = await api.invoke('app:action', 'checkUpdate'); } catch {}
  if (!r || !r.ok) { st.textContent = tx('没连上 GitHub，稍后再试'); return; }
  if (!r.hasUpdate) { st.textContent = tx('已是最新版本'); return; }
  st.className = 'status-inline ok'; st.textContent = '';
  const a = document.createElement('a'); a.textContent = tx('有新版本 {v}，去下载', { v: r.latest }); a.addEventListener('click', () => api.invoke('app:action', 'openReleases')); st.append(a);
});
if ($('#macDiag')) $('#macDiag').addEventListener('click', async () => {
  try { await api.invoke('app:action', 'macDiag'); toast(tx('诊断信息已复制，可以直接粘贴发给我们')); } catch { toast(tx('复制失败')); }
});

// -------------------------------------------------- 初始化
(async () => {
  const r = await api.invoke('settings:get');
  S = r.settings; STATUS = r.status || {};
  $('#ver').textContent = 'v' + r.version; $('#verSide').textContent = r.version;
  bindFields(); renderHotkeys(); renderKeyHints(); scanMics(false); scanCams(false);
  PST = await api.invoke('app:action', 'presentState'); renderPresent();
  const q = new URLSearchParams(location.search);
  showTab(q.get('tab') || 'welcome');
  renderMacPerm();
  if (+q.get('scroll') > 0) $('main').scrollTop = +q.get('scroll');
})();
