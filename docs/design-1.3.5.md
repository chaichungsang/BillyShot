# BillyShot 1.3.5 — Mac 权限：系统一直弹授权框、开关开着还提示

## Benji 反馈（2026-10-04）
「系统一直弹授权框，开关开了还提示要权限」。

## 查到的原因
1. **辅助功能框反复弹**：uiohook-napi（libuiohook）在 macOS 上启动钩子时用 `AXIsProcessTrustedWithOptions(prompt = true)` 检查授权。
   旧代码只要设了鼠标快捷键 / 开了点击波纹就启动钩子，不管有没有授权 → 每次启动、每次重新注册快捷键（改设置、关设置窗口）都弹系统框；
   没授权时钩子其实收不到事件，授权后也要重开程序才行（hookStarted 已经是 true）。我们自己还会再调一次 `isTrustedAccessibilityClient(true)`。
2. **屏幕录制开关开了还提示**：macOS 的屏幕录制授权对正在运行的进程不生效，必须真正退出再打开；BillyShot 是菜单栏程序，关窗口不算退出。
3. **旧授权记录**：1.3.3 以前是 ad-hoc 签名，系统里留下的 BillyShot 记录绑的是旧签名，开关显示开着但不认新版本，要删掉重来。

## 改动
- `hotkeys.js`：Mac 上没授权不启动钩子（不会触发 libuiohook 的弹框）；每 2 秒静默查一次（`isTrustedAccessibilityClient(false)`），授权后自动启动并通知主进程，不用重开。没有功能需要钩子时停止轮询。新增 `axTrusted / whenAxTrusted / setAxGrantedHandler`。
- `main.js`：
  - 系统辅助功能框每个版本最多弹一次（`general.axAskedVer`），只在有鼠标快捷键 / 点击波纹且没授权时。
  - 屏幕录制提示框：打开系统设置 / **重新打开 BillyShot**（等本进程退出后 `open` 程序包）/ **修复权限** / 取消。每次启动只主动请求一次（`desktopCapturer.getSources`）。
  - 修复权限：`tccutil reset ScreenCapture com.billyshot.app`（辅助功能没授权时也重置 Accessibility，并马上请系统加回列表）→ 重新请求 → 打开系统设置 → 提示打开开关后重新打开。
  - 启动时记录权限状态 + 签名 requirement 到日志；不在「应用程序」文件夹运行时建议移过去（`app.moveToApplicationsFolder()`，可选「不再提示」= `general.macMoveAsk`）。
  - 「复制诊断信息」：版本、macOS、路径、是否在应用程序文件夹 / 被系统隔离（AppTranslocation）、各权限状态、designated requirement、`codesign --verify --deep --strict` 结果、是否有自定义图标（`Icon\r` 会让严格校验失败）。
- 设置 → 常规「macOS 权限」：屏幕录制 / 辅助功能状态（绿 / 红；没用鼠标快捷键和点击波纹时辅助功能不标红），按钮：屏幕录制权限、辅助功能权限、重新打开 BillyShot、修复权限、复制诊断信息。窗口获得焦点和每 3 秒（在常规页且有焦点时）刷新。
- 「恢复默认」保留 `axAskedVer`、`macMoveAsk`。
- Windows 行为不变（`axTrusted()` 在非 Mac 总是 true，新代码都有 isMac 判断）。

## 系统自己的提醒（改不了）
macOS 15 起，不用系统选择器直接截屏的程序，系统会定期（约每月）问一次「是否继续允许…绕过系统私密窗口选择器」。所有截图工具都一样，点允许即可。

## 测试
- `test/macperm_1_3_5.js`（node，模拟 macOS 的 electron / uiohook）13 项：没授权不启动钩子、反复注册不启动、从不带弹框参数、授权后 2 秒内自动启动并通知、鼠标快捷键能触发、停用后停钩子、无人需要时不轮询。
- 回归：中英文（含设置页无中文残留）、主题、Mac 玻璃重建、端到端、演示录屏全过。
- 真机才能确认：tccutil 重置、重新打开后授权生效、移到应用程序。
