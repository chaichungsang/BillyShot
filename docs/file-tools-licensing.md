# 文件工具用到的 LGPL ffmpeg

BillyShot 的视频动作（转 MP4、压缩视频、剪头尾、转 GIF）只调用仓库里的 ffmpeg，不调用 PATH 上的系统 ffmpeg（系统包经常是带 libx264 的 GPL 构建）。

- 许可：GNU LGPL 2.1 或更高。文本在 `vendor/ffmpeg/COPYING.LGPLv2.1`。
- 链接：共享库（`.dylib` / `.dll` / `.so`），rpath 用 `$ORIGIN`，运行时从 ffmpeg 自己旁边找库。这是动态链接，不是把 ffmpeg 静态打进 BillyShot。
- 构建：`--disable-gpl --disable-nonfree --disable-everything`，再只打开文件工具要用的解复用、解码、编码和滤镜。没有 libx264、libx265、libxvid，也没有 nonfree 编码器。
- H.264：Mac 用 `h264_videotoolbox`（Apple Silicon 用 `-q:v`，Intel 用 `-b:v`，都带 `-allow_sw 1`）。Windows 用 `h264_mf`（CBR）。两边都没有硬件编码器时，退到 LGPL 自带的 `mpeg4`。应用拒绝 `libx264` / `libx265` / `libxvid`。
- Linux 上这份用于测试的成品是 ffmpeg 7.1.1，编码器只有 mpeg4、gif、aac、mjpeg。配方在 `scripts/build-ffmpeg-lgpl.sh`。Mac / Windows 的二进制要在对应系统上编，编完放进 `vendor/ffmpeg/darwin-*` 和 `vendor/ffmpeg/win32-x64`。
- 图片走 sharp（libvips），不走 ffmpeg。HEIC 不走 libheif：Mac 用 `sips`，Windows 试 WIC（`native/win/heic.ps1`），没有扩展就给出明确的错误，不静默失败。
- PDF 走 pdf-lib（MIT）。

替换或升级 ffmpeg 时，用 `ffmpeg -version` 确认配置行里有 `--disable-gpl`，并用 `ffmpeg -encoders` 确认没有 `libx264`。
