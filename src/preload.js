// 通用预加载：只暴露受控的 IPC 通道
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const PREFIXES = ['overlay:', 'settings:', 'hotkeys:', 'history:', 'dialog:', 'shell:', 'app:', 'rec:', 'recbar:', 'pin:', 'frame:', 'present:', 'cam:', 'filetools:', 'notch:'];
const ok = (ch) => typeof ch === 'string' && PREFIXES.some((p) => ch.startsWith(p));

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  // 界面语言（zh / en），窗口加载时向主进程取一次；切换语言时主进程会重新加载窗口
  lang: (() => { try { return ipcRenderer.sendSync('app:lang') || 'zh'; } catch { return 'zh'; } })(),
  invoke: (ch, ...args) => (ok(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('blocked channel'))),
  send: (ch, ...args) => { if (ok(ch)) ipcRenderer.send(ch, ...args); },
  on: (ch, cb) => {
    if (!ok(ch)) return () => {};
    const fn = (_e, ...args) => cb(...args);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  // Electron 32 起 File.path 没了。拖进来的文件用这个拿本地路径。
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
