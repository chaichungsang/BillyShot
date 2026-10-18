#!/bin/sh
# 可选。只在 Mac 上编 Shift 拖的原生小工具。编不了也不影响：应用会退回 osascript + native/mac/shift-drag.jxa.js。
# 不要单独 ad-hoc 签名。Billy 用现有的 scripts/sign-mac.js 签整个 .app，它会把包里的 Mach-O 一起签掉。
set -eu
cd "$(dirname "$0")/.."
swiftc -O -framework Cocoa -o native/mac/ShiftDrag native/mac/ShiftDrag.swift
echo "Built native/mac/ShiftDrag. Put it in the .app before scripts/sign-mac.js."
