// 用 Electron 把动作弧、预览面板、快捷键小窗画出来，存到 /opt/cursor/artifacts。
// 跑法：BILLYSHOT_SHOT=1 ./node_modules/.bin/electron .
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { ringModel } = require('../src/filetools/plan');
const { placeArc } = require('../src/filetools/arc-layout');

const outDir = process.env.BILLYSHOT_SHOT_DIR || '/opt/cursor/artifacts';

function layout(count, cursor, area) {
  const placement = placeArc({ cursor, workArea: area, count, anchor: 'tray' });
  return placement;
}

function arcMessage(which) {
  const area = { x: 0, y: 0, width: 880, height: 560 };
  if (which === 'image') {
    const model = ringModel({ files: ['示例.png'], width: 1600 });
    const placement = layout(3, { x: 440, y: 78 }, area);
    return {
      files: ['示例.png'], model, hubx: placement.hub.x, huby: placement.hub.y,
      angles: placement.angles, radius: placement.radius,
      badge: 'PNG', sub: '宽 1600', forceExtra: true, hoverKey: 2, tipId: 'w1920',
    };
  }
  const model = ringModel({ files: ['示例-录屏.mov'], duration: 120 });
  const placement = layout(4, { x: 440, y: 78 }, area);
  return {
    files: ['示例-录屏.mov'], model, hubx: placement.hub.x, huby: placement.hub.y,
    angles: placement.angles, radius: placement.radius,
    badge: 'MOV', sub: '2:00', forceExtra: true, hoverKey: 3,
  };
}

async function shoot(win, name) {
  const image = await win.capturePage();
  const file = path.join(outDir, name);
  fs.writeFileSync(file, image.toPNG());
  console.log('SHOT', file, image.getSize());
}

function open(html, bounds) {
  const win = new BrowserWindow({
    ...bounds, show: false, frame: false, transparent: false, backgroundColor: '#100f0e',
    webPreferences: { spellcheck: false, offscreen: false },
  });
  win.setMenu(null);
  return new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve(win));
    win.loadFile(html);
  });
}

app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const root = path.join(__dirname, '..', 'src', 'renderer');
  const arc = await open(path.join(root, 'arc.html'), { width: 880, height: 560, x: 40, y: 40 });
  await arc.webContents.executeJavaScript('document.body.classList.add("shot")');
  arc.show();
  await new Promise((r) => setTimeout(r, 80));
  await arc.webContents.executeJavaScript('renderArc(' + JSON.stringify(arcMessage('image')) + ')');
  await new Promise((r) => setTimeout(r, 250));
  console.log('TEXT', await arc.webContents.executeJavaScript('document.body.innerText'));
  await shoot(arc, 'ring-image.png');

  await arc.webContents.executeJavaScript('renderArc(' + JSON.stringify(arcMessage('video')) + ')');
  await new Promise((r) => setTimeout(r, 200));
  console.log('TEXT2', await arc.webContents.executeJavaScript('document.body.innerText'));
  await shoot(arc, 'ring-recording.png');
  arc.destroy();

  const panel = await open(path.join(root, 'filepanel.html'), { width: 500, height: 640, x: 40, y: 40 });
  await panel.webContents.executeJavaScript('document.body.classList.add("shot")');
  panel.show();
  async function showPanel(view, name) {
    await panel.webContents.executeJavaScript('renderPanel(' + JSON.stringify(view) + ')');
    await new Promise((r) => setTimeout(r, 80));
    const h = await panel.webContents.executeJavaScript('document.getElementById("panel").offsetHeight');
    panel.setContentSize(500, Math.max(120, h));
    await new Promise((r) => setTimeout(r, 80));
    await shoot(panel, name);
  }
  await showPanel({
    phase: 'running', action: 'video.compress', kind: 'compress-video',
    names: ['示例-录屏.mov'], level: 'medium', ratio: 0.62, indeterminate: false, estimateBytes: 2516582,
  }, 'preview-progress.png');
  await showPanel({
    phase: 'queued', action: 'video.compress', kind: 'compress-video', names: ['示例-录屏.mov'],
  }, 'preview-queued.png');
  await showPanel({
    phase: 'running', action: 'video.compress', kind: 'compress-video', indeterminate: true,
    names: ['示例-录屏.mov'], level: 'medium',
  }, 'preview-indeterminate.png');
  await showPanel({
    phase: 'done', action: 'image.compress', fileName: '示例-截图-compressed.png',
    bytes: 734003, measured: true, revealLabel: '在 Finder 中显示',
  }, 'done-state.png');
  panel.destroy();

  const tools = await open(path.join(root, 'filetools.html'), { width: 400, height: 360, x: 40, y: 40 });
  const model = ringModel({ files: ['示例-录屏.mov'], duration: 8 });
  await tools.webContents.executeJavaScript('document.body.classList.add("shot","mac")');
  tools.show();
  await tools.webContents.executeJavaScript('renderWindow(' + JSON.stringify({
    shot: 'mac', platform: 'darwin', files: ['示例-录屏.mov'], names: ['示例-录屏.mov'], model,
    recent: [{ name: '示例-截图-compressed.png', file: '/tmp/a.png', bytes: 1000, reveal: '在 Finder 中显示' }],
  }) + ')');
  tools.show();
  await new Promise((r) => setTimeout(r, 150));
  await shoot(tools, 'hotkey-window.png');
  tools.destroy();
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
