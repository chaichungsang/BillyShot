#!/bin/bash
# 1.2.4 应用图标切换（头像版 / 紫色玻璃版）
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
last() { grep "^$1" /tmp/app.log | tail -1 | sed "s/^$1 //"; }
ES()   { local n=$(grep -c '^EVAL' /tmp/app.log); cmd "{\"cmd\":\"evalSettings\",\"js\":\"$1\"}" ${2:-0.8}; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && last EVAL || echo NOEVAL; }
tray() { cmd '{"cmd":"trayInfo"}' 0.6; last TRAY; }
CFG=~/.config/BillyShot/settings.json
fresh() { rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot; echo "$1" > $CFG; }

# 1 老用户升级（1.2.3 的设置里没有 logo 字段）→ 默认头像版
fresh '{"general":{"firstRun":false},"record":{"countdown":0}}'
start_x; start_app 5
T=$(tray); echo "$T" | grep -q 'logos/portrait/tray.png' && echo "$T" | grep -q '"template":false' && ok "升级后默认头像版托盘" || bad "默认头像版托盘" "$T"
grep -q '^LOGO portrait' /tmp/app.log && ok "启动应用图标 = portrait" || bad "启动应用图标" "$(grep LOGO /tmp/app.log)"
H1=$(echo "$T" | grep -o '"hash":"[a-f0-9]*"')

# 2 设置页：选择器和左上角 / 欢迎页 / 关于页图标
cmd '{"cmd":"settings","tab":"general"}' 2.5
R=$(ES "[document.querySelector('.logo-opt.on').dataset.logo, document.querySelectorAll('.logo-img').length, [...document.querySelectorAll('.logo-img')].every(i=>i.src.includes('/logos/portrait/')), document.querySelector('#logoHint').textContent.length>5, [...document.querySelectorAll('.logo-opt img')].every(i=>i.complete&&i.naturalWidth===256)].join(',')")
[ "$R" = '"portrait,3,true,true,true"' ] && ok "设置页显示头像版并选中" || bad "设置页初始" "$R"
import -window root /tmp/logo_general_portrait.png

# 3 点选紫色版
ES "document.querySelector('.logo-opt[data-logo=purple] input').click();1" 1.5 >/dev/null
R=$(ES "[document.querySelector('.logo-opt.on').dataset.logo, [...document.querySelectorAll('.logo-img')].every(i=>i.src.includes('/logos/purple/')), document.querySelector('input[name=logo]:checked').value, !document.querySelector('.logo-opt.busy')].join(',')")
[ "$R" = '"purple,true,purple,true"' ] && ok "点选紫色版后界面切换" || bad "点选紫色版" "$R"
grep -q '"logo": "purple"' $CFG && ok "紫色版写入设置文件" || bad "写入设置" "$(grep logo $CFG)"
T=$(tray); echo "$T" | grep -q 'logos/purple/tray.png' && [ "$(echo "$T" | grep -o '"hash":"[a-f0-9]*"')" != "$H1" ] && ok "托盘图标即时换成紫色版" || bad "托盘换图" "$T"
sleep 1; import -window root /tmp/logo_general_purple.png

# 4 重启后保持
start_app 5
T=$(tray); echo "$T" | grep -q 'logos/purple/' && grep -q '^LOGO purple' /tmp/app.log && ok "重启后保持紫色版" || bad "重启保持" "$T"
cmd '{"cmd":"settings","tab":"about"}' 2.5
R=$(ES "[...document.querySelectorAll('.logo-img')].map(i=>i.src.split('/logos/')[1]).join('|')")
echo "$R" | grep -q 'purple/icon256.png|purple/icon256.png|purple/icon256.png' && ok "关于页 / 侧栏用紫色版" || bad "关于页图标" "$R"

# 5 再切回头像版
ES "document.querySelector('.logo-opt[data-logo=portrait] input').click();1" 1.5 >/dev/null
T=$(tray); echo "$T" | grep -q 'logos/portrait/' && grep -q '"logo": "portrait"' $CFG && ok "切回头像版" || bad "切回头像版" "$T"

# 6 恢复默认设置 → 头像版
cmd '{"cmd":"setSettings","patch":{"general":{"logo":"purple"}}}' 0.5
ES "window.confirm=()=>true;document.querySelector('#resetAll').click();1" 1.5 >/dev/null
R=$(ES "document.querySelector('.logo-opt.on').dataset.logo")
[ "$R" = '"portrait"' ] && grep -q '"logo": "portrait"' $CFG && ok "恢复默认后回到头像版" || bad "恢复默认" "$R"

# 7 设置文件里是无效值 → 回退头像版，不报错
fresh '{"general":{"firstRun":false,"logo":"rainbow"}}'
start_app 5
T=$(tray); echo "$T" | grep -q 'logos/portrait/' && ok "无效值回退头像版" || bad "无效值回退" "$T"

# 8 首次运行（全新安装）
fresh '{}'
start_app 6
R=$(ES "[document.querySelector('section.on').dataset.tab, document.querySelector('.hero .logo-img').src.includes('/logos/portrait/')].join(',')")
[ "$R" = '"welcome,true"' ] && ok "首次运行欢迎页用头像版" || bad "首次运行" "$R"
import -window root /tmp/logo_welcome.png

if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "无报错" "$(grep -E 'Uncaught|REPORTED_ERROR|TEST ERR' /tmp/app.log | head -3)"; else ok "无报错"; fi

# 9 Windows 快捷方式 / Mac 访达图标逻辑（模拟）
R=$(node test/logo_sim.js 2>&1); echo "$R" | grep -E '^(PASS|FAIL)' | while read -r l; do echo "$l"; done
P2=$(echo "$R" | grep -c '^PASS'); F2=$(echo "$R" | grep -c '^FAIL')
PASS=$((PASS+P2)); FAIL=$((FAIL+F2)); RESULTS+=("$(echo "$R" | grep -E '^(PASS|FAIL)')")

echo "=========================="
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL"
