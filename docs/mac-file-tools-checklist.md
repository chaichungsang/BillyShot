# Mac 上核对文件工具

这一版在 Linux 上跑过单元测试，包括通过 JobRunner 的四条视频路径和一次真正的 ffmpeg 取消。下面这些要在 Billy 的 Mac 上实际点一次。

Billy 要做的是实测，不是编译。不要在 `~/Projects/BillyShot` 里编任何东西。

还缺两份只能在 Mac 上产生的二进制。没有它们，对应的功能在 Mac 上还不能测。产生它们的命令在文末，目录是 `/tmp/billyshot-ffmpeg-mac` 和 `/tmp/billyshot-shift-drag`。需要的话我可以等你点头再跑。仓库里已经有 Windows x64 的 LGPL ffmpeg（`vendor/ffmpeg/win32-x64`，带 `h264_mf`）。

打包和签名（二进制齐了之后）：

1. Mac ffmpeg 放进 `vendor/ffmpeg/darwin-arm64` 和 `vendor/ffmpeg/darwin-x64`。每个架构的安装包只带自己那一份。
2. `native/mac/ShiftDrag` 是 Shift 拖的默认程序。`scripts/build-mac-helper.sh` 在 Mac 上编它。应用不再用 osascript / JXA 当默认路径。托盘拖放和快捷键是退路。
3. 用现有的 `scripts/sign-mac.js` 签整个 `.app`（证书还是 `BILLYSHOT_SIGN_DIR` 里的那对）。不要改签名脚本，也不要给新二进制单独做 ad-hoc 签名。脚本会扫包里每一个 Mach-O，包括 `ShiftDrag` 和 ffmpeg 旁边的 dylib。有漏签的会失败。

待 Billy Mac 实测：

- 辅助功能：文件工具的 Shift 拖不申请辅助功能，也不申请输入监控。鼠标快捷键、点击波纹仍走原来的辅助功能。若系统以后要求权限，策略模块里还有「暂不」：拒绝后 `shiftDragDeclined`，不再问；设置里重新打开「Shift 拖弹出动作弧」可以再启用。v1 不弹 07 那页。
- Shift 拖：按住 Shift 拖文件，移动超过 8pt 后出现动作弧。Shift 取自拖动事件的 modifierFlags，不读键盘。剪贴板只看类型，不读路径。松手后的路径用 `webUtils.getPathForFile`。中途松开 Shift，弧淡出。松手会收到 `up`。y 轴按主屏幕 `NSScreen.screens[0]` 翻转，不按最高的那块屏幕。
- 同一次拖动能不能直接落在键上：托盘 `drag-enter` 停 250ms 后会弹出接住拖放的透明窗。若这次拖放还拿不到类型，就退回「先松开，再点键」。请在真机上确认哪一种发生。
- 菜单栏拖放：把图片或录屏拖到菜单栏图标上，确认弧朝下，键没有被屏幕切掉。改尺寸的列在「改尺寸」标签基线下面 10px，水平对准键的中心。
- 快捷键小窗：默认 ⌃⌥F，设置里能改。底部「拖不到菜单栏图标时用快捷键」是 `#8A847A`、12px，后面跟着键帽 `⌃⌥F`。
- 快捷键注册失败：`globalShortcut.register` 返回 false 或抛错时，弹一次通知，指向 设置 → 快捷键。同一组键下次启动不再弹。换成新的失败组合会再弹一次。
- Apple Silicon 和 Intel 各走一遍转 MP4、压缩视频、剪头尾、转 GIF：输出先写到 `最终名.part`，ffmpeg 显式带 `-f mp4` 或 `-f gif`。Apple Silicon 应走 VideoToolbox 的 `-q:v`，Intel 走 `-b:v`，两边都有 `-allow_sw 1`。没有硬件编码器时退到 mpeg4，不能出现 libx264。
- 取消正在跑的视频：ffmpeg 进程树要消失，`.part` 要删掉。
- 刘海屏和非刘海屏各拖一次，弧要留在工作区内。
- 录屏进行中做转换：任务显示「录屏结束后开始」，没有「立即开始」。Esc 把它移出队列。录屏结束后按顺序一个个跑。
- HEIC：Mac 应能经 sips 转出。不要装 libheif。
- 完成通知：系统通知能点开文件；通知被关掉时，预览面板给出完成状态（金色圆盘上的描边勾、文件名、只有实测到才写出大小）和「在 Finder 中显示」。托盘图标闪一次金色。
- 设置 → 关于 里能看到 LGPL ffmpeg 和 sharp / libvips（LGPL-3.0-or-later）的说明。
- 合成 PDF：没有透明通道的图嵌成 JPEG。加了密码的 PDF 要出现「这个 PDF 加了密码，打不开」，原文件不动。

Windows（待 Billy Windows 实测）：

- 默认快捷键是 **Ctrl+Shift+Alt+F**。不是 Ctrl+Shift+F（那是编辑器常用的），也不是 Ctrl+Alt+F（Ctrl+Alt 在欧洲键盘上是 AltGr）。设置里可以改。小窗上的键帽显示这组键。
- 视频用仓库里的 `vendor/ffmpeg/win32-x64/ffmpeg.exe`（LGPL，`h264_mf`）。不用再编。
- 取消时用 `taskkill /T /F` 杀掉 ffmpeg 进程树，不等待一个已经来不及的 400ms 定时器。
- 入口只有快捷键小窗（系统标题栏，一排键，不画弧）和托盘「文件 ▸ 文件工具…」。没有「发送到」。发送到留到 v1.1。
- 没有 HEIF 图像扩展时，HEIC 要出现明确的错误，原文件不动。
- sharp 用官方预编译的 `@img/sharp-win32-x64`（`npmRebuild: false`），不要用在 Linux 上重编的那份。

## 只能在 Mac 上产生的二进制

不要在 `~/Projects/BillyShot` 里执行。

ffmpeg（VideoToolbox，无 x264，无 GPL，无 nonfree）：

```sh
mkdir -p /tmp/billyshot-ffmpeg-mac
# 仓库可以是 /tmp/billyshot-src，不要用 ~/Projects/BillyShot
bash /tmp/billyshot-src/scripts/build-ffmpeg-mac.sh arm64 /tmp/billyshot-ffmpeg-mac
bash /tmp/billyshot-src/scripts/build-ffmpeg-mac.sh x86_64 /tmp/billyshot-ffmpeg-mac
# 核对
/tmp/billyshot-ffmpeg-mac/darwin-arm64/ffmpeg -buildconf
/tmp/billyshot-ffmpeg-mac/darwin-arm64/ffmpeg -encoders
```

源码是 ffmpeg 7.1.1，tag `n7.1.1`，提交 `db69d06eeeab4f46da15030a80d539efb4503ca8`。编完把 `darwin-arm64` 和 `darwin-x64` 拷进 `vendor/ffmpeg/`。每个 Mac 安装包只带自己的架构。

Shift 拖 helper：

```sh
mkdir -p /tmp/billyshot-shift-drag
swiftc -O -framework Cocoa -o /tmp/billyshot-shift-drag/ShiftDrag /tmp/billyshot-src/native/mac/ShiftDrag.swift
cp /tmp/billyshot-shift-drag/ShiftDrag /tmp/billyshot-src/native/mac/ShiftDrag
```

打进 `.app` 之后由 `scripts/sign-mac.js` 和其他 Mach-O 一起签名。

GitHub Actions 工作流 `.github/workflows/ffmpeg-lgpl.yml` 可以在 macos-14 和 windows 上编同样的东西，并上传 artifact。它不会自动提交回仓库。
