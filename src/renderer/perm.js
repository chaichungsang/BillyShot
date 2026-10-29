// 权限助手（macOS）：一步一步带用户打开「屏幕录制」（必需）和「辅助功能」（可选），每秒看一次状态，开了就自动往下走
const $ = (s) => document.querySelector(s);
const act = (name) => api.invoke('app:action', name);
const frogEl = $('#frog');
let mood = '', blinkTimer = null, hotkey = '';

function setMood(m) {
  if (m === mood) return;
  mood = m; Frog.mount(frogEl, m, 96);
  clearInterval(blinkTimer); blinkTimer = null;
  if (m === 'idle') blinkTimer = setInterval(() => { if (mood !== 'idle') return; Frog.mount(frogEl, 'blink', 96); setTimeout(() => { if (mood === 'idle') Frog.mount(frogEl, 'idle', 96); }, 140); }, 3200);
}
function prettyKey(v) { return v ? v.replace('Control', '⌃').replace('Command', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, ' ') : ''; }

async function refresh() {
  let st = null; try { st = await act('macPermState'); } catch {}
  if (!st || !st.mac) return;
  const screenOk = st.screen === 'granted';
  const mode = !screenOk ? 'off' : st.needRelaunch ? 'relaunch' : 'ok';
  document.body.dataset.mode = mode;
  $('#stepScreen').dataset.state = mode;
  $('#stScreen').textContent = screenOk ? tx('已允许') : tx('未允许');

  const axOk = st.accessibility === 'granted';
  $('#stepAx').dataset.state = axOk ? 'ok' : st.axNeeded ? 'need' : 'opt';
  $('#stAx').textContent = axOk ? tx('已允许') : tx('未允许');
  $('#axTag').textContent = st.axNeeded && !axOk ? tx('建议打开') : tx('可选');
  $('#axTag').classList.toggle('need', st.axNeeded && !axOk);

  if (mode === 'off') { $('#title').textContent = tx('Hopsnap 需要看到屏幕才能截图'); $('#sub').textContent = tx('只需设置一次：在系统设置里打开开关，再重新打开 Hopsnap 就好。'); setMood('idle'); }
  else if (mode === 'relaunch') { $('#title').textContent = tx('开关打开了！'); $('#sub').textContent = tx('重新打开 Hopsnap 一次，系统才会把新权限交给它。'); setMood('happy'); }
  else {
    $('#title').textContent = tx('全部就绪！');
    $('#sub').innerHTML = '';
    const p = $('#sub'); p.append(tx('按下') + ' '); const k = document.createElement('span'); k.className = 'kbd'; k.textContent = hotkey || '⌃⌘A'; p.append(k); p.append(' ' + tx('试试截图'));
    setMood('happy');
  }
  fit();
}
// 让窗口高度贴合当前步骤的内容
function fit() {
  const h = document.querySelector('header').offsetHeight + $('#content').offsetHeight + 16 + document.querySelector('footer').offsetHeight;
  api.send('perm:height', h);
}
$('details.more').addEventListener('toggle', () => setTimeout(fit, 0));

$('#openScreen').addEventListener('click', () => act('macScreenPerm'));
$('#openAx').addEventListener('click', () => act('macAccessPerm'));
$('#already').addEventListener('click', () => act('macRelaunch'));
$('#relaunch').addEventListener('click', () => act('macRelaunch'));
$('#repair').addEventListener('click', async () => {
  $('#note').textContent = '…';
  let r = null; try { r = await act('macPermRepairQuiet'); } catch {}
  $('#note').textContent = r && r.ok ? tx('已清除旧记录，请在系统设置里重新打开开关') : tx('没能自动清除旧的授权记录');
});
$('#diag').addEventListener('click', async () => {
  try { await act('macDiag'); $('#note').textContent = tx('诊断信息已复制，可以直接粘贴发给我们'); } catch { $('#note').textContent = tx('复制失败'); }
});
$('#later').addEventListener('click', () => act('macPermLater'));
$('#closeBtn').addEventListener('click', () => window.close());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

// 系统设置的列表里永远显示英文名 Hopsnap（包名），中文界面也照写，用户才找得到
$('#capFind').textContent = tx('在列表里找到 {app}，把开关打开', { app: 'Hopsnap' });
$('#capPlus').textContent = tx('找不到 {app}？点列表下方的「+」，从「应用程序」里选它。', { app: 'Hopsnap' });

(async () => {
  try { const r = await api.invoke('settings:get'); const h = r && r.settings && r.settings.hotkeys && r.settings.hotkeys.capture; hotkey = prettyKey(h && h.keyboard); } catch {}
  await refresh();
  setInterval(refresh, 1000);
})();
