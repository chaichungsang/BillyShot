# BillyShot 1.3.4 — 修复 Mac「透明玻璃」主题设置窗口重影

## 现象（Benji 2026-10-04 Mac 截图）
设置 → 常规 → 主题配色选「透明玻璃」后：内容重影（「开机启动」「恢复默认」叠了好几层、主题卡片下面又出现一份），
上一个主题（Matrix）的绿色残留在窗口里，说明文字看不清。

## 原因
1.3.3 的设置窗口创建时是不透明的（backgroundColor = 主题底色），换到玻璃时才 `setVibrancy('under-window')` +
`setBackgroundColor('#00000000')`。Electron 里背景透明度只在创建时（transparent: true）生效；在 macOS 上
中途改成透明，窗口底层仍按不透明处理，透明的像素每一帧都不清空，旧画面一直叠着。

## 修复（src/main.js）
- Mac 上玻璃主题的设置窗口创建时就是 `transparent: true, backgroundColor: '#00000000', vibrancy: 'under-window',
  visualEffectState: 'active'`（失去焦点也保持毛玻璃），`hasShadow: true`。窗口记 `glassBuilt`。
- `applyTheme()`：Mac 上 `glassBuilt` 和当前主题不一致时 `rebuildSettings()`：读旧窗口的当前页和滚动位置 →
  在同样的位置 / 大小建新窗口（query 带 scroll、toast=theme）→ 新窗口 ready-to-show 后显示并销毁旧窗口
  （4 秒兜底）。旧窗口标记 `replaced`，它的 closed 不恢复快捷键、不隐藏 Dock 图标。重建期间又换主题，结束后再查一次。
- 玻璃 ↔ 玻璃（深浅色）、普通主题之间切换不重建。Windows / Linux 行为不变（Windows 11 亚克力的运行时切换没有收到问题反馈）。
- 测试专用：`BILLYSHOT_TEST_MACGLASS=1` 让 Linux 走同样的重建流程；themeInfo 多输出 winId / glassBuilt / winBounds / winVisible / settingsWins。

## 测试
`test/macglass_1_3_4.sh` 17 项。Mac 上的毛玻璃效果和重影本身只能真机确认。
