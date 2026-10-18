# Mac 上核对文件工具

这一版在 Linux 上跑过单元测试。下面这些要在 Billy 的 Mac 上实际点一次，标「待 Billy Mac 实测」。

打包和签名：

1. 在 Mac 上按 `scripts/build-ffmpeg-lgpl.sh` 编 LGPL ffmpeg，并加上 VideoToolbox 的 `h264_videotoolbox`。放进 `vendor/ffmpeg/darwin-arm64` 和 `vendor/ffmpeg/darwin-x64`。
2. `scripts/build-mac-helper.sh` 可以编可选的 `native/mac/ShiftDrag`。不编也行，应用用 `osascript` 跑 `native/mac/shift-drag.jxa.js`。
3. 用现有的 `scripts/sign-mac.js` 签整个 `.app`（证书还是 `BILLYSHOT_SIGN_DIR` 里的那对）。不要改签名脚本，也不要给新二进制单独做 ad-hoc 签名。脚本会扫包里每一个 Mach-O，有漏签的会失败。

待 Billy Mac 实测：

- 辅助功能：文件工具的 Shift 拖不申请辅助功能，也不申请输入监控。鼠标快捷键、点击波纹仍走原来的辅助功能。若系统以后要求权限，策略模块里还有「暂不」：拒绝后 `shiftDragDeclined`，不再问；设置里重新打开「Shift 拖弹出动作弧」可以再启用。v1 不弹 07 那页。
- Shift 拖：按住 Shift 拖文件，移动超过 8pt 后约 100ms 出现动作弧。Shift 取自拖动事件的 modifierFlags，不读键盘。剪贴板只看 changeCount 和 `public.file-url` / `NSFilenamesPboardType`，不读路径。松手后的路径用 `webUtils.getPathForFile`。中途松开 Shift，弧淡出。
- 同一次拖动能不能直接落在键上：托盘 `drag-enter` 停 250ms 后会弹出接住拖放的透明窗。若这次拖放还拿不到类型，就退回「先松开，再点键」。请在真机上确认哪一种发生。
- 菜单栏拖放：把图片或录屏拖到菜单栏图标上，确认弧朝下，键没有被屏幕切掉。
- 快捷键小窗：默认 ⌃⌥F，设置里能改。底部有「拖不到菜单栏图标时用快捷键」。
- Apple Silicon 和 Intel 各走一遍转 MP4：Apple Silicon 应走 VideoToolbox 的 `-q:v`，Intel 走 `-b:v`，两边都有 `-allow_sw 1`。没有硬件编码器时退到 mpeg4，不能出现 libx264。
- 刘海屏和非刘海屏各拖一次，弧要留在工作区内。
- 录屏进行中做转换：任务显示「录屏结束后开始」，没有「立即开始」。Esc 把它移出队列。录屏结束后按顺序一个个跑。
- HEIC：Mac 应能经 sips 转出。不要装 libheif。
- 完成通知：系统通知能点开文件；通知被关掉时，预览面板给出完成状态（金勾、文件名、只有实测到才写出大小）和「在 Finder 中显示」。托盘图标闪一次金色。

Windows（待 Billy Windows 实测）：

- 默认快捷键是 **Ctrl+Shift+F**，不是 Ctrl+Alt+F。Ctrl+Alt 在欧洲键盘上是 AltGr，会和打字冲突。设置里可以改成别的组合。
- 入口只有快捷键小窗（系统标题栏，一排键，不画弧）和托盘「文件 ▸ 文件工具…」。没有「发送到」。发送到留到 v1.1。
- 没有 HEIF 图像扩展时，HEIC 要出现明确的错误，原文件不动。
