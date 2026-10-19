'use strict';
const tr = (s) => (s && typeof tx === 'function' ? tx(s) : (s || ''));
if (window.api && api.platform === 'darwin') document.body.classList.add('mac');
if (window.api && api.platform === 'win32') document.body.classList.add('win');
const drop = document.getElementById('drop');
const actions = document.getElementById('actions');
const picked = document.getElementById('picked');
const recent = document.getElementById('recent');
let files = [];
let model = null;

function send(ch, extra) {
  if (window.api && api.send) api.send(ch, Object.assign({ files }, extra || {}));
}
function pathsFrom(list) {
  return [...list].map((f) => (window.api && api.pathForFile ? api.pathForFile(f) : '')).filter(Boolean);
}
function macChip(acc) {
  const map = { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Command: '⌘', Cmd: '⌘', Meta: '⌘' };
  return String(acc || 'Control+Alt+F').split('+').map((p) => map[p] || p).join('');
}
function chipText(payload) {
  const plat = (payload && (payload.platform || (payload.shot === 'win' ? 'win32' : payload.shot === 'mac' ? 'darwin' : '')))
    || (document.body.classList.contains('win') ? 'win32' : 'darwin');
  const acc = payload && payload.hotkey;
  if (plat === 'win32') return acc || 'Ctrl+Shift+Alt+F';
  return macChip(acc || 'Control+Alt+F');
}
function paintHint(payload) {
  const hint = document.getElementById('hintText');
  const chip = document.getElementById('chip');
  if (hint) hint.textContent = tr('拖不到菜单栏图标时用快捷键');
  if (chip) chip.textContent = chipText(payload || {});
}
paintHint(null);

function renderWindow(payload) {
  if (!payload) return;
  paintHint(payload);
  if (payload.platform === 'darwin' || payload.shot === 'mac') document.body.classList.add('mac');
  if (payload.platform === 'win32' || payload.shot === 'win') document.body.classList.add('win');
  if (payload.files) files = payload.files;
  model = payload.model || null;
  if (payload.names && payload.names.length) {
    picked.hidden = false;
    picked.textContent = payload.names.join('、');
  } else picked.hidden = true;
  actions.innerHTML = '';
  const keys = (model && model.keys) || [];
  keys.forEach((k) => {
    if (k.action === 'image.convert' && k.pills) {
      k.pills.forEach((p) => actions.appendChild(act('转格式 · ' + p.label, false, () => send('filetools:run', { action: 'image.convert', options: { format: p.format } }))));
      return;
    }
    if (k.action === 'image.resize') {
      (k.pills || []).forEach((p) => actions.appendChild(act(p.label, p.grey, () => {
        if (!p.grey) send('filetools:run', { action: 'image.resize', options: { mode: p.mode, value: p.value } });
      }, p.reason)));
      if (k.custom) actions.appendChild(act(k.custom.label, false, () => send('filetools:panel', { kind: 'resize' })));
      return;
    }
    const gifTrim = k.action === 'video.gif' && k.route === 'trim';
    actions.appendChild(act(k.label, k.grey && !gifTrim && k.action !== 'video.gif', () => {
      if (gifTrim) send('filetools:panel', { kind: 'trim', gif: true, start: 0, end: 15, confirm: k.confirm || '剪切并转 GIF' });
      else if (k.action === 'image.compress') send('filetools:panel', { kind: 'compress-image' });
      else if (k.action === 'video.compress') send('filetools:panel', { kind: 'compress-video' });
      else if (k.action === 'video.trim') send('filetools:panel', { kind: 'trim' });
      else if (!k.grey) send('filetools:run', { action: k.action, options: {} });
    }, k.reason));
  });
  if (payload.warning) {
    const p = document.createElement('p');
    p.className = 'sub';
    p.textContent = tr(payload.warning);
    actions.appendChild(p);
  }
  recent.innerHTML = '';
  (payload.recent || []).forEach((item) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.name + (item.bytes ? '' : '');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tr(item.reveal || '在 Finder 中显示');
    b.addEventListener('click', () => send('filetools:reveal', { file: item.file }));
    li.appendChild(name); li.appendChild(b);
    recent.appendChild(li);
  });
}
function act(label, disabled, on, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = tr(label);
  b.disabled = !!disabled;
  if (title) b.title = tr(title);
  b.addEventListener('click', on);
  return b;
}

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hot'); });
drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('hot');
  const list = pathsFrom(e.dataTransfer.files || []);
  if (list.length) send('filetools:inspect', { files: list });
});
document.getElementById('pick').addEventListener('click', () => send('filetools:pick'));
window.renderWindow = renderWindow;
if (window.api && api.on) api.on('filetools:window', renderWindow);
