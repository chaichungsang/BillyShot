'use strict';
const q = new URLSearchParams(location.search);
const full = q.get('full') === '1';
let n = parseInt(q.get('countdown') || '0', 10);
if (full) document.body.classList.add('full');
const count = document.getElementById('count');
const tickOn = q.get('tick') === '1';
const vol = Math.max(0, Math.min(1, parseFloat(q.get('vol') || '0.7')));
const tickAudio = tickOn ? new Audio('../../assets/sounds/tick.wav') : null;
function tick() { if (!tickAudio) return; try { tickAudio.volume = vol; tickAudio.currentTime = 0; tickAudio.play().catch(() => {}); } catch {} }
let ready = false, counted = false;
window.api.on('frame:recording', () => { document.body.classList.remove('counting'); document.body.classList.add('rec'); });
function done() { counted = true; document.body.classList.remove('counting'); setTimeout(() => window.api.send('frame:countdown-done'), 60); }
function run() {
  if (n <= 0) { done(); return; }
  document.body.classList.add('counting');
  count.textContent = n; tick();
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); done(); } else { count.textContent = n; tick(); }
  }, 1000);
}
run();
