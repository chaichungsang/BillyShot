#!/bin/bash
# 1.2.6 主题配色：9 套配色 + 跟随图标 + 深浅色
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "{\"cmd\":\"$c\",\"js\":\"$js\"}" ${3:-1}; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
TI()  { cmd '{"cmd":"themeInfo"}' 0.8; grep '^THEMEINFO' /tmp/app.log | tail -1 | cut -d' ' -f2-; }
CFG=~/.config/BillyShot/settings.json
fresh() { rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot; echo "$1" > $CFG; }
openset() { cmd '{"cmd":"settings","tab":"general"}' 3; }
start_x

# 1 从 1.2.5 升级（没有 theme 字段）+ 头像图标 → 跟随图标 = 黑金
fresh '{"general":{"firstRun":false,"language":"zh","logo":"portrait"}}'
start_app 7; openset
R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('.theme-opt.on').dataset.theme, document.querySelectorAll('.theme-opt').length, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()].join(',')")
[ "$R" = '"gold,auto,10,#c99a52"' ] && ok "升级后默认「跟随图标」→ 黑金（10 个选项）" || bad "默认黑金" "$R"
T=$(TI); echo "$T" | grep -q '"theme":"gold","setting":"auto","source":"system"' && echo "$T" | grep -q '"winBg":"#F7F5F1"' && ok "窗口底色 = 黑金浅色背景" || bad "窗口底色" "$T"
R=$(EV evalSettings "document.querySelector('.theme-opt[data-theme=auto] small').textContent"); [ "$R" = '"黑金（按图标）"' ] && ok "「跟随图标」卡片写明当前对应黑金" || bad "跟随图标说明" "$R"
R=$(EV evalOverlay "document.documentElement.dataset.theme"); [ "$R" = '"gold"' ] && ok "截图工具栏也是黑金" || bad "截图层主题" "$R"

# 2 换成紫色图标 → 跟随图标变午夜紫
R=$(EV evalSettings "document.querySelector('.logo-opt[data-logo=purple] input').click();1" 2)
R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('.theme-opt[data-theme=auto] small').textContent].join(',')")
[ "$R" = '"midnight,午夜紫（按图标）"' ] && ok "换紫色图标 → 自动变午夜紫" || bad "紫色图标跟随" "$R"
R=$(EV evalOverlay "document.documentElement.dataset.theme"); [ "$R" = '"midnight"' ] && ok "截图工具栏跟着变午夜紫" || bad "截图层跟随" "$R"
EV evalSettings "document.querySelector('.logo-opt[data-logo=portrait] input').click();1" 2 >/dev/null

# 3 逐个选择 9 套配色
declare -A BG=( [midnight]=F6F6F8 [gold]=F7F5F1 [graphite]=F4F4F5 [ocean]=F4F7FB [forest]=F4F8F6 [rose]=FBF6F7 [paper]=F6F6F8 [glass]=EEF0F7 [matrix]=020804 )
for th in midnight gold graphite ocean forest rose paper glass matrix; do
  R=$(EV evalSettings "document.querySelector('.theme-opt[data-theme=$th] input').click();1" 1.5)
  R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('.theme-opt.on').dataset.theme, document.querySelector('input[name=theme]:checked').value].join(',')")
  T=$(TI)
  if [ "$R" = "\"$th,$th,$th\"" ] && grep -q "\"theme\": \"$th\"" $CFG && echo "$T" | grep -q "\"winBg\":\"#${BG[$th]}\""; then ok "选「$th」：界面、设置文件、窗口底色一致"; else bad "选 $th" "$R | $T"; fi
done
R=$(EV evalOverlay "[document.documentElement.dataset.theme, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()].join(',')")
[ "$R" = '"matrix,#00ff66"' ] && ok "截图工具栏强调色跟着变（Matrix 绿）" || bad "截图层强调色" "$R"

# 4 Matrix：代码雨、深浅色锁定为深色
R=$(EV evalSettings "[!!document.getElementById('rain'), document.getElementById('modeSel').disabled, getComputedStyle(document.body).backgroundColor].join(',')")
[ "$R" = '"true,true,rgb(2, 8, 4)"' ] && ok "Matrix：侧栏代码雨 + 深色锁定" || bad "Matrix" "$R"
sleep 1; R1=$(EV evalSettings "document.getElementById('rain').toDataURL().length"); sleep 0.6; R2=$(EV evalSettings "document.getElementById('rain').toDataURL().length")
[ "$R1" != "$R2" ] && ok "代码雨在动" || bad "代码雨动画" "$R1 $R2"
EV evalSettings "document.querySelector('.theme-opt[data-theme=ocean] input').click();1" 1.5 >/dev/null
R=$(EV evalSettings "[!!document.getElementById('rain'), document.getElementById('modeSel').disabled].join(',')")
[ "$R" = '"false,false"' ] && ok "换走 Matrix 后代码雨停止并移除" || bad "代码雨移除" "$R"

# 5 透明玻璃（Linux 没有系统毛玻璃 → CSS 模拟）
EV evalSettings "document.querySelector('.theme-opt[data-theme=glass] input').click();1" 1.5 >/dev/null
R=$(EV evalSettings "[document.documentElement.classList.contains('material'), getComputedStyle(document.body).backgroundImage.includes('radial-gradient'), getComputedStyle(document.querySelector('.group')).backdropFilter!=='none', document.querySelector('.theme-opt[data-theme=glass] small').textContent].join(',')")
[ "$R" = '"false,true,true,毛玻璃效果"' ] && ok "透明玻璃：不支持系统毛玻璃时用渐变 + 半透明卡片" || bad "玻璃回退" "$R"

# 6 深浅色
EV evalSettings "document.querySelector('.theme-opt[data-theme=forest] input').click();1" 1.5 >/dev/null
EV evalSettings "(()=>{const s=document.getElementById('modeSel');s.value='dark';s.dispatchEvent(new Event('change'));return 1})()" 1.5 >/dev/null
T=$(TI); R=$(EV evalSettings "[matchMedia('(prefers-color-scheme: dark)').matches, getComputedStyle(document.body).backgroundColor].join(',')")
echo "$T" | grep -q '"source":"dark","dark":true' && echo "$T" | grep -q '"winBg":"#0F1412"' && [ "$R" = '"true,rgb(15, 20, 18)"' ] && ok "深色：森林绿深色背景" || bad "深色模式" "$T | $R"
EV evalSettings "(()=>{const s=document.getElementById('modeSel');s.value='light';s.dispatchEvent(new Event('change'));return 1})()" 1.5 >/dev/null
T=$(TI); R=$(EV evalSettings "[matchMedia('(prefers-color-scheme: dark)').matches, getComputedStyle(document.body).backgroundColor].join(',')")
echo "$T" | grep -q '"source":"light","dark":false' && [ "$R" = '"false,rgb(244, 248, 246)"' ] && ok "浅色：森林绿浅色背景" || bad "浅色模式" "$T | $R"
grep -q '"appearance": "light"' $CFG && ok "深浅色写入设置文件" || bad "深浅色保存" "$(grep appearance $CFG)"

# 7 重启后保持 + 首屏就是对的主题（URL 参数）
EV evalSettings "document.querySelector('.theme-opt[data-theme=matrix] input').click();1" 1.5 >/dev/null
start_app 7; openset
R=$(EV evalSettings "[new URLSearchParams(location.search).get('theme'), document.documentElement.dataset.theme, !!document.getElementById('rain')].join(',')")
T=$(TI); [ "$R" = '"matrix,matrix,true"' ] && echo "$T" | grep -q '"source":"light"' && ok "重启后保持 Matrix 和浅色设置，首屏直接是 Matrix" || bad "重启保持" "$R | $T"
R=$(EV evalOverlay "document.documentElement.dataset.theme"); [ "$R" = '"matrix"' ] && ok "重启后截图工具栏也是 Matrix" || bad "重启截图层" "$R"

# 8 恢复默认 → 跟随图标 + 跟随系统
EV evalSettings "window.confirm=()=>true;document.querySelector('#resetAll').click();1" 2 >/dev/null
R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('.theme-opt.on').dataset.theme, document.getElementById('modeSel').value].join(',')")
T=$(TI); [ "$R" = '"gold,auto,system"' ] && echo "$T" | grep -q '"source":"system"' && ok "恢复默认：跟随图标（黑金）+ 跟随系统" || bad "恢复默认" "$R | $T"

# 9 非法值
R=$(EV evalSettings "api.invoke('settings:theme','neon').then(r=>r.error)"); [ "$R" = '"unknown theme"' ] && ok "非法主题名被拒绝" || bad "非法主题" "$R"
fresh '{"general":{"firstRun":false,"language":"zh","theme":"neon","appearance":"weird"}}'
start_app 7; openset
R=$(EV evalSettings "[document.documentElement.dataset.theme, document.querySelector('.theme-opt.on').dataset.theme].join(',')"); T=$(TI)
[ "$R" = '"gold,auto"' ] && echo "$T" | grep -q '"source":"system"' && ok "设置文件里是无效值 → 回到默认" || bad "无效值回退" "$R | $T"

# 10 英文界面
fresh '{"general":{"firstRun":false,"language":"en"}}'
start_app 7; openset
R=$(EV evalSettings "[...document.querySelectorAll('.theme-opt > span b')].map(b=>b.textContent).join('|')")
[ "$R" = '"Match icon|Midnight Purple|Black Gold|Graphite|Deep Ocean|Forest|Rose|Paper White|Glass|Matrix"' ] && ok "英文：配色名称" || bad "英文配色名" "$R"
R=$(EV evalSettings "[document.querySelector('.theme-pick .lbl b').textContent, document.querySelector('#modeSel option').textContent, document.querySelector('.theme-opt[data-theme=auto] small').textContent].join('|')")
[ "$R" = '"Color theme|Light / dark: follow system|Black Gold (from icon)"' ] && ok "英文：标题和选项" || bad "英文标题" "$R"

if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "无报错" "$(grep -E 'Uncaught|REPORTED_ERROR|TEST ERR' /tmp/app.log | head -3)"; else ok "无报错"; fi
echo "=========================="
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL"
