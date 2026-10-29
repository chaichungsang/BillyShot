#!/bin/sh
# 在 Linux 上交叉编译 Windows x64 的最小 LGPL ffmpeg，带 h264_mf。
# 只写到调用者给的目录（默认 /tmp/billyshot-ffmpeg-win）。不要在 ~/Projects/BillyShot 里编。
# 源码用 ffmpeg 7.1.1，和 vendor/ffmpeg/linux-x64 同一版。
set -eu
ROOT="${1:-/tmp/billyshot-ffmpeg-win}"
SRC="$ROOT/src"
PREFIX="$ROOT/prefix"
mkdir -p "$SRC" "$PREFIX"
if [ ! -d "$SRC/ffmpeg-7.1.1" ]; then
  curl -fsSL -o "$ROOT/ffmpeg-7.1.1.tar.xz" https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz
  tar -xJf "$ROOT/ffmpeg-7.1.1.tar.xz" -C "$SRC"
fi
cd "$SRC/ffmpeg-7.1.1"
# 记下源码提交，方便和成品对照。7.1.1 的发行包对应 n7.1.1。
./configure \
  --prefix="$PREFIX" \
  --enable-cross-compile --arch=x86_64 --target-os=mingw32 \
  --cross-prefix=x86_64-w64-mingw32- \
  --disable-gpl --disable-nonfree --disable-static --enable-shared \
  --disable-everything --disable-doc --disable-debug --disable-avdevice --disable-network \
  --disable-autodetect --disable-x86asm --enable-small \
  --disable-programs --enable-ffmpeg \
  --enable-swscale --enable-swresample --enable-avcodec --enable-avformat --enable-avfilter --enable-avutil \
  --enable-protocol='file,pipe' \
  --enable-demuxer='mov,matroska,gif,image2,avi,asf,aac,mp3,ogg,wav,webm' \
  --enable-muxer='mp4,gif,image2,ipod,mov' \
  --enable-decoder='h264,hevc,vp8,vp9,av1,mpeg4,mjpeg,png,gif,aac,mp3,opus,pcm_s16le,pcm_s16be' \
  --enable-encoder='mpeg4,aac,gif,png,mjpeg,h264_mf' \
  --enable-mediafoundation \
  --enable-parser='h264,hevc,vp8,vp9,av1,mpeg4video,aac,mpegaudio,opus,png,gif,mjpeg' \
  --enable-bsf='aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,null' \
  --enable-filter='scale,fps,palettegen,paletteuse,format,trim,setpts,aresample,aformat,split,anull,null' \
  --pkg-config=pkg-config
make -j"$(nproc)"
make install
OUT="$ROOT/vendor-win32-x64"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$PREFIX/bin/ffmpeg.exe" "$OUT/"
cp -a "$PREFIX/bin/"*.dll "$OUT/" 2>/dev/null || true
echo "WIN_FFMPEG_READY $OUT"
echo "Do not execute ffmpeg.exe on Linux. On Windows, run: ffmpeg -buildconf && ffmpeg -encoders"
