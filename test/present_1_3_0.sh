#!/bin/bash
# 1.3.0 演示录屏测试：演示层（光圈 / 波纹 / 聚光灯）、演示模式、摄像头圆窗、控制条、设置页、托盘、快捷键
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want=$3 got=$2"; fi; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "$(jq -cn --arg c "$c" --arg js "$js" '{cmd:$c,js:$js}')" 0.7; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
PS()  { local n=$(grep -c '^PSTATUS' /tmp/app.log); cmd '{"cmd":"presentStatus"}' 0.6; local m=$(grep -c '^PSTATUS' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^PSTATUS' /tmp/app.log | tail -1 | sed 's/^PSTATUS //' || echo '{}'; }
PJ()  { local r; for i in 1 2 3; do r=$(PS | jq -c "$1" 2>/dev/null) && [ -n "$r" ] && { echo "$r"; return; }; sleep 0.3; done; echo "$r"; }   # 取演示状态里的字段
LAYER() { EV evalLayer "JSON.stringify(window.__present())" | jq -r '.' 2>/dev/null; }
pix() { convert "$1" -crop 1x1+$2+$3 -depth 8 txt:- 2>/dev/null | tail -1 | grep -o 'srgb([0-9,]*)' | tr -d 'srgb()'; }
lum() { echo "$1" | awk -F, '{printf "%d", ($1*299+$2*587+$3*114)/1000}'; }
dist() { awk -v a="$1" -v b="$2" 'BEGIN{split(a,x,",");split(b,y,",");d=0;for(i=1;i<=3;i++){t=x[i]-y[i];d+=(t<0?-t:t)};print d}'; }
newest(){ ls -t $1 2>/dev/null | head -1; }
VD=~/Videos/BillyShot
sel() { xdotool mousemove $1 $2 mousedown 1 mousemove $(( ($1+$3)/2 )) $(( ($2+$4)/2 )) mousemove $3 $4 mouseup 1; sleep 0.5; }
winid() { xwininfo -root -tree | grep "\"$1\"" | head -1 | awk '{print $1}'; }

rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot $VD; rm -f $VD/*
cat > ~/.config/BillyShot/settings.json <<J
{"general":{"firstRun":false,"language":"zh"},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4"},"sound":{"record":false,"countdown":false}}
J
start_x; EXTRA_ENV="BILLYSHOT_FAKE_MEDIA=1" start_app 6
cmd '{"cmd":"windows"}' 0.6; W0=$(grep WINDOWS /tmp/app.log | tail -1 | awk '{print $2}')

# ---------------------------------------------------------------- 默认状态
chk "P1 默认没有演示层、没有摄像头" "$(PJ '[(.layers|length), .cam, .demo, .spot]')" '[0,null,false,false]'
R=$(jq -c '[.present.halo,.present.clicks,.present.camera,.present.withRecord]' ~/.config/BillyShot/settings.json 2>/dev/null); [ -z "$R" ] && R=$(cat ~/.config/BillyShot/settings.json | head -c 100)
cmd '{"cmd":"status"}' 0.6; HS=$(grep '^STATUS' /tmp/app.log | tail -1 | sed 's/^STATUS //')
chk "P1b 演示模式 / 聚光灯默认不占用快捷键" "$(echo "$HS" | jq -c '[.hotkeyStatus.presentMode.keyboard,.hotkeyStatus.spotlight.keyboard]')" '["",""]'
grep -q "NOTIFY 有快捷键被其他软件占用" /tmp/app.log && bad "P1c 启动时不弹快捷键占用通知" "$(grep NOTIFY /tmp/app.log)" || ok "P1c 启动时不弹快捷键占用通知"
cmd '{"cmd":"setSettings","patch":{"hotkeys":{"presentMode":{"keyboard":"Alt+Shift+H"},"spotlight":{"keyboard":"Alt+Shift+L"}}}}' 0.5; cmd '{"cmd":"applyHotkeysTest"}' 0.6
cmd '{"cmd":"status"}' 0.6; HS=$(grep '^STATUS' /tmp/app.log | tail -1 | sed 's/^STATUS //')
chk "P1d 设置快捷键后能注册成功" "$(echo "$HS" | jq -c '[.hotkeyStatus.presentMode.keyboard,.hotkeyStatus.spotlight.keyboard]')" '["ok","ok"]'
cmd '{"cmd":"recordFull"}' 1.5; xdotool mousemove 600 400; sleep 1
chk "P2 默认设置录屏不出演示层和摄像头（老用户录屏结果不变）" "$(PJ '[.rec,(.layers|length),.cam]')" '[true,0,null]'
cmd '{"cmd":"stop"}' 3

# ---------------------------------------------------------------- 演示模式 + 光圈
xdotool mousemove 800 300; sleep 0.3
shot /tmp/p_nohalo.png
ACT0=$(xdotool getactivewindow 2>/dev/null)
cmd '{"cmd":"present","action":"demo","on":true}' 1.5
chk "P3 演示模式：每块屏一个演示层" "$(PJ '[.demo,(.layers|length),.layers[0].visible]')" '[true,1,true]'
chk "P3a 演示层出现时不抢走当前窗口的焦点" "$(xdotool getactivewindow 2>/dev/null)" "$ACT0"
grep -q "NOTIFY 已开启鼠标光圈和点击波纹" /tmp/app.log && ok "P3b 都没开时进入演示模式会自动开启光圈和波纹并提示" || bad "P3b 自动开启提示" "no notify"
B=$(PJ '.layers[0].bounds'); [ "$(echo $B | jq '.width>=1919 and .height>=1079 and .x==0 and .y==0')" = true ] && ok "P3c 演示层盖住整块屏 ($B)" || bad "P3c 演示层范围" "$B"
xdotool mousemove 500 400; sleep 0.4
chk "P4 光圈跟随鼠标 (500,400)" "$(LAYER | jq -r '.halo')" 'translate3d(472px, 372px, 0px)'
xdotool mousemove 800 300; sleep 0.4; shot /tmp/p_halo.png
A=$(pix /tmp/p_nohalo.png 815 300); Bp=$(pix /tmp/p_halo.png 815 300)
D=$(dist "$A" "$Bp"); RB=$(echo "$Bp" | awk -F, '{print ($1-$3)-0}'); RA=$(echo "$A" | awk -F, '{print ($1-$3)-0}')
[ "$D" -gt 20 ] && [ "$RB" -gt "$RA" ] && ok "P5 光圈真的画在屏幕上（像素 $A → $Bp，会被录屏 / 会议共享看到）" || bad "P5 光圈像素" "$A -> $Bp d=$D"
FAR=$(dist "$(pix /tmp/p_nohalo.png 1300 800)" "$(pix /tmp/p_halo.png 1300 800)"); [ "$FAR" -lt 6 ] && ok "P5b 光圈以外的画面不受影响" || bad "P5b 远处像素被改变" "d=$FAR"
# 鼠标穿透：鼠标下面的窗口不是演示层
LID=$(winid "BillyShot Present"); UNDER=$(xdotool getmouselocation | grep -o 'window:[0-9]*' | cut -d: -f2)
[ -n "$LID" ] && [ "$(printf '0x%x' $UNDER 2>/dev/null)" != "$LID" ] && ok "P6 演示层鼠标穿透（鼠标下是其他窗口）" || bad "P6 鼠标穿透" "layer=$LID under=$UNDER"
# 点击：真实鼠标点击穿过演示层，点到下面设置窗口的「截图」导航
cmd '{"cmd":"settings","tab":"general"}' 2.5
R=$(EV evalSettings "(()=>{const r=document.querySelector('nav a[data-tab=capture]').getBoundingClientRect();return Math.round(screenX+r.left+r.width/2)+' '+Math.round(screenY+r.top+r.height/2)})()" | tr -d '"')
xdotool mousemove $R click 1; sleep 0.6
R2=$(EV evalSettings "document.querySelector('section.on').dataset.tab"); chk "P6b 点击穿过演示层，下面的窗口照常响应（点到设置页导航）" "$R2" '"capture"'
cmd '{"cmd":"evalSettings","js":"window.close()"}' 1
# ---------------------------------------------------------------- 点击波纹
xdotool mousemove 600 500; sleep 0.3; xdotool click 1; sleep 0.12
R=$(EV evalLayer "JSON.stringify(window.__present().water.map(e=>e.button+'|'+e.color+'|'+e.x+','+e.y))")
echo "$R" | grep -q 'left|#ff4d6d|600,500' && ok "P7 左键水波纹（位置、颜色正确）" || bad "P7 左键波纹" "$R"
xdotool click 3; sleep 0.12; xdotool key Escape
R=$(EV evalLayer "JSON.stringify(window.__present().water.map(e=>e.button+'|'+e.color))")
echo "$R" | grep -q 'right|#3d8bff' && ok "P7b 右键波纹换颜色" || bad "P7b 右键波纹" "$R"
sleep 2.2; R=$(EV evalLayer "(document.querySelectorAll('.rip').length+window.__present().water.length)"); chk "P7c 波纹动画结束后自动清掉" "$R" "0"
for i in $(seq 1 20); do xdotool click 1; done; sleep 0.05
R=$(EV evalLayer "window.__present().water.length"); [ "${R:-99}" -le 12 ] && ok "P7d 连点 20 下最多同时 12 个波纹 ($R)" || bad "P7d 波纹数量上限" "$R"
sleep 0.8
xdotool mousemove 700 600 mousedown 1 mousemove 760 640 mousemove 820 660; sleep 0.3
chk "P8 按住拖动时光圈也跟着走" "$(LAYER | jq -r '.halo')" 'translate3d(792px, 632px, 0px)'
xdotool mouseup 1; sleep 0.3

# ---------------------------------------------------------------- 聚光灯
xdotool mousemove 960 540; sleep 0.3; shot /tmp/p_nospot.png
cmd '{"cmd":"present","action":"spot","on":true}' 1
xdotool mousemove 960 541; sleep 0.4; shot /tmp/p_spot.png
chk "P9 聚光灯打开" "$(LAYER | jq -c '[.spot,.dimAll]')" '[true,false]'
L1=$(lum "$(pix /tmp/p_nospot.png 200 900)"); L2=$(lum "$(pix /tmp/p_spot.png 200 900)")
[ "$L2" -lt $((L1*6/10)) ] && ok "P9b 聚光灯：远处变暗 ($L1 → $L2)" || bad "P9b 远处变暗" "$L1 -> $L2"
N1=$(lum "$(pix /tmp/p_nospot.png 1050 540)"); N2=$(lum "$(pix /tmp/p_spot.png 1050 540)")
[ $((N1-N2)) -lt 25 ] && ok "P9c 聚光灯：鼠标附近保持明亮 ($N1 → $N2)" || bad "P9c 亮圈" "$N1 -> $N2"
cmd '{"cmd":"present","action":"demo","on":false}' 1
chk "P10 只开聚光灯：演示层还在，光圈隐藏" "$(PJ '[(.layers|length),.demo,.spot]')|$(LAYER | jq -c '[.halo,.spot,.cfg.clicks]')" '[1,false,true]|[null,true,false]'
cmd '{"cmd":"present","action":"spot","on":false}' 1
chk "P10b 全部关闭后演示层销毁、钩子和定时器停掉" "$(PJ '[(.layers|length),.hookOn,.timer]')" '[0,false,false]'

# ---------------------------------------------------------------- 截图时隐藏
cmd '{"cmd":"present","action":"demo","on":true}' 1.2
xdotool mousemove 800 300; sleep 0.4
cmd '{"cmd":"captureFull"}' 2; cmd '{"cmd":"clipboard"}' 1
C=$(pix /tmp/billyshot-clip.png 815 300); A=$(pix /tmp/p_nohalo.png 815 300)
[ "$(dist "$C" "$A")" -lt 12 ] && ok "P11 全屏截图里没有光圈 ($C)" || bad "P11 全屏截图里有光圈" "clip=$C nohalo=$A"
chk "P11b 截完光圈恢复显示" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[true,false]'
cmd '{"cmd":"capture"}' 2
chk "P12 框选截图时演示层隐藏" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[false,true]'
R=$(EV eval "JSON.stringify(S.windows.filter(w=>/Present/.test(w.title)).length)"); chk "P12b 截图的窗口识别不包含演示层" "$R" '"0"'
xdotool key Escape; sleep 0.8
chk "P12c 退出截图后演示层恢复" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[true,false]'
# 截图过程中出错也要恢复（快速开关两次）
cmd '{"cmd":"capture"}' 0.3; cmd '{"cmd":"capture"}' 1.8; xdotool key Escape; sleep 0.8
chk "P12d 连按两次截图后演示层仍然恢复" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[true,false]'

# 截图过程中的点击不产生波纹（不会在恢复时一起冒出来）
cmd '{"cmd":"capture"}' 2; xdotool mousemove 400 300 click 1; sleep 0.1
R=$(EV evalLayer "(document.querySelectorAll('.rip').length+window.__present().water.length)"); xdotool key Escape; sleep 0.8
chk "R13 截图过程中的点击不在演示层上产生波纹" "$R" '0'
# 截图层崩溃时演示层也要恢复
cmd '{"cmd":"capture"}' 2; chk "R6a 截图中演示层隐藏" "$(PJ '.hiddenForCapture')" 'true'
cmd '{"cmd":"crashOverlay"}' 2
chk "R6 截图层意外崩溃后演示层恢复显示" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[true,false]'
cmd '{"cmd":"capture"}' 2.5; xdotool key Escape; sleep 0.8
chk "R6b 崩溃后还能正常截图，退出后演示层仍在" "$(PJ '[.layers[0].visible,.hiddenForCapture]')" '[true,false]'
# ---------------------------------------------------------------- 设置页
cmd '{"cmd":"settings","tab":"present"}' 2.5
R=$(EV evalSettings "document.querySelector('section.on').dataset.tab"); chk "P13 设置页「演示」标签" "$R" '"present"'
R=$(EV evalSettings "(()=>{const b=[...document.querySelectorAll('[data-color=\"present.haloColor\"] .swatch')].find(x=>x.dataset.c==='#4dabf7');b.click();return 1})()"); sleep 0.8
chk "P13b 改光圈颜色立刻生效到演示层" "$(LAYER | jq -r '.cfg.haloColor')" '#4dabf7'
R=$(EV evalSettings "(()=>{const r=document.querySelector('[data-k=\"present.haloSize\"]');r.value='80';r.dispatchEvent(new Event('input'));return 1})()"); sleep 0.8
xdotool mousemove 500 400; sleep 0.4
chk "P13c 改光圈大小立刻生效（位置按新大小居中）" "$(LAYER | jq -c '[.cfg.haloSize,.halo]')" '[80,"translate3d(460px, 360px, 0px)"]'
R=$(EV evalSettings "(()=>{const c=document.querySelector('[data-k=\"present.clicks\"]');c.checked=false;c.dispatchEvent(new Event('change'));return 1})()"); sleep 0.8
chk "P13d 关掉点击波纹：层收到配置、鼠标钩子停掉" "$(LAYER | jq -c '.cfg.clicks')|$(PJ '.hookOn')" 'false|false'
R=$(EV evalSettings "(()=>{const c=document.querySelector('[data-k=\"present.clicks\"]');c.checked=true;c.dispatchEvent(new Event('change'));return 1})()"); sleep 0.6
R=$(EV evalSettings "document.getElementById('spotToggle').click();1"); sleep 1
chk "P13e 设置页按钮打开聚光灯，按钮文字跟着变" "$(PJ '.spot')|$(EV evalSettings "document.getElementById('spotToggle').textContent")" 'true|"关闭聚光灯"'
R=$(EV evalSettings "document.getElementById('spotToggle').click();1"); sleep 0.8
R=$(EV evalSettings "document.querySelectorAll('#hkTable tbody tr').length"); chk "P14 快捷键页多了两行（共 7 行）" "$R" '7'
R=$(EV evalSettings "[...document.querySelectorAll('#hkTable tbody tr')].slice(5).map(r=>r.cells[0].textContent+'='+r.querySelector('input').value).join(';')")
echo "$R" | grep -q '演示模式.*Alt + Shift + H' && echo "$R" | grep -q '聚光灯.*Alt + Shift + L' && ok "P14b 快捷键页显示演示模式 / 聚光灯默认键" || bad "P14b 快捷键显示" "$R"
R=$(EV evalSettings "JSON.stringify([...document.querySelectorAll('#camSel option')].map(o=>o.textContent))"); echo "$R" | grep -qi 'fake' && ok "P14c 摄像头设备列表能列出摄像头 ($R)" || bad "P14c 摄像头列表" "$R"
R=$(EV evalSettings "(()=>{const s=document.querySelector('section.on');return s.scrollWidth<=s.clientWidth+1})()"); chk "P14d 演示页没有横向溢出" "$R" 'true'
import -window root /tmp/p_settings.png 2>/dev/null
cmd '{"cmd":"evalSettings","js":"window.close()"}' 1

# ---------------------------------------------------------------- 托盘 / 快捷键
cmd '{"cmd":"trayMenu"}' 0.6; TM=$(grep '^TRAYMENU' /tmp/app.log | tail -1 | sed 's/^TRAYMENU //')
chk "P15 托盘顶层恰 7 行" "$(echo "$TM" | jq -c '[.[]|select(.path|test("/")|not)|.label]')" '["截图","录制区域","录制全屏","演示","文件","设置…","退出"]'
chk "P15a 演示子菜单：光晕开 / 水波纹开 / 聚光灯关 / 摄像头泡关" "$(echo "$TM" | jq -c '[.[]|select(.label|test("光晕|水波纹|聚光灯|摄像头泡"))|.checked]')" '[true,true,false,false]'
cmd '{"cmd":"trayItem","label":"光晕","checked":false}' 0.4
cmd '{"cmd":"trayItem","label":"水波纹","checked":false}' 0.8
chk "P15b 托盘关掉光晕+水波纹 → 演示层收起" "$(PJ '[.demo,(.layers|length)]')" '[false,0]'
xdotool key alt+shift+h; sleep 1
chk "P16 快捷键 Alt+Shift+H 打开演示模式" "$(PJ '[.demo,(.layers|length)]')" '[true,1]'
xdotool key alt+shift+l; sleep 0.8; chk "P16b 快捷键 Alt+Shift+L 打开聚光灯" "$(PJ '.spot')" 'true'
xdotool key alt+shift+l; sleep 0.6; xdotool key alt+shift+h; sleep 0.8
chk "P16c 再按一次都关闭" "$(PJ '[.demo,.spot,(.layers|length)]')" '[false,false,0]'

# ---------------------------------------------------------------- 录屏时自动显示 + 控制条开关
cmd '{"cmd":"recordFull"}' 1.8
chk "P17 录屏时自动显示光圈 / 波纹（withRecord）" "$(PJ '[.rec,(.layers|length),.recFx]')" "[true,1,true]"
R=$(EV evalBar "[...document.querySelectorAll('.fxb')].map(b=>b.id+':'+b.classList.contains('on')).join(',')"); chk "P17b 控制条按钮状态（光圈开、聚光灯关、摄像头关）" "$R" '"fx:true,spot:false,cam:false"'
cmd '{"cmd":"recAction","action":"fx-off"}' 0.8; chk "P18 控制条关掉鼠标效果 → 演示层收起" "$(PJ '(.layers|length)')" '0'
cmd '{"cmd":"recAction","action":"fx-on"}' 0.8; chk "P18b 再打开 → 演示层回来" "$(PJ '(.layers|length)')" '1'
cmd '{"cmd":"status"}' 0.5; BP=$(grep '^STATUS' /tmp/app.log | tail -1 | sed 's/^STATUS //' | jq -c '.barPos'); BX=$(echo $BP | jq '.x+8'); BY=$(echo $BP | jq '.y+23')
xdotool mousemove 960 300; sleep 0.3; shot /tmp/p_bar1.png
cmd '{"cmd":"recAction","action":"spot-on"}' 0.8; chk "P18c 控制条打开聚光灯" "$(PJ '.spot')|$(EV evalBar "document.getElementById('spot').classList.contains('on')")" 'true|true'
sleep 0.5; shot /tmp/p_bar2.png
D=$(dist "$(pix /tmp/p_bar1.png $BX $BY)" "$(pix /tmp/p_bar2.png $BX $BY)"); [ "$D" -lt 30 ] && ok "P18d 聚光灯不会把控制条压暗（控制条在演示层上面）" || bad "P18d 控制条被压暗" "d=$D at $BX,$BY"
cmd '{"cmd":"stop"}' 3
chk "P19 录完：演示层收起，录制中开的聚光灯也自动关掉" "$(PJ '[(.layers|length),.spot,.demo]')" '[0,false,false]'
F=$(newest "$VD/*.mp4"); D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$F" 2>/dev/null); awk "BEGIN{exit !($D>1.0)}" && ok "P19b 录出的文件正常 ($D s)" || bad "P19b 录出的文件" "$F $D"
cmd '{"cmd":"present","action":"spot","on":true}' 0.6; cmd '{"cmd":"recordFull"}' 1.5; cmd '{"cmd":"stop"}' 3
chk "P19c 录前就开着的聚光灯，录完保持" "$(PJ '.spot')" 'true'
cmd '{"cmd":"present","action":"spot","on":false}' 0.6
cmd '{"cmd":"setSettings","patch":{"present":{"withRecord":false}}}' 0.5
cmd '{"cmd":"recordFull"}' 1.5; chk "P20 关掉「录屏时自动显示」→ 录屏不出演示层" "$(PJ '(.layers|length)')" '0'
cmd '{"cmd":"stop"}' 3
cmd '{"cmd":"setSettings","patch":{"present":{"withRecord":true}}}' 0.5

# ---------------------------------------------------------------- 录像里有光圈
xdotool mousemove 700 450; sleep 0.3
cmd '{"cmd":"captureRecord"}' 2; sel 301 221 1201 781; xdotool key Return; sleep 1.5
xdotool mousemove 701 451; sleep 0.3; xdotool mousemove 700 450; sleep 1.2; cmd '{"cmd":"stop"}' 3
F=$(newest "$VD/*.mp4"); ffmpeg -v error -y -sseof -0.4 -i "$F" -frames:v 1 /tmp/p_frame.png
A=$(pix /tmp/p_nohalo.png 715 450); Bf=$(pix /tmp/p_frame.png $((715-301)) $((450-221)))
[ "$(dist "$A" "$Bf")" -gt 15 ] && ok "P21 录出的视频里有光圈（$A → $Bf）" || bad "P21 视频里的光圈" "screen=$A frame=$Bf"

# ---------------------------------------------------------------- 摄像头（区域录屏）
cmd '{"cmd":"captureRecord"}' 2; sel 301 221 1201 781
R=$(EV eval "document.getElementById('togCam').className"); chk "P22 录屏工具栏有「摄像头」开关（默认关）" "$R" '"tog"'
R=$(EV eval "(()=>{const t=document.getElementById('toolbar').getBoundingClientRect();return t.right<=innerWidth&&t.left>=0})()"); chk "P22b 加了摄像头开关后工具栏不超出屏幕" "$R" 'true'
EV eval "document.getElementById('togCam').click();1" >/dev/null
R=$(EV eval "document.getElementById('togCam').className"); chk "P22c 点一下打开" "$R" '"tog on"'
xdotool key Return; sleep 3
CS=$(PJ '.cam'); CB=$(echo "$CS" | jq -c '.bounds')
chk "P23 摄像头圆窗出现并出画" "$(echo "$CS" | jq -c '[.owner,.state,.visible]')" '["record","ok",true]'
[ "$(echo "$CB" | jq '.x+.width==1201-20 and .y+.height==781-20 and .width==240')" = true ] && ok "P23b 默认在录制区域右下角内侧 ($CB)" || bad "P23b 圆窗位置" "$CB"
jq -e '.present.camera==true' ~/.config/BillyShot/settings.json >/dev/null && ok "P23c 工具栏的摄像头开关记住了" || bad "P23c 记住摄像头开关" "$(jq -c .present ~/.config/BillyShot/settings.json)"
R=$(EV evalCam "JSON.stringify(window.__cam())"); echo "$R" | grep -q '\\"ok\\":true' && echo "$R" | grep -q '\\"live\\":true' && ok "P23d 圆窗里有摄像头画面 ($(echo $R | head -c 60))" || bad "P23d 摄像头画面" "$R"
cmd '{"cmd":"trayMenu"}' 0.6; TM=$(grep '^TRAYMENU' /tmp/app.log | tail -1 | sed 's/^TRAYMENU //')
chk "R8 录屏打开的摄像头，托盘「摄像头泡」也显示已勾选" "$(echo "$TM" | jq -c '[.[]|select(.label=="摄像头泡")|.checked]')" '[true]'
# 拖动
CX=$(echo "$CB" | jq '.x+120'); CY=$(echo "$CB" | jq '.y+60')
xdotool mousemove $CX $CY mousedown 1 mousemove $((CX-100)) $((CY-80)) mousemove $((CX-200)) $((CY-160)) mousemove $((CX-300)) $((CY-200)) mouseup 1; sleep 0.8
NB=$(PJ '.cam.bounds'); DX=$(( $(echo "$NB" | jq .x) - $(echo "$CB" | jq .x) )); DY=$(( $(echo "$NB" | jq .y) - $(echo "$CB" | jq .y) ))
[ "$DX" = -300 ] && [ "$DY" = -200 ] && ok "P24 拖动圆窗 (-300,-200)" || bad "P24 拖动圆窗" "dx=$DX dy=$DY $NB"
jq -e '.present.cameraPos.cx>0 and .present.cameraPos.cy>0' ~/.config/BillyShot/settings.json >/dev/null && ok "P24b 拖动后位置记住了 ($(jq -c .present.cameraPos ~/.config/BillyShot/settings.json))" || bad "P24b 记住位置" "$(jq -c .present.cameraPos ~/.config/BillyShot/settings.json)"
chk "P24c 还在录制区域内：不提示" "$(PJ '.cam.outside')" 'false'
CX=$(echo "$NB" | jq '.x+120'); CY=$(echo "$NB" | jq '.y+60')
xdotool mousemove $CX $CY mousedown 1 mousemove $((CX-200)) $CY mousemove $((CX-500)) $CY mouseup 1; sleep 0.8
chk "P24d 拖出录制区域：边框变橙色并提示" "$(PJ '.cam.outside')|$(EV evalCam "document.body.classList.contains('outside')")" 'true|true'
NB2=$(PJ '.cam.bounds'); CX=$(echo "$NB2" | jq '.x+120'); CY=$(echo "$NB2" | jq '.y+60')
xdotool mousemove $CX $CY mousedown 1 mousemove $((CX+250)) $CY mousemove $((CX+500)) $CY mouseup 1; sleep 0.8
chk "P24e 拖回区域内：提示消失" "$(PJ '.cam.outside')" 'false'
SAVED=$(PJ '.cam.bounds')
# 控制条开关摄像头
cmd '{"cmd":"recAction","action":"cam-off"}' 1
chk "P25 录制中关摄像头：圆窗关闭，录制继续" "$(PJ '[.cam,.rec]')|$(EV evalBar "document.getElementById('cam').classList.contains('on')")" '[null,true]|false'
cmd '{"cmd":"recAction","action":"cam-on"}' 3
near() { echo "$1" | jq --argjson b "$2" '(.x-$b.x|fabs)<=2 and (.y-$b.y|fabs)<=2 and .width==$b.width and .height==$b.height'; }
chk "P25b 再打开：圆窗回到记住的位置" "$(PJ '.cam.state')|$(near "$(PJ '.cam.bounds')" "$SAVED")" '"ok"|true'
# 悬停按钮：大小 / 形状
R=$(EV evalCam "document.getElementById('bSize').click();1"); sleep 0.6
chk "P26 圆窗「大小」按钮：中 → 大" "$(PJ '[.cam.bounds.width,.cam.bounds.height]')|$(jq -r .present.cameraSize ~/.config/BillyShot/settings.json)" '[340,340]|l'
R=$(EV evalCam "document.getElementById('bShape').click();1"); sleep 0.6
chk "P26b 圆窗「形状」按钮：圆形 → 圆角方形 4:3" "$(PJ '[.cam.bounds.width,.cam.bounds.height]')|$(EV evalCam "document.body.classList.contains('rounded')")" '[453,340]|true'
R=$(EV evalCam "document.getElementById('bShape').click();document.getElementById('bSize').click();1"); sleep 0.6
chk "P26c 再点：圆形、小" "$(PJ '[.cam.bounds.width,.cam.bounds.height]')" '[160,160]'
R=$(EV evalCam "document.getElementById('bSize').click();1"); sleep 0.5
xdotool mousemove 700 450; sleep 1; cmd '{"cmd":"stop"}' 3
chk "P27 录完圆窗自动关闭" "$(PJ '.cam')" 'null'
F=$(newest "$VD/*.mp4"); ffmpeg -v error -y -sseof -0.4 -i "$F" -frames:v 1 /tmp/p_camframe.png
CB=$(echo "$SAVED" | jq -c '.'); FX=$(( $(echo "$CB" | jq '.x+.width/2|floor') - 301 )); FY=$(( $(echo "$CB" | jq '.y+.height/2|floor') - 221 + 40 ))
G=$(pix /tmp/p_camframe.png $FX $FY); echo "$G" | awk -F, '{exit !($2>100 && $2>$1+40 && $2>$3+40)}' && ok "P27b 录出的视频里有摄像头画面（$G）" || bad "P27b 视频里的摄像头" "pix@$FX,$FY=$G"
# 下次录制回到记住的位置
cmd '{"cmd":"captureRecord"}' 2; sel 301 221 1201 781; xdotool key Return; sleep 3
chk "P28 下次录制：圆窗在记住的位置" "$(near "$(PJ '.cam.bounds')" "$SAVED")" 'true'
cmd '{"cmd":"stop"}' 3

# 摄像头被占用
cmd '{"cmd":"present","action":"camFail","name":"NotReadableError"}' 0.5
cmd '{"cmd":"recordFull"}' 3
chk "P29 摄像头被占用：控制条提示原因，录制照常" "$(PJ '[.rec,(.extraWarn|join(""))]')" '[true,"摄像头正被其他程序使用（例如 Zoom / Teams / 微信）"]'
R=$(EV evalBar "document.getElementById('meta').textContent"); echo "$R" | grep -q '摄像头正被其他程序使用' && ok "P29b 控制条显示 ⚠ 提示" || bad "P29b 控制条提示" "$R"
sleep 1; chk "P29c 出错的圆窗自动关闭" "$(PJ '.cam')" 'null'
sleep 1; cmd '{"cmd":"stop"}' 3
F=$(newest "$VD/*.mp4"); D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$F" 2>/dev/null); awk "BEGIN{exit !($D>2.0)}" && ok "P29d 文件正常 ($D s)" || bad "P29d 文件" "$D"
cmd '{"cmd":"present","action":"camFail","name":""}' 0.5
# 极小 / 小区域
cmd '{"cmd":"captureRecord"}' 2; sel 400 300 550 420; xdotool key Return; sleep 2
chk "P30 区域太小：不显示摄像头，控制条提示" "$(PJ '[.cam,(.extraWarn|join(""))]')" '[null,"区域太小，未显示摄像头"]'
cmd '{"cmd":"stop"}' 3
cmd '{"cmd":"captureRecord"}' 2; sel 400 300 680 520; xdotool key Return; sleep 3
B=$(PJ '.cam.bounds'); [ "$(echo $B | jq '.width<=180 and .width>=96 and .x+.width<=660 and .y+.height<=500')" = true ] && ok "P30b 小区域：圆窗自动缩小放得下 ($B)" || bad "P30b 小区域缩小" "$B"
cmd '{"cmd":"stop"}' 3
# 全屏录屏：放在任务栏以上（工作区内）
cmd '{"cmd":"setSettings","patch":{"present":{"cameraPos":{"cx":0.995,"cy":0.995}}}}' 0.4
cmd '{"cmd":"recordFull"}' 3
B=$(PJ '.cam.bounds'); [ "$(echo $B | jq '.x+.width==1920-20 and .y+.height<=1080-20')" = true ] && ok "P31 全屏录屏：摄像头按设置显示；记住的位置放不下时回到右下角 ($B)" || bad "P31 全屏录屏摄像头" "$B"
cmd '{"cmd":"stop"}' 3
# GIF + 摄像头
cmd '{"cmd":"captureRecord"}' 2; sel 301 221 1201 781
EV eval "document.querySelector('.seg button[data-fmt=gif]').click();1" >/dev/null
R=$(EV eval "document.getElementById('togCam').className+'|'+document.getElementById('togCam').disabled"); chk "P32 GIF 也能开摄像头" "$R" '"tog on|false"'
xdotool key Return; sleep 3; xdotool mousemove 600 400; sleep 0.5; cmd '{"cmd":"stop"}' 6
F=$(newest "$VD/*.gif"); NF=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$F" 2>/dev/null)
[ "${NF:-0}" -gt 3 ] && [ "$(PJ '.cam')" = null ] && ok "P32b GIF + 摄像头录制正常 ($NF 帧)" || bad "P32b GIF+摄像头" "frames=$NF cam=$(PJ .cam)"
cmd '{"cmd":"setSettings","patch":{"record":{"regionFormat":"mp4"}}}' 0.4

# ---------------------------------------------------------------- 手动打开的摄像头（画中画）
cmd '{"cmd":"trayItem","label":"摄像头泡","checked":true}' 3
chk "P33 托盘打开摄像头泡（不录屏）" "$(PJ '[.cam.owner,.cam.state]')" '["manual","ok"]'
cmd '{"cmd":"captureRecord"}' 2; sel 301 221 1201 781; xdotool key Return; sleep 2.5
chk "P33b 录屏时沿用已打开的圆窗" "$(PJ '.cam.owner')" '"manual+record"'
cmd '{"cmd":"stop"}' 3
chk "P33c 录完手动打开的圆窗保留" "$(PJ '[.cam.owner,.cam.state]')" '["manual","ok"]'
R=$(EV evalCam "document.getElementById('bClose').click();1"); sleep 0.8
chk "P33d 圆窗上的关闭按钮" "$(PJ '.cam')" 'null'
cmd '{"cmd":"present","action":"camFail","name":"NotFoundError"}' 0.4
cmd '{"cmd":"present","action":"cam","on":true}' 2.5
grep -q "NOTIFY 摄像头打不开 | 没有找到摄像头" /tmp/app.log && ok "P33e 手动打开但没有摄像头：通知原因" || bad "P33e 没有摄像头的通知" "$(grep NOTIFY /tmp/app.log | tail -2)"
cmd '{"cmd":"present","action":"camFail","name":""}' 0.4
sleep 1; chk "P33f 出错的圆窗自动关闭" "$(PJ '.cam')" 'null'

# 演示模式开着时录屏：控制条「鼠标效果」按钮显示开，点关 = 同时关掉演示模式
cmd '{"cmd":"present","action":"demo","on":true}' 1
cmd '{"cmd":"recordFull"}' 2
chk "R2 演示模式开着录屏：控制条鼠标效果按钮显示「开」" "$(EV evalBar "document.getElementById('fx').classList.contains('on')")" 'true'
cmd '{"cmd":"recAction","action":"fx-off"}' 1
chk "R2b 点关：光圈真的消失（演示模式一起关）" "$(PJ '[(.layers|length),.demo,.recFx]')" '[0,false,false]'
cmd '{"cmd":"stop"}' 3
# 设置页：演示模式自动开启光圈后，打开着的设置页开关跟着变；预览按钮文字正确
cmd '{"cmd":"setSettings","patch":{"present":{"halo":false,"clicks":false}}}' 0.5
cmd '{"cmd":"settings","tab":"present"}' 2.5
cmd '{"cmd":"present","action":"demo","on":true}' 1.5
chk "R11 自动开启光圈 / 波纹后，打开着的设置页开关同步" "$(EV evalSettings "[document.querySelector('[data-k=\"present.halo\"]').checked,document.querySelector('[data-k=\"present.clicks\"]').checked].join()")" '"true,true"'
cmd '{"cmd":"present","action":"demo","on":false}' 0.8
EV evalSettings "document.getElementById('camPreview').click();1" >/dev/null; sleep 2.5
chk "R4 设置页「打开摄像头」后按钮变成「关闭摄像头」" "$(PJ '.cam.owner')|$(EV evalSettings "document.getElementById('camPreview').textContent")" '"manual"|"关闭摄像头"'
EV evalSettings "document.getElementById('camPreview').click();1" >/dev/null; sleep 1
chk "R4b 再点关闭：摄像头关掉，按钮变回「打开摄像头」" "$(PJ '.cam')|$(EV evalSettings "document.getElementById('camPreview').textContent")" 'null|"打开摄像头"'
cmd '{"cmd":"evalSettings","js":"window.close()"}' 1
# 第二轮审查修复
# 停止 GIF 时（编码中）光圈 / 聚光灯 / 摄像头马上收起
cmd '{"cmd":"setSettings","patch":{"record":{"format":"gif","gifMaxWidth":1920,"gifFps":20},"present":{"camera":true}}}' 0.5
cmd '{"cmd":"recordFull"}' 3.5; cmd '{"cmd":"recAction","action":"spot-on"}' 0.8
for i in $(seq 1 16); do xdotool mousemove $((400+i*50)) $((300+i*30)); sleep 0.3; done
cmd '{"cmd":"stop"}' 0.4
chk "V2 停止后光圈 / 聚光灯 / 摄像头马上收起" "$(PJ '[(.layers|length),.spot,.cam]')" '[0,false,null]'
for i in $(seq 1 40); do sleep 0.5; [ "$(PJ '.rec')" = false ] && break; done
F=$(newest "$VD/*.gif"); [ -n "$F" ] && ok "V2b GIF 照常生成" || bad "V2b GIF" "none"
cmd '{"cmd":"setSettings","patch":{"record":{"format":"mp4","gifMaxWidth":960,"gifFps":12}}}' 0.5
# 聚光灯：录前开着、录制中关了又开 → 录完保持
cmd '{"cmd":"setSettings","patch":{"present":{"camera":false}}}' 0.4
cmd '{"cmd":"present","action":"spot","on":true}' 0.6; cmd '{"cmd":"recordFull"}' 1.5
cmd '{"cmd":"recAction","action":"spot-off"}' 0.6; cmd '{"cmd":"recAction","action":"spot-on"}' 0.6; cmd '{"cmd":"stop"}' 3
chk "V9 录前开着的聚光灯，录制中关了又开，录完仍保持" "$(PJ '.spot')" 'true'
cmd '{"cmd":"present","action":"spot","on":false}' 0.6
# 一直没有画面的摄像头：先开始录制，稍后关掉并提示
cmd '{"cmd":"setSettings","patch":{"present":{"camera":true}}}' 0.4
cmd '{"cmd":"present","action":"camFail","name":"Hang"}' 0.4
cmd '{"cmd":"recordFull"}' 3.2
chk "V7 摄像头没画面：2.5 秒后先开始录制，圆窗不显示" "$(PJ '[.rec,.cam.state,.cam.visible]')" '[true,"loading",false]'
sleep 3.5
chk "V7b 一直没画面：关掉摄像头并在控制条提示" "$(PJ '[.cam,(.extraWarn|join(""))]')" '[null,"摄像头没有画面"]'
cmd '{"cmd":"stop"}' 3
cmd '{"cmd":"setSettings","patch":{"present":{"camera":false}}}' 0.4
# 打开失败的手动圆窗：改设置不会反复重试
cmd '{"cmd":"present","action":"camFail","name":"NotReadableError"}' 0.4
N0=$(grep -c "camera error" /tmp/app.log)
cmd '{"cmd":"present","action":"cam","on":true}' 0.8
cmd '{"cmd":"setSettings","patch":{"present":{"cameraMirror":false}}}' 0.2; cmd '{"cmd":"evalSettings","js":"1"}' 0.1
EV evalCam "1" >/dev/null
N1=$(grep -c "camera error" /tmp/app.log)
cmd '{"cmd":"setSettings","patch":{"present":{"cameraMirror":true}}}' 0.3
sleep 2; N2=$(grep -c "camera error" /tmp/app.log)
[ $((N2-N0)) -le 2 ] && ok "V4 打开失败后改设置不会反复重试 ($((N2-N0)) 条错误日志)" || bad "V4 反复重试" "$((N2-N0))"
cmd '{"cmd":"present","action":"camFail","name":""}' 0.4
# 手动打开但一直没画面：提示并关掉
cmd '{"cmd":"present","action":"camFail","name":"Hang"}' 0.4
cmd '{"cmd":"present","action":"cam","on":true}' 1.5
chk "V10 手动打开的摄像头一直没画面：先显示「启动中」" "$(PJ '[.cam.owner,.cam.state,.cam.visible]')" '["manual","loading",true]'
sleep 4
chk "V10b 一直没画面：自动关掉并通知" "$(PJ '.cam')|$(grep -c 'NOTIFY 摄像头打不开 | 摄像头没有画面' /tmp/app.log)" 'null|1'
cmd '{"cmd":"present","action":"camFail","name":""}' 0.4
# 录制中换摄像头：圆窗先藏起来，出画后再显示
cmd '{"cmd":"setSettings","patch":{"present":{"camera":true,"cameraDeviceId":""}}}' 0.4
cmd '{"cmd":"recordFull"}' 3
DEV=$(EV evalCam "navigator.mediaDevices.enumerateDevices().then(d=>d.filter(x=>x.kind==='videoinput')[0].deviceId)" | tr -d '"')
cmd "{\"cmd\":\"setSettings\",\"patch\":{\"present\":{\"cameraDeviceId\":\"$DEV\"}}}" 0.15
sleep 2.5
R1=$(grep -c 'camera reopening record' /tmp/app.log)
chk "V11 录制中换摄像头：先藏起圆窗重新打开，出画后再显示" "$R1|$(PJ '[.cam.state,.cam.visible]')" '1|["ok",true]'
cmd '{"cmd":"stop"}' 3
cmd '{"cmd":"setSettings","patch":{"present":{"camera":false,"cameraDeviceId":""}}}' 0.4
# 旧的「没画面」计时不会误关后来换过设备的摄像头
cmd '{"cmd":"present","action":"cam","on":true}' 0.2; T0=$(date +%s.%N)
DEV=$(EV evalCam "navigator.mediaDevices.enumerateDevices().then(d=>d.filter(x=>x.kind==='videoinput')[0].deviceId)" | tr -d '"')
while awk "BEGIN{exit !($(date +%s.%N)-$T0 < 3.3)}"; do sleep 0.1; done
cmd '{"cmd":"present","action":"camFail","name":"Hang"}' 0.3
cmd "{\"cmd\":\"setSettings\",\"patch\":{\"present\":{\"cameraDeviceId\":\"$DEV\"}}}" 0.1
sleep 1.2
chk "V12 换设备后重新计时：创建时的「没画面」计时不会提前关掉正在换的摄像头" "$(PJ '[.cam.owner,.cam.state]')" '["manual","loading"]'
sleep 3.5
chk "V12b 换的摄像头一直没画面：从换的时候算起到时间才关掉" "$(PJ '.cam')" 'null'
cmd '{"cmd":"present","action":"camFail","name":""}' 0.3
cmd '{"cmd":"present","action":"cam","on":false}' 0.5
cmd '{"cmd":"setSettings","patch":{"present":{"cameraDeviceId":""}}}' 0.4
# ---------------------------------------------------------------- 收尾
# 1.3.2：录完会留一个「已保存」控制条（20 秒自动收起）；先点 × 关掉再数窗口
EV evalBar "(document.getElementById('dClose')&&document.getElementById('dClose').click(),1)" >/dev/null; sleep 0.6
cmd '{"cmd":"windows"}' 0.6; W1=$(grep WINDOWS /tmp/app.log | tail -1 | awk '{print $2}')
chk "P34 全部关闭后没有残留窗口" "$W1" "$W0"
if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "P35 全程无报错" "$(grep -E 'Uncaught|REPORTED_ERROR|TEST ERR' /tmp/app.log | head -3)"; else ok "P35 全程无报错"; fi
cmd '{"cmd":"present","action":"demo","on":true}' 0.8; cmd '{"cmd":"present","action":"cam","on":true}' 2
cmd '{"cmd":"quit"}' 0.2; for i in $(seq 1 25); do sleep 0.2; kill -0 $(cat /tmp/app.pid) 2>/dev/null || break; done
kill -0 $(cat /tmp/app.pid) 2>/dev/null && { bad "P36 演示模式 + 摄像头开着时退出" "still running"; kill $(cat /tmp/app.pid); } || ok "P36 演示模式 + 摄像头开着时能正常退出"

echo "=========================="
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL"
