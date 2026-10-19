#!/bin/sh
# 编一份最小的 LGPL ffmpeg。禁止 GPL / nonfree / libx264 / libx265。
# Mac 再加上 --enable-videotoolbox --enable-encoder=h264_videotoolbox
# Windows（mingw）再加上 --enable-mediafoundation --enable-encoder=h264_mf
# 编完用 patchelf / install_name_tool 把 rpath 收成 $ORIGIN，不要留编译机的绝对路径。
# 现成的 Linux 成品在 vendor/ffmpeg/linux-x64，许可文本在 vendor/ffmpeg/COPYING.LGPLv2.1。
set -eu
PREFIX="${1:-/tmp/ffmpeg-linux-prefix}"
./configure \
  --prefix="$PREFIX" \
  --disable-gpl --disable-nonfree --disable-static --enable-shared \
  --disable-everything --disable-doc --disable-debug --disable-avdevice --disable-network \
  --disable-autodetect --disable-x86asm --enable-small \
  --disable-programs --enable-ffmpeg \
  --enable-swscale --enable-swresample --enable-avcodec --enable-avformat --enable-avfilter --enable-avutil \
  --enable-protocol='file,pipe' \
  --enable-demuxer='mov,matroska,gif,image2,avi,asf,aac,mp3,ogg,wav,webm' \
  --enable-muxer='mp4,gif,image2,ipod,mov' \
  --enable-decoder='h264,hevc,vp8,vp9,av1,mpeg4,mjpeg,png,gif,aac,mp3,opus,pcm_s16le,pcm_s16be' \
  --enable-encoder='mpeg4,aac,gif,png,mjpeg' \
  --enable-parser='h264,hevc,vp8,vp9,av1,mpeg4video,aac,mpegaudio,opus,png,gif,mjpeg' \
  --enable-bsf='aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,null' \
  --enable-filter='scale,fps,palettegen,paletteuse,format,trim,setpts,aresample,aformat,split,anull,null' \
  --extra-ldflags='-Wl,-rpath,$ORIGIN' --enable-rpath
make -j"$(nproc)"
make install
# $ORIGIN 有时会被 configure 吃掉，装完再钉一次。
if command -v patchelf >/dev/null 2>&1; then
  find "$PREFIX" -type f \( -name ffmpeg -o -name 'lib*.so*' \) -exec patchelf --set-rpath '$ORIGIN' {} \;
fi
echo "Installed into $PREFIX. Copy bin/ffmpeg and lib/lib*.so* into vendor/ffmpeg/\${platform}-\${arch}/."
