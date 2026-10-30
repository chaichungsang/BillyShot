'use strict';
const $ = (id) => document.getElementById(id);
const tr = (s, vars) => (s && typeof tx === 'function' ? tx(s, vars) : (s || ''));
let view = null;

function bytes(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / (1024 * 1024)).toFixed(1) + ' MB';
}
function clock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function send(ch, extra) {
  if (window.api && api.send) api.send(ch, Object.assign({ id: view && view.id, files: view && view.files }, extra || {}));
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function button(label, cls, on, disabled) {
  const b = el('button', cls, tr(label));
  b.type = 'button';
  b.disabled = !!disabled;
  b.addEventListener('click', on);
  return b;
}

function renderPanel(next) {
  paintPanel(next);
  reportSize();
}

// 画完把面板实际高度告诉主进程，窗口跟着缩放（不留空的深色条）。
function reportSize() {
  const panel = $('panel');
  if (!panel || !(window.api && api.send)) return;
  const h = Math.ceil(panel.getBoundingClientRect().height || panel.offsetHeight || 0);
  if (h > 0) api.send('filetools:panel-size', { height: h });
}

function paintPanel(next) {
  const incoming = next || {};
  if (!incoming.action && incoming.kind && view && view.action && incoming.kind !== view.kind && incoming.kind !== view.action) {
    view = Object.assign({}, view, incoming);
    delete view.action;
  } else view = Object.assign({}, view, incoming);
  $('title').textContent = tr(titleFor(view));
  $('body').innerHTML = '';
  $('foot').innerHTML = '';
  if (view.phase === 'done') return renderDone();
  if (view.phase === 'error') return renderError();
  if (view.phase === 'queued') return renderQueued();
  if (view.phase === 'running') return renderRunning();
  if (view.kind === 'compress-image') return renderCompressImage();
  if (view.kind === 'compress-video') return renderCompressVideo();
  if (view.kind === 'trim') return renderTrim();
  if (view.kind === 'resize') return renderResize();
  $('body').appendChild(el('p', 'note', tr('没有可处理的文件')));
}

function titleFor(v) {
  if (typeof filetoolsPanelTitle === 'function') return filetoolsPanelTitle(v);
  return '文件工具';
}
function sizeLineBytes(v) {
  if (typeof filetoolsVisibleEstimate === 'function') return filetoolsVisibleEstimate(v);
  return null;
}
function appendEstimate(parent, v) {
  const n = sizeLineBytes(v);
  if (n == null) return;
  parent.appendChild(el('p', 'est', tr('约 {size}', { size: bytes(n) })));
}
function isVideoCompress(v) {
  return v.action === 'video.compress' || v.kind === 'compress-video' || v.kind === 'video.compress';
}
function isImageCompress(v) {
  return v.action === 'image.compress' || v.kind === 'compress-image' || v.kind === 'image.compress';
}

function fileLine() {
  const name = (view.names && view.names[0]) || '';
  return el('p', 'note', name);
}

function renderCompressImage() {
  const body = $('body');
  const card = el('div', 'card');
  const split = el('div', 'split');
  const l = el('span', 'tag l', tr('原图'));
  const r = el('span', 'tag r', tr('压缩后'));
  split.appendChild(l); split.appendChild(r);
  card.appendChild(split);
  const row = el('div', 'row');
  row.appendChild(el('label', '', tr('质量')));
  const range = document.createElement('input');
  range.type = 'range'; range.min = '40'; range.max = '90'; range.value = String(view.quality || 72);
  const em = el('em', '', range.value);
  range.addEventListener('input', () => { em.textContent = range.value; view.quality = Number(range.value); send('filetools:estimate', { quality: view.quality }); });
  row.appendChild(range); row.appendChild(em);
  card.appendChild(row);
  if (view.format === 'png') card.appendChild(el('p', 'note', tr('PNG 用有损量化，可能轻微变色')));
  const est = el('p', 'est');
  est.id = 'est';
  if (view.estimateBytes) est.textContent = tr('约 {size}', { size: bytes(view.estimateBytes) });
  card.appendChild(est);
  card.appendChild(fileLine());
  body.appendChild(card);
  const foot = $('foot');
  foot.appendChild(el('div', 'status', ''));
  const btns = el('div', 'btns');
  btns.style.marginLeft = 'auto';
  btns.style.display = 'flex';
  btns.style.gap = '8px';
  btns.appendChild(button('取消', 'ghost', () => send('filetools:close-panel')));
  btns.appendChild(button('压缩图片', 'primary', () => send('filetools:run', { action: 'image.compress', options: { quality: Number(range.value) || 72 } }), view.blocked));
  foot.appendChild(btns);
  if (view.disk) body.appendChild(el('p', 'err', tr(view.disk)));
}

function renderCompressVideo() {
  const body = $('body');
  const card = el('div', 'card');
  card.appendChild(el('p', 'note', tr('压缩视频')));
  const levels = el('div', 'levels');
  const cur = view.level || 'medium';
  [['high', '高#q'], ['medium', '中#q'], ['small', '小#q']].forEach(([id, label]) => {
    const b = button(label, 'seg' + (id === cur ? ' on' : ''), () => {
      view.level = id;
      view.estimateBytes = null;
      view.estimateFromDuration = false;
      send('filetools:estimate', { level: id });
      renderPanel(view);
    });
    levels.appendChild(b);
  });
  card.appendChild(levels);
  appendEstimate(card, view);
  card.appendChild(fileLine());
  body.appendChild(card);
  footButtons('压缩视频', () => send('filetools:run', { action: 'video.compress', options: { level: view.level || 'medium' } }));
}

function renderTrim() {
  const body = $('body');
  const card = el('div', 'card');
  card.appendChild(fileLine());
  const fields = el('div', 'fields');
  const start = numField('起', view.start || 0);
  const end = numField('止', view.end != null ? view.end : (view.duration || 0));
  fields.appendChild(start.wrap); fields.appendChild(end.wrap);
  card.appendChild(fields);
  if (view.gif) card.appendChild(el('p', 'note', tr('已预选 {a}–{b}', { a: clock(view.start || 0), b: clock(view.end != null ? view.end : 15) })));
  const hint = el('p', 'err');
  hint.id = 'trimHint';
  card.appendChild(hint);
  body.appendChild(card);
  const label = view.gif ? (view.confirm || '剪切并转 GIF') : '剪切并导出';
  const go = () => {
    const s = Number(start.input.value) || 0;
    const e = Number(end.input.value);
    // 提示会让面板变高：改完文字马上报高度，窗口跟着长，底部按钮不被挡、不出滚动条。
    if (view.gif && e - s > 15.001) { setHint(hint, tr('GIF 最长 15 秒，先剪一段')); return; }
    setHint(hint, '');
    if (view.gif) send('filetools:run', { action: 'video.gif', options: { start: s, end: e } });
    else send('filetools:run', { action: 'video.trim', options: { start: s, end: e } });
  };
  footButtons(label, go);
}

// 渲染后再改面板里的文字（提示、错误）都走这里，改完重新报高度。
function setHint(node, text) {
  if (!node || node.textContent === text) return;
  node.textContent = text;
  reportSize();
}

function numField(name, value) {
  const wrap = el('label');
  wrap.appendChild(document.createTextNode(tr(name)));
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.step = '0.1'; input.value = String(value);
  wrap.appendChild(input);
  return { wrap, input };
}

function renderResize() {
  const body = $('body');
  const card = el('div', 'card');
  const ow = view.width || 0;
  const oh = view.height || 0;
  card.appendChild(el('p', 'note', ow ? (ow + ' × ' + oh) : ''));
  const fields = el('div', 'fields');
  const w = numField('宽度', Math.min(view.customWidth || ow || 1, ow || 1));
  const h = numField('高度', oh || 1);
  if (ow) w.input.max = String(ow);
  fields.appendChild(w.wrap); fields.appendChild(h.wrap);
  card.appendChild(fields);
  const lock = el('label', 'lock');
  const box = document.createElement('input');
  box.type = 'checkbox'; box.checked = view.lock !== false;
  lock.appendChild(box);
  lock.appendChild(document.createTextNode(tr('锁定比例')));
  card.appendChild(lock);
  const hint = el('p', 'note', ow ? tr('原图宽 {n}，不会放大', { n: ow }) : tr('不知道原图宽度，不放大'));
  card.appendChild(hint);
  const applyH = () => {
    if (!box.checked || !ow || !oh) return;
    const width = Math.min(ow, Math.max(1, Number(w.input.value) || 1));
    w.input.value = String(width);
    h.input.value = String(Math.max(1, Math.round(width * oh / ow)));
  };
  w.input.addEventListener('input', applyH);
  body.appendChild(card);
  footButtons('改尺寸', () => {
    const width = Math.min(ow || Number(w.input.value), Math.max(1, Number(w.input.value) || 1));
    send('filetools:run', { action: 'image.resize', options: { mode: 'width', value: width } });
  });
}

function footButtons(label, on) {
  const foot = $('foot');
  foot.appendChild(el('div', 'status', view.disk ? tr(view.disk) : ''));
  const btns = el('div', 'btns');
  btns.style.marginLeft = 'auto';
  btns.style.display = 'flex';
  btns.style.gap = '8px';
  btns.appendChild(button('取消', 'ghost', () => send('filetools:close-panel')));
  btns.appendChild(button(label, 'primary', on, view.blocked));
  foot.appendChild(btns);
}

function levelRow(disabled) {
  const levels = el('div', 'levels');
  const cur = view.level || 'medium';
  [['high', '高#q'], ['medium', '中#q'], ['small', '小#q']].forEach(([id, label]) => {
    const b = button(label, 'seg' + (id === cur ? ' on' : ''), () => {
      if (disabled) return;
      view.level = id;
      renderPanel(view);
    }, disabled);
    levels.appendChild(b);
  });
  return levels;
}
function previewCard() {
  const card = el('div', 'card');
  const split = el('div', 'split');
  split.appendChild(el('span', 'tag l', tr(isVideoCompress(view) ? '原片' : '原图')));
  split.appendChild(el('span', 'tag r', tr('压缩后')));
  if (isVideoCompress(view)) {
    if (view.poster) {
      const img = document.createElement('img');
      img.className = 'poster';
      img.alt = '';
      img.addEventListener('load', reportSize);
      img.src = view.poster;
      split.appendChild(img);
    } else {
      split.appendChild(el('span', 'poster-wait', tr('预览生成中')));
    }
  }
  card.appendChild(split);
  if (isVideoCompress(view)) card.appendChild(levelRow(view.phase === 'running'));
  appendEstimate(card, view);
  card.appendChild(fileLine());
  return card;
}
function renderRunning() {
  const body = $('body');
  if (isVideoCompress(view) || isImageCompress(view)) body.appendChild(previewCard());
  else body.appendChild(fileLine());
  const foot = $('foot');
  if (view.indeterminate) {
    foot.appendChild(el('div', 'status', tr('处理中…')));
    const track = el('div', 'track ind');
    track.appendChild(el('div', 'bar'));
    foot.appendChild(track);
  } else {
    const pct = view.ratio == null ? '' : Math.round(view.ratio * 100) + '%';
    foot.appendChild(el('div', 'status', tr('正在处理…')));
    const track = el('div', 'track');
    const bar = el('div', 'bar');
    bar.style.width = ((view.ratio || 0) * 100) + '%';
    track.appendChild(bar);
    foot.appendChild(track);
    foot.appendChild(el('div', 'pct', pct));
  }
  foot.appendChild(button('取消', 'ghost', () => send('filetools:cancel')));
}

function renderQueued() {
  const body = $('body');
  const row = el('div', 'row');
  row.appendChild(el('i', 'dot'));
  row.appendChild(el('div', 'status', tr('录屏结束后开始')));
  body.appendChild(row);
  body.appendChild(el('p', 'note', tr('录屏优先。可以取消，或按 Esc 移出队列。')));
  body.appendChild(fileLine());
  const foot = $('foot');
  const track = el('div', 'track dashed');
  foot.appendChild(track);
  foot.appendChild(button('等待中', 'ghost', () => {}, true));
  foot.appendChild(button('取消', 'ghost', () => send('filetools:cancel')));
}

function frogBox(mood) {
  const n = el('div', 'mascot');
  if (typeof Frog !== 'undefined' && Frog.mount) Frog.mount(n, mood, 72);
  return n;
}
function renderDone() {
  const body = $('body');
  const box = el('div', 'done');
  box.appendChild(frogBox('happy'));
  box.appendChild(el('h2', '', tr('完成')));
  box.appendChild(el('p', '', view.fileName || ''));
  if (view.measured && view.bytes != null && Number.isFinite(Number(view.bytes))) box.appendChild(el('p', '', bytes(view.bytes)));
  body.appendChild(box);
  const foot = $('foot');
  foot.appendChild(button(view.revealLabel || '在 Finder 中显示', 'primary', () => send('filetools:reveal', { file: view.file })));
}

function renderError() {
  const box = el('div', 'done');
  box.appendChild(frogBox('x'));
  box.appendChild(el('p', 'err', tr(view.message || '没有完成')));
  $('body').appendChild(box);
  $('foot').appendChild(button('关闭#ft', 'ghost', () => send('filetools:close-panel')));
}

$('close').addEventListener('click', () => send('filetools:close-panel'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  // 完成 / 出错时 Esc 就是关闭；排队或进行中 Esc 是取消任务。
  if (view && (view.phase === 'done' || view.phase === 'error')) send('filetools:close-panel');
  else send('filetools:cancel');
});
window.renderPanel = renderPanel;
if (window.api && api.on) api.on('filetools:panel', renderPanel);
