#!/bin/sh
# 只在 macOS 上跑。目录必须不是 ~/Projects/BillyShot。
# 例：
#   mkdir -p /tmp/billyshot-ffmpeg-mac && cd /tmp/billyshot-ffmpeg-mac
#   /path/to/BillyShot/scripts/build-ffmpeg-mac.sh arm64 /tmp/billyshot-ffmpeg-mac
#   /path/to/BillyShot/scripts/build-ffmpeg-mac.sh x86_64 /tmp/billyshot-ffmpeg-mac
# 编完把 $ROOT/out 里的 ffmpeg 和 lib*.dylib 拷进仓库的 vendor/ffmpeg/darwin-arm64 或 darwin-x64。
# 源码是 ffmpeg 7.1.1，提交 db69d06eeeab4f46da15030a80d539efb4503ca8（tag n7.1.1）。
set -eu
ARCH="${1:-$(uname -m)}"
ROOT="${2:-/tmp/billyshot-ffmpeg-mac}"
case "$ROOT" in
  "$HOME"/Projects/BillyShot|"$HOME"/Projects/BillyShot/*) echo "refusing to build inside ~/Projects/BillyShot" >&2; exit 2 ;;
esac
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script only runs on macOS. VideoToolbox cannot be linked off-Mac." >&2
  exit 2
fi
SRC="$ROOT/src"
PREFIX="$ROOT/prefix-$ARCH"
mkdir -p "$SRC"
if [ ! -d "$SRC/ffmpeg-7.1.1" ]; then
  curl -fsSL -o "$ROOT/ffmpeg-7.1.1.tar.xz" https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz
  tar -xJf "$ROOT/ffmpeg-7.1.1.tar.xz" -C "$SRC"
fi
cd "$SRC/ffmpeg-7.1.1"
make distclean >/dev/null 2>&1 || true
HOST="$(uname -m)"
CROSS=""
CC="clang"
X86ASM=""
if [ "$ARCH" != "$HOST" ]; then
  CROSS="--enable-cross-compile"
  CC="clang -arch $ARCH"
  # arm64 上交叉编 x86_64 时，本机 nasm 经常编不出对的目标码。关掉 x86asm，仍是同一套 LGPL 配置。
  if [ "$ARCH" = "x86_64" ]; then X86ASM="--disable-x86asm"; fi
fi
./configure \
  --prefix="$PREFIX" \
  $CROSS --arch="$ARCH" --target-os=darwin --cc="$CC" \
  --disable-gpl --disable-nonfree --disable-static --enable-shared \
  --disable-everything --disable-doc --disable-debug --disable-avdevice --disable-network \
  --disable-autodetect --enable-small \
  --disable-programs --enable-ffmpeg \
  --enable-swscale --enable-swresample --enable-avcodec --enable-avformat --enable-avfilter --enable-avutil \
  --enable-videotoolbox \
  $X86ASM \
  --enable-protocol='file,pipe' \
  --enable-demuxer='mov,matroska,gif,image2,avi,asf,aac,mp3,ogg,wav,webm' \
  --enable-muxer='mp4,gif,image2,ipod,mov' \
  --enable-decoder='h264,hevc,vp8,vp9,av1,mpeg4,mjpeg,png,gif,aac,mp3,opus,pcm_s16le,pcm_s16be' \
  --enable-encoder='mpeg4,aac,gif,png,mjpeg,h264_videotoolbox' \
  --enable-parser='h264,hevc,vp8,vp9,av1,mpeg4video,aac,mpegaudio,opus,png,gif,mjpeg' \
  --enable-bsf='aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,null' \
  --enable-filter='scale,fps,palettegen,paletteuse,format,trim,setpts,aresample,aformat,split,anull,null' \
  --extra-ldflags='-Wl,-rpath,@loader_path' --enable-rpath
make -j"$(sysctl -n hw.ncpu)"
make install
case "$ARCH" in
  x86_64) FOLDER="darwin-x64" ;;
  arm64) FOLDER="darwin-arm64" ;;
  *) echo "unsupported arch $ARCH" >&2; exit 2 ;;
esac
OUT="$ROOT/$FOLDER"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$PREFIX/bin/ffmpeg" "$OUT/"
cp -a "$PREFIX/lib/"lib*.dylib "$OUT/"
# 去掉编译机的绝对路径，运行时只从 ffmpeg 旁边找库。
for lib in "$OUT"/*.dylib; do
  install_name_tool -id "@rpath/$(basename "$lib")" "$lib" || true
  deps=$(otool -L "$lib" | awk '/\/lib.*\.dylib/ { print $1 }')
  for dep in $deps; do
    base=$(basename "$dep")
    if [ -f "$OUT/$base" ]; then install_name_tool -change "$dep" "@rpath/$base" "$lib"; fi
  done
done
ffdeps=$(otool -L "$OUT/ffmpeg" | awk '/\/lib.*\.dylib/ { print $1 }')
for dep in $ffdeps; do
  base=$(basename "$dep")
  if [ -f "$OUT/$base" ]; then install_name_tool -change "$dep" "@rpath/$base" "$OUT/ffmpeg"; fi
done
install_name_tool -add_rpath @loader_path "$OUT/ffmpeg" || true
echo "Verify:"
RUN=""
if [ "$ARCH" != "$HOST" ] && [ "$ARCH" = "x86_64" ]; then RUN="arch -x86_64"; fi
$RUN "$OUT/ffmpeg" -hide_banner -buildconf
$RUN "$OUT/ffmpeg" -hide_banner -encoders
echo "MAC_FFMPEG_READY $OUT"
echo "Copy into vendor/ffmpeg/$FOLDER/ (each Mac build ships only that arch)."
