#!/bin/bash
# 1.3.4 Mac「透明玻璃」设置窗口重影修复：切入 / 切出玻璃主题时重建设置窗口
# Linux 上用 BILLYSHOT_TEST_MACGLASS=1 走和 Mac 一样的重建流程（Mac 的毛玻璃 / 重影本身要真机看）
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "{\"cmd\":\"$c\",\"js\":\"$js\"}" ${3:-1}; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
TI()  { cmd '{"cmd":"themeInfo"}' 0.8; grep '^THEMEINFO' /tmp/app.log | tail -1 | cut -d' ' -f2-; }
J()   { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(repr(($2)))"; }
CFG=~/.config/BillyShot/settings.json
fresh() { rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot; echo "$1" > $CFG; }
pick() { EV evalSettings "document.querySelector('.theme-opt[data-theme=$1] input').click();1" ${2:-3} >/dev/null; }
start_x

export EXTRA_ENV="BILLYSHOT_TEST_MACGLASS=1"
fresh '{"general":{"firstRun":false,"language":"zh","theme":"ocean"}}'
start_app 7; cmd '{"cmd":"settings","tab":"general"}' 3

# 1 普通主题：不透明窗口
T=$(TI); A=$(J "$T" "d['winId']"); B0=$(J "$T" "d['winBounds']")
[ "$(J "$T" "d['glassBuilt'],d['settingsWins'],d['winVisible']")" = "(False, 1, True)" ] && ok "深海蓝：普通不透明设置窗口" || bad "初始窗口" "$T"

# 2 换到透明玻璃 → 重建（位置、大小、当前页、滚动位置不变，有提示）
EV evalSettings "(()=>{const m=document.querySelector('main');m.scrollTop=240;return m.scrollTop})()" >/dev/null
SC=$(EV evalSettings "document.querySelector('main').scrollTop")
pick glass 4
T=$(TI)
[ "$(J "$T" "d['glassBuilt'],d['winId']!=$A,d['settingsWins'],d['winVisible']")" = "(True, True, 1, True)" ] && ok "选透明玻璃：设置窗口按透明窗口重建，只有 1 个" || bad "切入玻璃重建" "$T"
[ "$(J "$T" "d['winBounds']")" = "$B0" ] && ok "重建后位置和大小不变" || bad "位置大小" "$B0 -> $(J "$T" "d['winBounds']")"
R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('nav a.on').dataset.tab, document.querySelector('.theme-opt.on').dataset.theme, Math.abs(document.querySelector('main').scrollTop-$SC)<=2, (document.querySelector('.toast')||{}).textContent].join(',')")
[ "$R" = '"glass,general,glass,true,配色已更换"' ] && ok "重建后：玻璃主题、仍在「常规」、滚动位置 $SC 保留、提示「配色已更换」" || bad "重建后状态" "$R (scroll $SC)"
grep -q '"theme": "glass"' $CFG && ok "设置文件已保存 glass" || bad "设置文件" "$(cat $CFG)"
grep -q 'settings window rebuilt for theme glass' /tmp/app.log && ok "日志记录了重建" || bad "日志" ""
B=$(J "$T" "d['winId']")

# 3 玻璃里切深浅色：不重建
EV evalSettings "(()=>{const s=document.getElementById('modeSel');s.value='dark';s.dispatchEvent(new Event('change'));return 1})()" 2 >/dev/null
T=$(TI); [ "$(J "$T" "d['winId']==$B,d['glassBuilt'],d['dark']")" = "(True, True, True)" ] && ok "玻璃主题下切深色：不重建窗口" || bad "深浅色不重建" "$T"
EV evalSettings "(()=>{const s=document.getElementById('modeSel');s.value='system';s.dispatchEvent(new Event('change'));return 1})()" 2 >/dev/null

# 4 从玻璃换走 → 再重建成不透明窗口
pick graphite 4
T=$(TI)
[ "$(J "$T" "d['glassBuilt'],d['winId']!=$B,d['settingsWins'],d['winBg'],d['winVisible']")" = "(False, True, 1, '#F4F4F5', True)" ] && ok "换成石墨：重建回不透明窗口，底色 = 石墨" || bad "切出玻璃" "$T"
R=$(EV evalSettings "document.documentElement.dataset.theme"); [ "$R" = '"graphite"' ] && ok "界面是石墨" || bad "界面主题" "$R"
C=$(J "$T" "d['winId']")

# 5 普通主题之间切换：不重建
pick forest 2; pick rose 2
T=$(TI); [ "$(J "$T" "d['winId']==$C,d['winBg'],d['settingsWins']")" = "(True, '#FBF6F7', 1)" ] && ok "普通主题之间切换：不重建，只换底色" || bad "普通切换" "$T"

# 5b 旧窗口在重建期间不自己换样式（不然旧的不透明窗口上会先出现重影），也不弹两次提示
R=$(EV evalSettings "api.invoke('settings:theme','glass').then(r=>[r.rebuilding, document.documentElement.dataset.theme, document.documentElement.classList.contains('material')].join(','))" 0.5)
[ "$R" = '"true,rose,false"' ] && ok "重建期间旧窗口保持原样（rebuilding=true）" || bad "旧窗口保持原样" "$R"
sleep 4; T=$(TI); [ "$(J "$T" "d['glassBuilt'],d['settingsWins']")" = "(True, 1)" ] && ok "随后新玻璃窗口接手" || bad "新窗口接手" "$T"
pick ocean 4

# 6 连续快速切换（玻璃 → 深海蓝 → 玻璃），最后状态一致、只有一个窗口
EV evalSettings "document.querySelector('.theme-opt[data-theme=glass] input').click();1" 0.3 >/dev/null
sleep 0.5; EV evalSettings "document.querySelector('.theme-opt[data-theme=ocean] input').click();1" 0.3 >/dev/null
sleep 0.5; EV evalSettings "document.querySelector('.theme-opt[data-theme=glass] input').click();1" 0.3 >/dev/null
sleep 6
T=$(TI); R=$(EV evalSettings "document.documentElement.dataset.theme")
[ "$(J "$T" "d['theme'],d['glassBuilt'],d['settingsWins'],d['winVisible']")" = "('glass', True, 1, True)" ] && [ "$R" = '"glass"' ] && ok "快速连续切换：最后是玻璃窗口，只有 1 个" || bad "快速切换" "$T | $R"

# 7 关掉再打开：玻璃主题直接按透明窗口创建；关掉后快捷键恢复
cmd '{"cmd":"evalSettings","js":"setTimeout(()=>window.close(),50),1"}' 1.5
T=$(TI); [ "$(J "$T" "d['winId'],d['settingsWins']")" = "(None, 0)" ] && ok "关掉设置窗口：干净关闭" || bad "关闭" "$T"
cmd '{"cmd":"settings","tab":"record"}' 3
T=$(TI); R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('nav a.on').dataset.tab, !!document.querySelector('.toast.show')].join(',')")
[ "$(J "$T" "d['glassBuilt'],d['settingsWins']")" = "(True, 1)" ] && [ "$R" = '"glass,record,false"' ] && ok "已是玻璃时打开设置：一开始就是透明窗口（录屏页，无多余提示）" || bad "直接打开玻璃" "$T | $R"

# 8 恢复默认（玻璃 → 跟随图标）也会重建
R=$(EV evalSettings "api.invoke('settings:reset').then(()=>1)" 4)
T=$(TI); [ "$(J "$T" "d['theme'],d['glassBuilt'],d['settingsWins']")" = "('gold', False, 1)" ] && ok "恢复默认设置：从玻璃变回黑金并重建" || bad "恢复默认" "$T"

# 9 截图仍正常（快捷键 / 截图流程没被打断）
cmd '{"cmd":"capture"}' 2; xdotool key Escape; sleep 0.8
cmd '{"cmd":"status"}' 0.8; grep STATUS /tmp/app.log | tail -1 | grep -q '"overlayVisible":false' && ok "截图打开 / Esc 退出正常" || bad "截图" "$(grep STATUS /tmp/app.log | tail -1)"
grep -E "Uncaught|TypeError|ReferenceError|settings rebuild" /tmp/app.log | grep -v "^EVAL" | head -3 > /tmp/errs.txt
[ ! -s /tmp/errs.txt ] && ok "日志里没有脚本错误" || bad "脚本错误" "$(cat /tmp/errs.txt)"

# 10 不是 Mac（Windows / Linux）：照旧不重建
export EXTRA_ENV=""
fresh '{"general":{"firstRun":false,"language":"zh","theme":"ocean"}}'
start_app 7; cmd '{"cmd":"settings","tab":"general"}' 3
T=$(TI); A=$(J "$T" "d['winId']")
pick glass 3
T=$(TI); R=$(EV evalSettings "[document.documentElement.dataset.theme, document.documentElement.classList.contains('material')].join(',')")
[ "$(J "$T" "d['winId']==$A,d['glassBuilt']")" = "(True, False)" ] && [ "$R" = '"glass,false"' ] && ok "非 Mac：选玻璃不重建窗口（Windows / Linux 行为不变）" || bad "非 Mac 不变" "$T | $R"

kill $(cat /tmp/app.pid) 2>/dev/null
echo; echo "== Mac 玻璃重建 1.3.4: PASS $PASS / FAIL $FAIL =="
printf '%s\n' "${RESULTS[@]}" > /tmp/macglass_results.txt
[ $FAIL -eq 0 ]
