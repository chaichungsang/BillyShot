# Mac 包签名（自签名证书）

## 为什么
macOS 的屏幕录制、辅助功能、摄像头授权绑在程序签名的 designated requirement 上。

- 1.3.3 及以前：rcodesign ad-hoc 签名，没有证书，requirement 等于这一版文件的哈希（cdhash）。每打一次包都变，用户升级后系统设置里开关还开着，但系统不认新版本，又弹窗。
- 现在：用一张固定的自签名证书签名，主程序 requirement 是
  `identifier "com.billyshot.app" and certificate leaf = H"<证书 SHA-1>"`，
  以后每个版本都一样，升级不用重新授权。

自签名证书去不掉「无法验证开发者」提示（要付费的 Apple Developer ID + 公证才行），`xattr -cr` / 「仍要打开」那一步照旧。

## 怎么打包
```
BILLYSHOT_SIGN_DIR=<放 cert.pem + key.pem 的文件夹> npm run dist:mac
```
`scripts/sign-mac.js` 在 electron-builder 之后运行：

1. 用证书 SHA-1 拼出主程序的 designated requirement（rcodesign 对非 Apple 证书不会自动生成）。
2. `rcodesign sign --timestamp-url none` 签整个 .app（嵌套的 Helper、Framework、.node 一起签）。
3. 逐个 `rcodesign verify` 所有 Mach-O，确认没有残留 ad-hoc，主程序里有证书 requirement。
4. `zip -ry` 压成 `BillyShot-<版本>-mac-Intel.zip` / `-AppleSilicon.zip`，打印大小和 SHA-256。

没设 `BILLYSHOT_SIGN_DIR` 会直接报错，防止发出 ad-hoc 包。自己从源码打着玩可以设 `BILLYSHOT_ADHOC=1`。

需要 rcodesign（apple-codesign 0.29.0，GitHub 有 Linux musl 预编译包）。

## 证书（当前规则，1.4.0 起）
- 签名身份：**BillyShot Code Signing**（自签名证书，2026-10-13 生成）。
- SHA-1 `32904a2594181a8564820a3b55999aa7727417c0`。
- 主程序 designated requirement：
  `identifier "com.billyshot.app" and certificate leaf = H"32904a2594181a8564820a3b55999aa7727417c0"`。
- 存放位置：Billy 的 Mac，`~/BillyShot-sign`（`cert.pem` + `key.pem`，打包时 `BILLYSHOT_SIGN_DIR` 指向这里）。私钥不在源码里（`.gitignore` 忽略 `*.pem` / `*.p12`），不要提交、不要贴到任何地方。
- 自签名，**没有公证**（不是 Apple Developer ID），所以「无法验证开发者」提示照旧。
- 1.4.0 及以后的 Mac 包都用这一张签。
- **以后永远用这一张。** 换证书 = 所有 Mac 用户重新授权一次。私钥泄露 = 别人能做出继承 BillyShot 授权的程序。
- 打包后核对：`sign-mac.js` 会打印「证书 SHA-1」，必须等于上面的值；不一致就不要发布。

## 历史
- 1.3.3 及以前：ad-hoc 签名（见上）。
- 1.3.5 及以前（ad-hoc 之后的证书签名版本）：用 **BillyShot Code Signing (Benji)** 签，SHA-1 `5ba125bc0247568936c57aa8a521046885684e45`。这张证书已不再使用。
- 1.4.0 换成了现在这张证书，designated requirement 跟 1.3.5 不同。**从 1.3.5（或更早）升级的用户需要在「系统设置 → 隐私与安全性」里重新授权一次「屏幕录制」和「辅助功能」**（列表里旧的 BillyShot 条目可以先删掉再重新添加）。之后的版本升级不用再授权。
