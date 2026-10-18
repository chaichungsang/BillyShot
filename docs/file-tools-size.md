# 文件工具带来的体积

上限大约是安装包增加 60MB。下面是实测和估算。超过的话应停下来报告，而不是砍功能。这一版没有超过。

体积都是「多出来的文件」，不是整个 BillyShot。

| 部分 | 未压缩 | gzip -9 | xz -9e | 怎么来的 |
|---|---:|---:|---:|---|
| ffmpeg 7.1.1 Linux x64（LGPL，共享库） | 4.82 MB（5,026,736 字节） | 2.04 MB（2,138,517） | 1.63 MB（1,708,328） | 本仓库 `vendor/ffmpeg/linux-x64` 实测 |
| sharp / libvips Linux x64 | 18.7 MB | 8.03 MB（8,033,202） | 6.44 MB（6,444,492） | 本机 `node_modules/@img/sharp-libvips-linux-x64` 实测 |
| pdf-lib 1.17.1，只要 cjs 的 .js | 0.84 MB（842,340） | 0.14 MB（141,357） | — | 实测。sourcemap、`dist/`、`es/` 不打进安装包 |
| ffmpeg 7.1.1 Windows x64（LGPL，共享库，含 h264_mf） | 4.70 MB（4,922,368 字节） | 见 BUILD.txt | — | 本仓库 `vendor/ffmpeg/win32-x64` 实测。mingw-w64 交叉编译 |
| ffmpeg 7.1.1 Mac arm64（LGPL，共享库，含 h264_videotoolbox） | 4.72 MB（4,947,016 字节） | 2.12 MB（2,220,053） | 1.58 MB（1,660,952） | 本仓库 `vendor/ffmpeg/darwin-arm64` 实测。未签名。同名库只计一次，短名字是符号链接 |
| ffmpeg 7.1.1 Mac x64（LGPL，共享库，含 h264_videotoolbox） | 4.85 MB（5,087,472 字节） | 2.12 MB（2,226,198） | 1.70 MB（1,783,536） | 本仓库 `vendor/ffmpeg/darwin-x64` 实测。在 macos-14 上交叉编译。未签名 |
| sharp Mac arm64 / Mac x64 / Windows x64 | 约 19–22 MB | 约 8.4 / 9.2 / 8.6 MB | 约 6.2 / 7.2 / 6.7 MB | 估算，按 sharp 0.35 官方预编译包的公开体积 |

加总（压缩后，粗算）：

- Mac arm64：ffmpeg 2.12 MB + sharp 约 8.4 MB + pdf-lib 0.14 MB ≈ **10.7 MB**
- Mac x64：ffmpeg 2.12 MB + sharp 约 9.2 MB + pdf-lib 0.14 MB ≈ **11.5 MB**
- Windows x64：ffmpeg 约 2–5 MB + sharp 约 8.6 MB + pdf-lib 0.14 MB ≈ **11–14 MB**

未压缩大约 25–35 MB。都低于 60 MB。

没有装进安装包的东西：

- 完整的 BtbN LGPL `ffmpeg.exe`（xz 大约 41 MB）。那一份会把余量吃掉，所以用上面的最小构建。
- `@img/sharp-wasm32`（大约 9 MB）。
- pdf-lib 的 sourcemap 和 `dist/`（大约 14 MB）。
- 别的平台的 ffmpeg 和 sharp。Mac 包装 darwin，Windows 包装 win32-x64。

Windows 上 sharp 的平台包和 `sharp-libvips-*` 是配套的，两份都要。不要再额外塞一份 wasm。
