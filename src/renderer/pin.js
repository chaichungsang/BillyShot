'use strict';

const img = document.getElementById('img');
const scale = document.getElementById('scale');
api.on('pin:image', (url) => { img.src = url; });
let drag = null;
window.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.screenX, y: e.screenY }; });
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
  if (dx || dy) { api.send('pin:move', dx, dy); drag = { x: e.screenX, y: e.screenY }; }
});
window.addEventListener('mouseup', () => { drag = null; });
window.addEventListener('dblclick', () => api.send('pin:close'));
window.addEventListener('contextmenu', (e) => { e.preventDefault(); api.send('pin:menu'); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.send('pin:close');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') api.send('pin:close');
});
let t;
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  api.send('pin:zoom', e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
}, { passive: false });
api.on('pin:scale', (pct) => {
  scale.textContent = pct + '%'; scale.style.display = 'block';
  clearTimeout(t); t = setTimeout(() => (scale.style.display = 'none'), 900);
});
