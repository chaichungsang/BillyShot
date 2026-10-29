# 呱咔 / Hopsnap 2.0 设计规范

这份文档是 2.0 视觉的唯一依据。改任何界面前先对照它；新界面（File Tools、刘海等）并进来时按「分层」一节归类，再套对应的规则。

## 一句话

可爱住在品牌层和反馈层，工具层保持安静的深色。平涂、细线、大圆角、一个绿。

## 分层

| 层 | 是什么 | 底色 | 吉祥物 | 例子 |
|---|---|---|---|---|
| 品牌层 | 用户「看」而不是「用」的地方 | 奶油白 / 深墨绿（跟随系统） | 可以，且要有表情 | 开始页、关于、权限助手、介绍页、图标 |
| 应用层 | 设置类窗口 | 同上 | 只在空状态 | 设置各页、File Tools 窗口、文件面板（完成 / 进度） |
| 反馈层 | 一闪而过的状态 | 同上或半透明深色 | 可以 | 倒计时、空状态、错误提示、权限状态 |
| 工具层 | 盖在用户内容上的操作面 | 深色毛玻璃 `rgba(24,28,26,.88)`，不跟随系统 | 不出现 | 截图工具栏、录制条、File Tools 弧形菜单（arc）、刘海（notch）、摄像头圆窗、贴图边框 |

## 颜色

浅色（`:root`）
```
--accent #23A85F  --accent-hi #3BCB7C  --accent-ink #15804A  --accent-soft #E3F6EB  --accent-line #BFEAD0  --on-accent #fff
--bg #FAF6EC  --panel #FFFFFF  --line #ECE5D4  --line2 #F3EEE3  --text #1F2A24  --sub #6B746E  --mute #9AA39D
--field #FFFFFF  --field-line #E2DBCA  --hover #F5F0E4
--danger #E5484D  --danger-soft #FDECEC  --warn #E08E0B  --warn-soft #FFF4DF  --warn-line #F6D9A4
```
深色（`@media (prefers-color-scheme: dark)`）
```
--accent #2FBF71  --accent-hi #4BD689  --accent-ink #8AE6B0  --accent-soft rgba(59,203,124,.14)  --accent-line rgba(59,203,124,.35)  --on-accent #0B2A18
--bg #121B16  --panel #192420  --line #27352E  --line2 #202C26  --text #ECF2EE  --sub #9DAAA2  --mute #6C7872
--field #141E19  --field-line #2E3D35  --hover #202C26
--danger #FF6B6B  --warn #F5B641
```
工具层（固定深色）
```
--glass rgba(24,28,26,.88)  --accent #3BCB7C  --rec #FF5A6E  文字 #ECF2EE  次要 #9DAAA2  分隔 rgba(255,255,255,.1)
```
吉祥物（`src/renderer/frog.js`）：皮肤 #46CF80、肚皮 #B9F1CE、墨 #163B2A、腮红 #FFA3B8、舌头 #FF6B81。

规则：一个强调色；红只用于录制和危险；黄只用于警告 / 等待；不用金色、紫色、渐变色；**不用 `linear-gradient` / `radial-gradient`、`box-shadow`、彩色 `filter: blur` 辉光**。层次靠 1px 细线（`--line`）和底色差（`--bg` vs `--panel`）。

## 形状与字

- 圆角：卡片 18、控件 12、按钮和标签胶囊 999、工具层容器 16
- 边框 1px；选中态用 `--accent-soft` 底 + `--accent-ink` 字，不用描边高亮
- 按钮：高 34（大号 42），`button.primary` 实心绿；危险按钮只是红字，hover 才有红底
- 开关 44×26，圆点白
- 标题和数字：Nunito（`assets/fonts/Nunito.ttf`，`@font-face` 变量字重 200–1000），800 字重；正文系统字体（-apple-system / PingFang SC / Microsoft YaHei UI）
- 间距：页内边距 28–32，卡片内 16–20，行高 1.55

## 吉祥物用法

`Frog.mount(el, mood, size)`，表情：idle / blink / happy / snap / puff / sad / x / wink。
- 开始页 idle 并定时 blink；权限缺失时 sad
- 成功 / 完成 happy；空状态 wink；倒计时 puff；出错 x
- 不在工具栏、录制条、弧形菜单、刘海里出现
- 尺寸：品牌层 84–168，空状态 64–96，侧栏 36

## 文案

- 源码和词典统一写 `Hopsnap`，中文由 `i18n.brand()` 自动显示「呱咔」；要保留英文的元素加 `.brand-en`（系统设置列表里永远是 Hopsnap，所以教用户找开关时写 Hopsnap）
- 一句话说清为什么，再给一个按钮；少用「请」「您」；错误说原因和下一步
- 每个新字符串都要进 `src/i18n.js`（中文 key → 英文 value）

## 依赖项折叠

设置页里只在开关打开后才出现的子项用 `data-dep="a.b"`、`data-dep="a.b=value"`、`data-dep="a|b"`，`settings.js` 的 `applyDeps()` 负责显示隐藏。新加的设置项一律照此。

## 验证

```bash
osascript -e 'tell application "Hopsnap" to quit'   # 装好的正式版占着单实例锁
HOPSNAP_TEST=1 HOPSNAP_TEST_CMD=/tmp/hs-cmd.json ./node_modules/.bin/electron . --remote-debugging-port=9222
echo '{"cmd":"settings","tab":"general"}' > /tmp/hs-cmd.json      # 其他：capture / perm / fakePerm / quit
```
用 CDP（`http://127.0.0.1:9222/json/list` → `Page.captureScreenshot`，`Emulation.setEmulatedMedia` 切 light/dark）给每个改过的界面截 中 / 英 × 浅 / 深。截完 `{"cmd":"quit"}`，再 `open -a Hopsnap` 把正式版拉起来。
