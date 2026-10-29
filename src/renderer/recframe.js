'use strict';
const q = new URLSearchParams(location.search);
const full = q.get('full') === '1';
let n = parseInt(q.get('countdown') || '0', 10);
if (full) document.body.classList.add('full');
const num = document.getElementById('num');
const frog = document.getElementById('frog');
const tickOn = q.get('tick') === '1';
const vol = Math.max(0, Math.min(1, parseFloat(q.get('vol') || '0.7')));
const tickAudio = tickOn ? new Audio('../../assets/sounds/tick.wav') : null;
function tick() { if (!tickAudio) return; try { tickAudio.volume = vol; tickAudio.currentTime = 0; tickAudio.play().catch(() => {}); } catch {} }
let ready = false, counted = false;
window.api.on('frame:recording', () => { document.body.classList.remove('counting'); document.body.classList.add('rec'); });
function done() { counted = true; document.body.classList.remove('counting'); setTimeout(() => window.api.send('frame:countdown-done'), 60); }
// 倒计时的每一秒：鼓腮 → 眨眼 → 鼓腮，最后一秒张嘴笑
function face(k) { if (window.Frog) Frog.mount(frog, k, 168); }
function run() {
  if (n <= 0) { done(); return; }
  document.body.classList.add('counting');
  num.textContent = n; face('puff'); tick();
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); face('happy'); num.textContent = ''; setTimeout(done, 220); }
    else { num.textContent = n; face(n === 1 ? 'happy' : 'puff'); tick(); }
  }, 1000);
}
run();
