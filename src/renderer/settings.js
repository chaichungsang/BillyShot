'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const isMac = api.platform === 'darwin';
document.body.classList.add(api.platform);
$$('.mod').forEach((m) => (m.textContent = isMac ? '⌘' : 'Ctrl+'));
const licence = document.getElementById('licenceNotice');
if (licence) licence.textContent = tx('文件工具的视频处理使用 LGPL ffmpeg（动态链接，没有静态打进本程序）。图片处理使用 sharp / libvips（LGPL-3.0-or-later）。');

let S = null, STATUS = {};
const ACTIONS = [
  ['capture', tx('截图（框选 + 编辑）')],
  ['captureFull', tx('全屏截图直接复制')],
  ['recordRegion', tx('区域录屏 / 停止')],
  ['recordFull', tx('全屏录屏 / 停止')],
  ['pinClipboard', tx('贴图（钉住剪贴板图片）')],
  ['presentMode', tx('演示模式（鼠标光圈 / 点击波纹）开关')],
  ['spotlight', tx('聚光灯 开关')],
  ['fileTools', tx('文件工具')],
];

function get(path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), S); }
function patchOf(path, value) { const keys = path.split('.'); const out = {}; let o = out; keys.forEach((k, i) => { if (i === keys.length - 1) o[k] = value; else o = o[k] = {}; }); return out; }
async function set(path, value) { const r = await api.invoke('settings:set', patchOf(path, value)); S = r.settings; STATUS = r.status || STATUS; renderHotkeys(); renderKeyHints(); }
function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1400); }

// -------------------------------------------------- 导航
function showTab(tab) {
  if (!$(`section[data-tab="${tab}"]`)) tab = 'welcome';
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $$('section').forEach((s) => s.classList.toggle('on', s.dataset.tab === tab));
  if (tab === 'history') loadHistory();
}
$$('nav a').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.tab)));
api.on('settings:tab', showTab);
$('#qCapture').addEventListener('click', () => api.invoke('app:action', 'capture'));
$('#qRecord').addEventListener('click', () => api.invoke('app:action', 'record'));
$$('[data-act]').forEach((b) => b.addEventListener('click', () => api.invoke('app:action', b.dataset.act)));

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
      set(k, val).then(() => { toast(tx('已保存')); updateAudioTips(); });
    });
  });
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
  const r = await api.invoke('settings:reset'); S = r.settings; STATUS = r.status; bindFields(); renderHotkeys(); renderKeyHints(); renderLogo(); renderThemes(); toast(tx('已恢复默认'));
});

// -------------------------------------------------- 应用图标
const LOGO_HINT = isMac
  ? tx('菜单栏、程序坞和「应用程序」里的 BillyShot 会一起换成所选图标')
  : api.platform === 'win32' ? tx('托盘、窗口、桌面 / 开始菜单 / 任务栏快捷方式会一起换成所选图标') : tx('托盘和窗口会换成所选图标');
function renderLogo() {
  const name = get('general.logo') === 'purple' ? 'purple' : 'portrait';
  $$('.logo-opt').forEach((o) => { o.classList.toggle('on', o.dataset.logo === name); $('input', o).checked = o.dataset.logo === name; });
  $$('.logo-img').forEach((img) => { img.src = `../../assets/logos/${name}/icon256.png`; });
  $('#logoHint').textContent = LOGO_HINT;
}
function logoMessage(r) {
  const m = $('#logoMsg'); const parts = []; let warn = false;
  if (r.shortcuts && r.shortcuts.failed) { parts.push(tx('有快捷方式没改成功，可在快捷方式上右键 → 属性 → 更改图标')); warn = true; }
  else if (r.shortcuts && r.shortcuts.changed) parts.push(tx('已更新 {n} 个快捷方式，桌面图标若没立刻变，稍等几秒或按 F5 刷新', { n: r.shortcuts.changed }));
  if (r.finder && !r.finder.ok && !r.finder.skipped) { parts.push(tx('「应用程序」里的图标系统没让改（菜单栏和程序坞已换）。可在访达里选中 BillyShot → 显示简介，把图标拖上去')); warn = true; }
  else if (r.finder && r.finder.ok && !r.finder.unchanged) parts.push(tx('访达里的图标已更换，程序坞里固定的图标在下次打开时更新'));
  m.hidden = !parts.length; m.textContent = parts.join(tx('。')); m.classList.toggle('warn', warn);
}
$$('.logo-opt input').forEach((inp) => inp.addEventListener('change', async () => {
  if (!inp.checked) return;
  $$('.logo-opt').forEach((o) => o.classList.add('busy'));
  try {
    const r = await api.invoke('settings:logo', inp.value);
    if (r.settings) S = r.settings;
    renderLogo(); renderThemes(); logoMessage(r); toast(tx('图标已更换'));
  } finally { $$('.logo-opt').forEach((o) => o.classList.remove('busy')); }
}));


// -------------------------------------------------- 主题配色
// 预览小图用的颜色（浅色模式）：侧栏、背景、强调色两端
const THEMES = [
  ['midnight', '午夜紫', '#0f0f13', '#f6f6f8', '#6e6bff', '#a66bff'],
  ['gold', '黑金', '#0b0b0c', '#f7f5f1', '#c99a52', '#e9cf9c'],
  ['graphite', '石墨', '#18181b', '#f4f4f5', '#27272a', '#52525b'],
  ['ocean', '深海蓝', '#08121f', '#f4f7fb', '#2f7bff', '#22c3ee'],
  ['forest', '森林绿', '#0b1511', '#f4f8f6', '#16a36a', '#5ad3a0'],
  ['rose', '玫瑰粉', '#170d12', '#fbf6f7', '#f2557f', '#ff9a76'],
  ['paper', '纯白', '#ffffff', '#f6f6f8', '#6e6bff', '#a66bff'],
  ['glass', '透明玻璃', 'rgba(255,255,255,.5)', 'radial-gradient(at 15% 10%,#cbb9ff,transparent 55%),radial-gradient(at 90% 20%,#9fd8ff,transparent 50%),radial-gradient(at 60% 100%,#ffc6e2,transparent 55%),#eef0f7', '#5b7cfa', '#b06bff'],
  ['matrix', 'Matrix 代码雨', '#000000', '#020804', '#00ff66', '#00b84a'],
];
let CAN_MATERIAL = false;
// 「跟随图标」：头像版 → 黑金，紫色版 → 午夜紫
function autoTheme() { return get('general.logo') === 'purple' ? 'midnight' : 'gold'; }
function resolvedTheme() {
  const v = get('general.theme');
  return THEMES.some((t) => t[0] === v) ? v : autoTheme();
}
function themePreview(id) {
  const t = THEMES.find((x) => x[0] === id);
  const el = document.createElement('div'); el.className = 'tp';
  el.innerHTML = '<i class="tp-side"><b></b><b></b><b></b></i><i class="tp-main"><b class="tp-card"></b><b class="tp-btn"></b></i>';
  el.querySelector('.tp-side').style.background = t[2];
  el.querySelector('.tp-main').style.background = t[3];
  el.querySelector('.tp-btn').style.background = `linear-gradient(135deg, ${t[4]}, ${t[5]})`;
  el.querySelector('.tp-side b').style.background = t[4];
  if (id === 'paper') el.querySelector('.tp-side').style.boxShadow = 'inset -1px 0 0 #e4e4ea';
  if (id === 'matrix') { el.querySelector('.tp-card').style.background = '#06160b'; el.querySelector('.tp-card').style.borderColor = '#0f3a1c'; el.classList.add('tp-matrix'); }
  if (id === 'glass') { el.querySelector('.tp-card').style.background = 'rgba(255,255,255,.6)'; el.querySelector('.tp-side').style.backdropFilter = 'blur(4px)'; }
  return el;
}
function renderThemes() {
  const box = $('#themeOpts'); if (!box) return;
  const cur = get('general.theme') || 'auto';
  const resolved = resolvedTheme(), auto = autoTheme();
  box.textContent = '';
  const items = [['auto', tx('跟随图标')]].concat(THEMES.map((t) => [t[0], tx(t[1])]));
  for (const [id, name] of items) {
    const lab = document.createElement('label'); lab.className = 'theme-opt'; lab.dataset.theme = id;
    lab.classList.toggle('on', cur === id || (id === 'auto' && !THEMES.some((t) => t[0] === cur)));
    const inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'theme'; inp.value = id; inp.checked = lab.classList.contains('on');
    lab.appendChild(inp);
    lab.appendChild(themePreview(id === 'auto' ? auto : id));
    const cap = document.createElement('span');
    const sub = id === 'auto' ? tx('{name}（按图标）', { name: tx(THEMES.find((t) => t[0] === auto)[1]) })
      : id === 'glass' ? (CAN_MATERIAL ? tx('透出桌面') : tx('毛玻璃效果')) : id === 'matrix' ? tx('只有深色') : '';
    cap.innerHTML = '<b></b><small></small>'; cap.querySelector('b').textContent = name; cap.querySelector('small').textContent = sub;
    lab.appendChild(cap);
    if (id === 'auto') { const badge = document.createElement('em'); badge.className = 'tp-auto'; badge.textContent = tx('默认'); lab.appendChild(badge); }
    inp.addEventListener('change', () => { if (inp.checked) chooseTheme(id); });
    box.appendChild(lab);
  }
  $('#modeSel').disabled = resolved === 'matrix';
  $('#modeSel').title = resolved === 'matrix' ? tx('Matrix 只有深色') : '';
}
async function chooseTheme(id) {
  $$('.theme-opt').forEach((o) => o.classList.add('busy'));
  try {
    const r = await api.invoke('settings:theme', id);
    if (r.settings) S = r.settings;
    if (r.rebuilding) return;   // Mac：设置窗口正在按新主题重建，这个窗口马上会被换掉
    applyThemeDom(r.theme, r.material);
    renderThemes(); toast(tx('配色已更换'));
  } finally { $$('.theme-opt').forEach((o) => o.classList.remove('busy')); }
}
// Matrix 侧栏代码雨：低帧率、窗口隐藏时暂停，系统开了「减少动态效果」就不动
let rain = null;
function startRain() {
  if (rain) return;
  const aside = $('aside'); const cv = document.createElement('canvas'); cv.id = 'rain'; aside.prepend(cv);
  const ctx = cv.getContext('2d'); const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF$#*+<>=';
  let cols = [], fs = 14, timer = 0;
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() {
    const dpr = window.devicePixelRatio || 1; cv.width = aside.clientWidth * dpr; cv.height = aside.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cols = Array.from({ length: Math.ceil(aside.clientWidth / fs) }, () => Math.random() * -40);
  }
  function frame() {
    if (document.hidden) return;
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, 0, aside.clientWidth, aside.clientHeight);
    ctx.font = fs + 'px monospace';
    cols.forEach((y, i) => {
      const ch = chars[(Math.random() * chars.length) | 0];
      ctx.fillStyle = Math.random() > .96 ? '#d6ffe2' : '#00ff66';
      ctx.fillText(ch, i * fs, y * fs);
      cols[i] = y * fs > aside.clientHeight && Math.random() > .975 ? 0 : y + 1;
    });
  }
  size(); window.addEventListener('resize', size);
  if (still) { for (let i = 0; i < 60; i++) frame(); } else timer = setInterval(frame, 70);
  rain = { stop() { clearInterval(timer); window.removeEventListener('resize', size); cv.remove(); } };
}
function stopRain() { if (rain) { rain.stop(); rain = null; } }
function applyThemeDom(theme, material) {
  const h = document.documentElement;
  h.dataset.theme = theme;
  h.classList.toggle('material', !!material);
  if (theme === 'matrix') startRain(); else stopRain();
}
api.on('settings:theme', (r) => {
  if (!r) return;
  if (S && S.general && r.setting) S.general.theme = r.setting;
  applyThemeDom(r.theme, r.material); renderThemes();
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
  if (!items.length) { grid.innerHTML = `<div class="empty">${tx('还没有截图。按截图快捷键试试吧。')}</div>`; return; }
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
$('#histClear').addEventListener('click', async () => { if (confirm(tx('清空全部截图历史？'))) { await api.invoke('history:clear'); loadHistory(); } });
api.on('history:changed', () => { if ($('section[data-tab="history"]').classList.contains('on')) loadHistory(); });

// 主进程改了设置（例如快捷键被占用后自动换键）时刷新界面；正在录入快捷键时不打断
api.on('settings:changed', async () => {
  if (listening) return;
  const r = await api.invoke('settings:get');
  S = r.settings; STATUS = r.status || {};
  bindFields(); renderHotkeys(); renderKeyHints(); renderLogo(); renderThemes();
});

// -------------------------------------------------- macOS 权限状态（1.3.5）
async function renderMacPerm() {
  if (!isMac || !$('#macPerm')) return;
  let st = null; try { st = await api.invoke('app:action', 'macPermState'); } catch {}
  if (!st || !st.mac) return;
  $$('#macPerm .mperm').forEach((el) => {
    const v = st[el.dataset.perm], ok = v === 'granted';
    const optional = !ok && el.dataset.perm === 'accessibility' && !st.axNeeded;   // 没用鼠标快捷键 / 点击波纹：不需要，不标红
    el.classList.toggle('ok', ok); el.classList.toggle('bad', !ok && !optional);
    el.querySelector('em').textContent = ok ? tx('已允许') : optional ? tx('未允许（用鼠标快捷键 / 点击波纹时才需要）') : tx('未允许');
  });
}
if (isMac) {
  window.addEventListener('focus', renderMacPerm);
  setInterval(() => { if (document.hasFocus() && $('section[data-tab="general"].on')) renderMacPerm(); }, 3000);
  api.on('settings:changed', renderMacPerm);
}
if ($('#macDiag')) $('#macDiag').addEventListener('click', async () => {
  try { await api.invoke('app:action', 'macDiag'); toast(tx('诊断信息已复制，可以直接粘贴发给我们')); } catch { toast(tx('复制失败')); }
});

// -------------------------------------------------- 初始化
(async () => {
  const r = await api.invoke('settings:get');
  S = r.settings; STATUS = r.status || {};
  $('#ver').textContent = 'v' + r.version;
  CAN_MATERIAL = !!r.canMaterial; applyThemeDom(r.theme, r.material);
  bindFields(); renderHotkeys(); renderKeyHints(); renderLogo(); renderThemes(); scanMics(false); scanCams(false);
  PST = await api.invoke('app:action', 'presentState'); renderPresent();
  const q = new URLSearchParams(location.search);
  showTab(q.get('tab') || 'welcome');
  renderMacPerm();
  // Mac 切入 / 切出「透明玻璃」时设置窗口会重建：回到原来的滚动位置，并提示配色已更换
  if (+q.get('scroll') > 0) $('main').scrollTop = +q.get('scroll');
  if (q.get('toast') === 'theme') toast(tx('配色已更换'));
})();
