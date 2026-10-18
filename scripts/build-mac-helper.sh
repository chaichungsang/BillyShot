#!/bin/sh
# Shift 拖的默认路径。在 Mac 上编译，输出放进仓库的 native/mac/ShiftDrag，打进 .app。
# 不要在 ~/Projects/BillyShot 里编。建议的目录是 /tmp/billyshot-shift-drag，编完再把二进制拷回仓库。
# 不要单独 ad-hoc 签名。scripts/sign-mac.js 签整个 .app 时会把这个 Mach-O 和其他二进制一起签掉。
# osascript / JXA 不是默认路径。
set -eu
cd "$(dirname "$0")/.."
swiftc -O -framework Cocoa -o native/mac/ShiftDrag native/mac/ShiftDrag.swift
echo "Built native/mac/ShiftDrag. electron-builder packs native/**, and scripts/sign-mac.js signs it."
