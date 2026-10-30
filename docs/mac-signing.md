# Mac 包签名与公证

## 为什么
macOS 的屏幕录制、辅助功能、摄像头授权绑在程序签名的 designated requirement 上；Gatekeeper 又要求下载的应用有 Developer ID 签名 + 公证，否则提示「无法验证开发者」，macOS 15 以后要去系统设置里点「仍要打开」。

| 模式 | 升级后权限还在？ | 「无法验证开发者」？ | 需要什么 |
|---|---|---|---|
| ad-hoc（`HOPSNAP_ADHOC=1`） | 否，每次重装要重开屏幕录制 | 有 | 什么都不用。只给自己试用 |
| 固定自签名证书（`HOPSNAP_SIGN_DIR`） | 是 | 有 | 一张自己生成、永远不换的证书 |
| Developer ID + 公证（`dist:mac:release`） | 是 | 没有 | Apple Developer Program（99 美元/年） |

正式对外发布用第三种。第二种是过渡方案。

## 怎么打包
```bash
# 自己试用
HOPSNAP_ADHOC=1 npm run dist:mac

# 固定自签名证书
HOPSNAP_SIGN_DIR=<放 cert.pem + key.pem 的文件夹> npm run dist:mac

# Developer ID + 公证（证书在钥匙串里，或 CSC_LINK / CSC_KEY_PASSWORD）
APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist:mac:release
```
`scripts/sign-mac.js` 在 electron-builder 之后运行：
1. 判断模式：已是 Developer ID 签名 → 只校验；有 `HOPSNAP_SIGN_DIR` → rcodesign 用 pem 签，并拼出主程序的 designated requirement `identifier "com.hopsnap.app" and certificate leaf = H"<证书 SHA-1>"`；`HOPSNAP_ADHOC=1` → mac 上用苹果 `codesign --deep --sign -`。
2. 校验：mac 上 `codesign --verify --deep --strict`（rcodesign 的 verify 在 mac 上会误报），Linux 上 rcodesign。
3. `ditto` 压成 `Hopsnap-<版本>-mac-AppleSilicon.zip` / `-Intel.zip`，打印大小和 SHA-256。

GitHub Actions（`.github/workflows/release.yml`）按仓库 Secrets 自动选模式：有 `CSC_LINK` 走 Developer ID，有 `HOPSNAP_SIGN_CERT_PEM` 走自签名，都没有就 ad-hoc。

## Developer ID + 公证要准备什么
1. 加入 Apple Developer Program，在 developer.apple.com → Certificates 创建 **Developer ID Application** 证书，导出 .p12。
2. 本机打包：把 .p12 导入钥匙串即可（electron-builder 自动找 "Developer ID Application"）。
   CI：`base64 -i cert.p12 | pbcopy` → Secret `CSC_LINK`，密码 → `CSC_KEY_PASSWORD`。
3. 公证：appleid.apple.com 生成 App 专用密码 → `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。
4. Hardened Runtime 的 entitlements 在 `build/entitlements.mac.plist`（JIT、原生模块、摄像头、麦克风）。

## 自签名证书（过渡方案）
```bash
openssl req -x509 -newkey rsa:2048 -days 7300 -nodes -subj "/CN=Hopsnap Code Signing" \
  -addext "extendedKeyUsage=codeSigning" -keyout key.pem -out cert.pem
```
- **永远用这一张。** 换证书 = 所有 Mac 用户重新授权一次。
- 私钥不进源码（`.gitignore` 忽略 `*.pem` / `*.p12`），放在仓库外的文件夹，CI 用 Secret。
- 私钥泄露 = 别人能做出继承呱咔授权的程序。
- 1.x 时期的证书（BillyShot Code Signing (Benji)）绑的是 `com.billyshot.app`，对 2.0 的新 bundle id 没有用处，2.0 需要新的一张。

## Apple Silicon 上打 Windows 包
electron-builder 自带的 makensis 是 x86_64 的，没装 Rosetta 会报 `spawn error -86`。`npm run dist:win`（`scripts/dist-win.js`）会自动改用 Homebrew 的 `makensis`：`brew install makensis`。

## 1.4.0 的证书（对 2.0 没用）
1.4.0 起用的「BillyShot Code Signing」（SHA-1 `32904a2594181a8564820a3b55999aa7727417c0`）绑的是 `com.billyshot.app`，对 2.0 的 `com.hopsnap.app` 没有用处。2.0 需要新的一张证书。
