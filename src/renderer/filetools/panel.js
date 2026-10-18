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
  view = Object.assign({}, view, next);
  $('title').textContent = tr(view.title || titleFor(view));
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
  if (v.kind === 'compress-image') return '压缩图片';
  if (v.kind === 'compress-video') return '压缩视频';
  if (v.kind === 'trim') return '剪头尾';
  if (v.kind === 'resize') return '改尺寸';
  if (v.phase === 'done') return '文件工具';
  return '文件工具';
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
  if (view.estimateBytes) est.textContent = tr('预计约 {size}', { size: bytes(view.estimateBytes) });
  card.appendChild(est);
  card.appendChild(fileLine());
  body.appendChild(card);
  const foot = $('foot');
  foot.appendChild(el('div', 'status', ''));
  const btns = el('div', 'btns');
  btns.style.marginLeft = 'auto';
  btns.style.display = 'flex';
  btns.style.gap = '8px';
  btns.appendChild(button('取消', '', () => send('filetools:close-panel')));
  btns.appendChild(button('压缩图片', 'gold', () => send('filetools:run', { action: 'image.compress', options: { quality: Number(range.value) || 72 } }), view.blocked));
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
    const b = button(label, id === cur ? 'on' : '', () => { view.level = id; renderPanel(view); });
    levels.appendChild(b);
  });
  card.appendChild(levels);
  const est = el('p', 'est');
  if (view.estimateBytes) est.textContent = tr('预计约 {size}', { size: bytes(view.estimateBytes) });
  card.appendChild(est);
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
    if (view.gif && e - s > 15.001) { hint.textContent = tr('GIF 最长 15 秒，先剪一段'); return; }
    if (view.gif) send('filetools:run', { action: 'video.gif', options: { start: s, end: e } });
    else send('filetools:run', { action: 'video.trim', options: { start: s, end: e } });
  };
  footButtons(label, go);
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
  btns.appendChild(button('取消', '', () => send('filetools:close-panel')));
  btns.appendChild(button(label, 'gold', on, view.blocked));
  foot.appendChild(btns);
}

function renderRunning() {
  const body = $('body');
  body.appendChild(fileLine());
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
  foot.appendChild(button('取消', '', () => send('filetools:cancel')));
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
  foot.appendChild(button('等待中', '', () => {}, true));
  foot.appendChild(button('取消', '', () => send('filetools:cancel')));
}

function renderDone() {
  const body = $('body');
  const box = el('div', 'done');
  box.appendChild(el('div', 'check', '✓'));
  box.appendChild(el('h2', '', tr('完成')));
  box.appendChild(el('p', '', view.fileName || ''));
  if (view.bytes != null && Number.isFinite(Number(view.bytes))) box.appendChild(el('p', '', bytes(view.bytes)));
  body.appendChild(box);
  const foot = $('foot');
  foot.appendChild(button(view.revealLabel || '在 Finder 中显示', 'gold', () => send('filetools:reveal', { file: view.file })));
}

function renderError() {
  $('body').appendChild(el('p', 'err', tr(view.message || '没有完成')));
  $('foot').appendChild(button('关闭#ft', '', () => send('filetools:close-panel')));
}

$('close').addEventListener('click', () => send('filetools:close-panel'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); send('filetools:cancel'); }
});
window.renderPanel = renderPanel;
if (window.api && api.on) api.on('filetools:panel', renderPanel);
