# 呱咔 · Hopsnap

免费的跨平台（Windows / macOS）截图 + 录屏 + 贴图工具，基于 Electron。2.0 起由 BillyShot 改名为呱咔 / Hopsnap，吉祥物是一只小青蛙。

这个项目是开源的（MIT）：https://github.com/chaichungsang/BillyShot

![呱咔的表情](assets/logos/frog/moods.png)

下载：[GitHub Releases](https://github.com/chaichungsang/BillyShot/releases) · 介绍页：`docs/index.html`（GitHub Pages，Settings → Pages → Deploy from branch → `/docs`）· 使用说明：`使用说明.txt` / `User Guide (English).txt` · 更新记录：`CHANGELOG.md`

## 代码地图

- `src/main.js` 主进程：托盘、快捷键、截图覆盖层、贴图、录屏调度、macOS 权限助手、检查更新；首次以 2.0 启动时把 `BillyShot` 的设置和截图历史搬到新目录
- `src/capture.js` 原生截屏（node-screenshots）+ 窗口识别
- `src/hotkeys.js` 键盘（globalShortcut）+ 鼠标（uiohook-napi）快捷键
- `src/update.js` 问 GitHub Releases 最新版本（仓库地址来自 `package.json` 的 `repository`）
- `src/renderer/overlay.*` 微信式截图编辑器（始终深色，强调色青蛙绿）
- `src/renderer/recorder.js` 录屏：MediaStreamTrackProcessor 裁剪 → MediaRecorder(H.264 MP4) / gifenc(GIF)
- `src/renderer/perm.*` macOS 权限助手窗口
- `src/renderer/frog.js` 吉祥物：纯 SVG 的小青蛙，8 种表情（`Frog.svg(mood)`）；`docs/frog.js` 是给介绍页用的副本
- `src/renderer/settings.css` 唯一的一套配色（奶油白 + 青蛙绿，深浅色跟随系统）；主进程 `THEME_BG` 要和这里的 `--bg` 一致
- `src/i18n.js` 中英文词典；源码里统一写 `Hopsnap`，中文界面自动显示「呱咔」（`.brand-en` 的地方保留英文）
- `scripts/make_frog_assets.js` 用 Electron 离屏渲染生成全部图标（`npm run assets`）
- `scripts/sign-mac.js` Mac 签名 + 压缩（ad-hoc / 自签名证书 / Developer ID，见 `docs/mac-signing.md`）
- `scripts/dist-win.js` Windows 安装包（Apple Silicon 上自动改用 Homebrew 的 makensis）
- `.github/workflows/release.yml` 打 `v*` tag 自动出 mac + win 包并发 Release

## 设计规则

平涂、不用渐变、不用彩色辉光；边界靠 1px 细线；圆角大、按钮是胶囊；一个强调色。吉祥物只出现在品牌层（图标、开始页、关于）和反馈层（空状态、倒计时、权限助手），不出现在截图层和录制条里。

## 开发与打包

```bash
npm install
npm start                      # 开发运行（HOPSNAP_TEST=1 开启测试钩子）
npm run assets                 # 重新生成图标
HOPSNAP_ADHOC=1 npm run dist:mac    # Mac（自己试用；正式发布见 docs/mac-signing.md）
npm run dist:win               # Windows 安装包 + 免安装 zip + 卸载工具
```

发布：改 `package.json` 版本和 `CHANGELOG.md` → `git tag v2.0.0 && git push --tags` → Actions 出包并建 Release。

`test/` 是 Linux（Xvfb）上的端到端回归脚本，`test/macperm_1_3_5.js` 可直接 `node` 运行。
