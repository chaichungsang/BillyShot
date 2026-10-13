# BillyShot

免费的跨平台（Windows / macOS）截图 + 录屏 + 贴图工具，基于 Electron。

- `src/main.js` 主进程：托盘、快捷键、截图覆盖层、贴图、录屏调度
- `src/capture.js` 原生截屏（node-screenshots）+ 窗口识别
- `src/hotkeys.js` 键盘（globalShortcut）+ 鼠标（uiohook-napi）快捷键
- `src/renderer/overlay.*` 微信式截图编辑器
- `src/renderer/recorder.js` 录屏：MediaStreamTrackProcessor 裁剪 → MediaRecorder(H.264 MP4) / gifenc(GIF)
- `scripts/make_icon.py` 玻璃图标渲染（折射 + 色散 + 菲涅尔）
- `scripts/make_logo_assets.py` 生成两套应用图标（`assets/logos/portrait` 头像版 = 打包默认，`assets/logos/purple` 紫色玻璃版），设置 → 常规 可切换
- `src/renderer/themes.css` 主题配色（9 套，`<html data-theme>`），主进程 `THEME_BG` 要和里面的 `--bg` 一致；`theme-boot.js` 首屏套主题；`overlay.css` 末尾是截图工具栏的强调色

```bash
npm install
npm start            # 开发运行
npm run dist:win     # Windows 安装包 + 免安装 zip
npm run dist:mac     # macOS（在 Linux 上打包需另行 ad-hoc 签名，见 scripts）
```
