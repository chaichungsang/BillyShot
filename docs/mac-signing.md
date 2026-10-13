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

## 证书
- 名称 BillyShot Code Signing (Benji)，RSA 2048，2026-10-04 至 2046-09-29，扩展用途只有 Code Signing。
- SHA-1 `5ba125bc0247568936c57aa8a521046885684e45`。
- 私钥不在源码里（`.gitignore` 忽略 `*.pem` / `*.p12`），由 Benji 保管。
- **永远用这一张。** 换证书 = 所有 Mac 用户重新授权一次。私钥泄露 = 别人能做出继承 BillyShot 授权的程序。
