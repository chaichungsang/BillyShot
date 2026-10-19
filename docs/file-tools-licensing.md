# 文件工具用到的许可

BillyShot 本体是 MIT。文件工具额外带了两份 LGPL 库，都是动态链接，没有静态打进主程序。

## ffmpeg

视频动作（转 MP4、压缩视频、剪头尾、转 GIF）只调用仓库里的 ffmpeg，不调用 PATH 上的系统 ffmpeg（系统包经常是带 libx264 的 GPL 构建）。

- 许可：GNU LGPL 2.1 或更高。文本在 `vendor/ffmpeg/COPYING.LGPLv2.1`。
- 链接：共享库（`.dylib` / `.dll` / `.so`），运行时从 ffmpeg 自己旁边找库。这是动态链接。
- 构建：`--disable-gpl --disable-nonfree --disable-everything`，再只打开文件工具要用的解复用、解码、编码和滤镜。没有 `--enable-libx264`、libx265、libxvid，也没有 nonfree 编码器。
- 源码：ffmpeg 7.1.1，tag `n7.1.1`，提交 `db69d06eeeab4f46da15030a80d539efb4503ca8`。
- H.264：Mac 用 `h264_videotoolbox`（Apple Silicon 用 `-q:v`，Intel 用 `-b:v`，都带 `-allow_sw 1`）。Windows 用 `h264_mf`（CBR）。两边都没有硬件编码器时，退到 LGPL 自带的 `mpeg4`。应用拒绝 `libx264` / `libx265` / `libxvid`。
- Linux 成品在 `vendor/ffmpeg/linux-x64`，配方在 `scripts/build-ffmpeg-lgpl.sh`。
- Windows x64 成品在 `vendor/ffmpeg/win32-x64`（mingw-w64 交叉编译，带 `h264_mf`）。标志和校验记录在 `vendor/ffmpeg/win32-x64/BUILD.txt`，脚本是 `scripts/build-ffmpeg-mingw.sh`。
- Mac 成品在 `vendor/ffmpeg/darwin-arm64` 和 `vendor/ffmpeg/darwin-x64`（`h264_videotoolbox`，无 GPL，无 libx264）。它们由 GitHub 的 macos-14 跑 `scripts/build-ffmpeg-mac.sh` 编出来，记录在各自的 `BUILD.txt`。还没签名。`scripts/sign-mac.js` 会在打 `.app` 时和其他 Mach-O 一起签。每个架构的安装包只带自己的 ffmpeg。

替换或升级 ffmpeg 时，用 `ffmpeg -buildconf` 确认有 `--disable-gpl`，并用 `ffmpeg -encoders` 确认有 `h264_videotoolbox` 或 `h264_mf`，且没有 `libx264`。

## sharp / libvips

图片动作走 sharp，不走 ffmpeg。

- `sharp` 自己是 Apache-2.0。
- 它动态链接的 libvips（`@img/sharp-libvips-*`）是 **LGPL-3.0-or-later**。
- `package.json` 里 `npmRebuild` 是 `false`。打包不会在打包机上重编 sharp，用的是 npm 上的官方预编译包。`scripts/fetch-natives.js` 会把 Windows x64、Mac x64、Mac arm64 的预编译包装进 `node_modules`。
- HEIC 不走 libheif：Mac 用 `sips`，Windows 试 WIC（`native/win/heic.ps1`），没有扩展就给出明确的错误，不静默失败。

## PDF

PDF 走 pdf-lib（MIT）。

## 应用里的说明

设置 → 关于 里有一段许可说明：视频用 LGPL ffmpeg（动态链接），图片用 sharp / libvips（LGPL-3.0-or-later）。
