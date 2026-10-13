#!/bin/bash
# 1.3.3 点击水波纹测试（WebGL 水面高光 / 阴影），以及「单圈（旧样式）」选项
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want=$3 got=$2"; fi; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "$(jq -cn --arg c "$c" --arg js "$js" '{cmd:$c,js:$js}')" 0.7; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
LAYER() { EV evalLayer "JSON.stringify(window.__present())" | jq -r '.' 2>/dev/null; }
style() { cmd "{\"cmd\":\"setSettings\",\"patch\":{\"present\":{\"rippleStyle\":\"$1\"}}}" 0.8; }
an() { python3 test/ripple_an.py "$@"; }
val() { echo "$1" | grep -o "$2=[-0-9]*" | cut -d= -f2; }
SEL='select[data-k="present.rippleStyle"]'
VD=~/Videos/BillyShot
fresh() {
  rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot $VD; rm -f $VD/*
  cat > ~/.config/BillyShot/settings.json <<J
{"general":{"firstRun":false,"language":"${1:-zh}"},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4"},"sound":{"record":false,"countdown":false}${2:+,$2}}
J
}
# 灰色桌面（#808080），去掉背景图窗口：高光（变亮）和阴影（变暗）都量得出来；左键点桌面不会弹菜单
gray_x() { start_x; pkill -x display 2>/dev/null; xsetroot -solid '#808080'; sleep 0.5; }
# 关掉 app，等进程真的退出（单实例锁），避免下一次启动连到旧进程
stop_app() { cmd '{"cmd":"quit"}' 1; [ -f /tmp/app.pid ] && kill $(cat /tmp/app.pid) 2>/dev/null; for i in $(seq 1 20); do pgrep -x electron >/dev/null || break; sleep 0.3; done; pkill -9 -x electron 2>/dev/null; rm -f /tmp/billyshot-cmd.json; sleep 0.5; }
# 桌面换成条纹（xcompmgr 要重启才会换背景）
stripes_root() { pkill xcompmgr; sleep 0.3; hsetroot -tile test/stripes.png >/dev/null 2>&1; xcompmgr >/tmp/xcompmgr.log 2>&1 & sleep 0.8; }
gray_root() { pkill xcompmgr; sleep 0.3; hsetroot -solid '#808080' >/dev/null 2>&1; xcompmgr >/tmp/xcompmgr.log 2>&1 & sleep 0.8; }

rm -f /tmp/billyshot-cmd.json
# ================================================================ A 老用户升级 → 默认水波纹
fresh zh '"present":{"halo":false,"clicks":true}'
gray_x; start_app 6
cmd '{"cmd":"present","action":"demo","on":true}' 1.5
L=$(LAYER)
chk "A1 老设置没有波纹样式 → 默认「水波纹」" "$(echo "$L" | jq -r '.cfg.rippleStyle')" 'water'
chk "A1b 还没点过时不创建 WebGL（不占显存）" "$(echo "$L" | jq -r '.waterGL')" 'false'
jq -e '.present.clicks==true and .present.halo==false' ~/.config/BillyShot/settings.json >/dev/null && ok "A1c 老用户原来的开关不变" || bad "A1c 老设置被改" "$(jq -c .present ~/.config/BillyShot/settings.json)"

xdotool mousemove 1300 800; sleep 0.3; shot /tmp/rw_base.png
R=$(an /tmp/rw_base.png 700 500 0 140); [ "$(val "$R" changed)" -lt 5 ] && ok "A2 点击前那块是平的灰底（对照）" || bad "A2 底图不干净" "$R"

# ---------------------------------------------------------------- 左键：记录、折射画面、透明、反光、颜色
xdotool mousemove 700 500 click 1; sleep 0.3
R=$(EV evalLayer "JSON.stringify(window.__present().water.map(e=>e.button+'|'+e.color+'|'+e.x+','+e.y+'|'+e.refract))" | jq -r .)
chk "A7 记录：左键、颜色、位置，并且拿到了点击处的画面（折射用）" "$R" '["left|#ff4d6d|700,500|true"]'
chk "A7b 第一次点击后才创建 WebGL" "$(LAYER | jq -r '.waterGL')" 'true'
MS=$(cmd '{"cmd":"presentStatus"}' 0.6; grep '^PSTATUS' /tmp/app.log | tail -1 | sed 's/^PSTATUS //' | jq '.lastPatchMs')
[ "${MS:-999}" -lt 150 ] && ok "A7c 抓点击处画面用了 ${MS} ms（折射随即淡入）" || bad "A7c 抓画面太慢" "$MS"
sleep 1.6
# 先连着截图，之后再分析，避免分析耗时把时间拖过
xdotool mousemove 700 500 click 1; T0=$(date +%s.%N); sleep 0.3; shot /tmp/rw_left.png; T1=$(date +%s.%N)
echo "    截图时刻: $(echo "$T1 - $T0" | bc) 秒"
R=$(an /tmp/rw_left.png 700 500 25 130); echo "    左键: $R"
[ "$(val "$R" bright)" -gt 100 ] && ok "A3 水波纹画在屏幕上：波峰有反光（$(val "$R" bright) 个亮像素）" || bad "A3 水波像素" "$R"
[ "$(val "$R" changed)" -lt 7000 ] && [ "$(val "$R" dark)" -lt 300 ] && ok "A4 是透明的：25–130px 环里大部分像素和底下一样，没有灰色底、没有深色阴影（变化 $(val "$R" changed) / 约 25000，暗 $(val "$R" dark)）" || bad "A4 透明" "$R"
[ "$(val "$R" runs)" -ge 2 ] && ok "A5 一条半径上能看到 ≥2 道波峰的反光（$(val "$R" runs) 道）" || bad "A5 多道波峰" "$R"
[ "$(val "$R" tint)" -gt 8 ] && ok "A6 左键反光偏红（R-B=$(val "$R" tint)）" || bad "A6 左键颜色" "$R"
R0=$(an /tmp/rw_left.png 700 500 170 400); [ "$(val "$R0" changed)" -lt 20 ] && ok "A8 那一刻还没扩散到 170px 外（是从点击处慢慢荡开的）" || bad "A8 扩散范围" "$R0"
sleep 1.2
# 用 x11grab 录 2.6 秒屏幕，看波纹从出现到消失的整个过程
rm -rf /tmp/rw_seq; mkdir -p /tmp/rw_seq
ffmpeg -v error -y -f x11grab -framerate 20 -video_size 1920x1080 -i :99 -t 2.6 /tmp/rw_seq/f%03d.png & FF=$!
sleep 0.5; xdotool mousemove 700 500 click 1; xdotool mousemove 1800 1000; wait $FF
python3 test/ripple_series.py /tmp/rw_seq 700 500 20 > /tmp/rw_series.txt; awk '{printf "%s:%s/%s  ", $1,$2,$3} END{print ""}' /tmp/rw_series.txt | sed 's/^/    过程(秒:像素\/平均半径): /'
SER=$(awk '$2>100 && !f {f=1; a=$3} $2>50 && $3>b {b=$3} END{print int(a), int(b)}' /tmp/rw_series.txt)
read RA RB <<< "$SER"
[ "${RB:-0}" -gt $(( ${RA:-999} + 40 )) ] && ok "A9 波纹从点击处慢慢荡开（刚出现时平均半径 ${RA}px → 最远 ${RB}px）" || bad "A9 往外扩散" "$SER"
END=$(awk '$1>=1.75{print $2}' /tmp/rw_series.txt | tail -1); [ "${END:-99}" -lt 10 ] && ok "A9b 1.75 秒后完全消失" || bad "A9b 消失" "end=$END"
sleep 1.0; shot /tmp/rw_after.png
R=$(an /tmp/rw_after.png 700 500 0 330); [ "$(val "$R" changed)" -lt 5 ] && ok "A10 播完后屏幕上干干净净" || bad "A10 播完残留" "$R"
chk "A10b 播完后记录清空（不再绘制）" "$(EV evalLayer 'window.__present().water.length')" '0'
chk "A10c 没有波纹时画布缩成 1×1（释放显存）" "$(EV evalLayer "document.getElementById('water').width+'x'+document.getElementById('water').height")" '"1x1"'

# ---------------------------------------------------------------- 右键
xdotool mousemove 900 450 click 3; xdotool key Escape; sleep 0.3; shot /tmp/rw_right.png  # 右键点桌面会弹 openbox 菜单，先按 Esc 关掉
R=$(an /tmp/rw_right.png 900 450 25 130); echo "    右键: $R"
[ "$(val "$R" bright)" -gt 100 ] && [ "$(val "$R" tint)" -lt -8 ] && ok "A11 右键水波纹反光偏蓝（R-B=$(val "$R" tint)）" || bad "A11 右键颜色" "$R"
sleep 2

# ---------------------------------------------------------------- 连点 / 重叠
for i in $(seq 1 20); do xdotool mousemove $((400 + i * 30)) 600 click 1; done; sleep 0.05
R=$(EV evalLayer 'window.__present().water.length'); [ "${R:-99}" -le 12 ] && [ "${R:-0}" -ge 1 ] && ok "A12 连点 20 下最多同时 12 个水波纹（$R）" || bad "A12 数量上限" "$R"
grep -q "water shader failed" /tmp/app.log && bad "A12b 着色器编译" "$(grep 'water shader' /tmp/app.log)" || ok "A12b 着色器编译成功"
sleep 2.2; chk "A13 连点后全部播完清空" "$(EV evalLayer 'window.__present().water.length')" '0'

# ---------------------------------------------------------------- 聚光灯开着时也看得到水波纹
cmd '{"cmd":"present","action":"spot","on":true}' 1
xdotool mousemove 700 500 click 1; sleep 0.3; shot /tmp/rw_spot.png
R=$(an /tmp/rw_spot.png 700 500 25 130); [ "$(val "$R" bright)" -gt 60 ] && ok "A14 聚光灯开着时水波纹画在最上面（亮 $(val "$R" bright)）" || bad "A14 聚光灯下水波纹" "$R"
cmd '{"cmd":"present","action":"spot","on":false}' 1; sleep 1.5

# ---------------------------------------------------------------- 关掉点击波纹时立即清掉
xdotool mousemove 700 500 click 1; sleep 0.1
cmd '{"cmd":"setSettings","patch":{"present":{"clicks":false}}}' 0.3; shot /tmp/rw_off.png
R=$(an /tmp/rw_off.png 700 500 0 330); N=$(EV evalLayer 'window.__present().water.length'); R="$R list=$N"
[ "$(val "$R" changed)" -lt 5 ] && { [ "$N" = 0 ] || [ "$N" = "\"NOLAYER\"" ]; } && ok "A15 关掉「点击波纹」时正在播的水波纹马上消失（没别的效果时演示层直接收起）" || bad "A15 关掉后残留" "$R"
cmd '{"cmd":"setSettings","patch":{"present":{"clicks":true}}}' 0.8

# ---------------------------------------------------------------- 单圈（旧样式）、乱写的值
style single; xdotool mousemove 700 500 click 1; sleep 0.1
R=$(EV evalLayer "JSON.stringify([document.querySelectorAll('.rip').length, window.__present().water.length])" | jq -r .)
chk "B1 选「单圈（旧样式）」→ 用原来的单圈，不画水波" "$R" '[1,0]'
sleep 0.15; shot /tmp/rw_single.png; R=$(an /tmp/rw_single.png 700 500 45 200); [ "$(val "$R" changed)" -lt 10 ] && ok "B1b 单圈仍是 32px 以内的小圈" || bad "B1b 单圈大小" "$R"
sleep 0.8; chk "B1c 单圈播完清掉" "$(EV evalLayer "document.querySelectorAll('.rip').length")" '0'
style bogus; chk "B2 设置里是乱写的样式 → 按水波纹处理" "$(LAYER | jq -r '.cfg.rippleStyle')" 'water'
style water

# ---------------------------------------------------------------- 设置页
cmd '{"cmd":"settings","tab":"present"}' 2.5
R=$(EV evalSettings "JSON.stringify([...document.querySelectorAll('$SEL option')].map(o=>o.value+':'+o.textContent))" | jq -r .)
chk "S1 设置页「波纹样式」：水波纹 / 单圈" "$R" '["water:水波纹","single:单圈（旧样式）"]'
chk "S2 默认选中水波纹" "$(EV evalSettings "document.querySelector('$SEL').value")" '"water"'
EV evalSettings "(()=>{const s=document.querySelector('$SEL');s.value='single';s.dispatchEvent(new Event('change'));return 1})()" >/dev/null; sleep 1
chk "S3 设置页改成单圈：立即保存" "$(jq -r .present.rippleStyle ~/.config/BillyShot/settings.json)" 'single'
chk "S3b 正在显示的演示层马上换样式" "$(LAYER | jq -r '.cfg.rippleStyle')" 'single'
R=$(EV evalSettings "document.querySelector('$SEL').closest('.row').previousElementSibling.querySelector('small').textContent")
chk "S4 「点击波纹」说明改成水波" "$R" '"点击时像水波一样荡开，左键和右键颜色不同"'
cmd '{"cmd":"evalSettings","js":"window.close()"}' 1
style water

# ---------------------------------------------------------------- 录屏里有水波纹（录像 / Zoom 看到的就是屏幕上的）
cmd '{"cmd":"present","action":"demo","on":false}' 1
cmd '{"cmd":"recordFull"}' 2
for p in "500 400" "1100 600" "800 300"; do xdotool mousemove $p click 1; sleep 1.0; done
xdotool mousemove 1800 1000; sleep 1.5
cmd '{"cmd":"stop"}' 4
F=$(ls -t $VD/*.mp4 2>/dev/null | head -1)
rm -rf /tmp/rw_frames; mkdir -p /tmp/rw_frames
[ -n "$F" ] && ffmpeg -v error -i "$F" -vf fps=15 /tmp/rw_frames/f%03d.png
BEST=0; BR=0; BD=0
for f in /tmp/rw_frames/*.png; do
  for c in "500 400" "1100 600" "800 300"; do
    R=$(an $f $c 25 130); A=$(val "$R" changed)
    if [ "$A" -gt "$BEST" ]; then BEST=$A; BR=$(val "$R" bright); BD=$(val "$R" dark); fi
  done
done
[ "$BR" -gt 50 ] && ok "R1 录出的视频里有水波纹（最多 $BEST 个像素变化，反光 $BR）" || bad "R1 视频里的水波纹" "file=$F best=$BEST bright=$BR dark=$BD"
LASTF=$(ls /tmp/rw_frames/*.png | tail -1); R=$(an $LASTF 800 300 0 330); [ "$(val "$R" changed)" -lt 30 ] && ok "R2 视频结尾波纹已经消失，没有残影" || bad "R2 视频残影" "$R"

# ================================================================ E 折射：波纹经过的地方，下面的画面被「水」折弯
stop_app
refr_run() {   # $1 = 输出名；EXTRA_ENV 控制是否抓画面
  fresh zh '"present":{"clicks":true}'
  start_app 6; cmd '{"cmd":"present","action":"demo","on":true}' 1.5
  xdotool mousemove 1800 1000; sleep 0.6
  shot /tmp/rf_base_$1.png
  rm -rf /tmp/rf_$1; mkdir -p /tmp/rf_$1
  ffmpeg -v error -y -f x11grab -framerate 20 -video_size 1920x1080 -i :99 -t 2.0 /tmp/rf_$1/f%03d.png & FF=$!
  sleep 0.4; xdotool mousemove 700 500 click 1; sleep 0.25
  printf -v "REF_$1" '%s' "$(EV evalLayer "JSON.stringify(window.__present().water.map(e=>e.refract))" | jq -r .)"
  xdotool mousemove 1800 1000; wait $FF
  stop_app
}
stripes_root
EXTRA_ENV="" refr_run on
EXTRA_ENV="BILLYSHOT_TEST_NOPATCH=1" refr_run off
RON=$(python3 test/ripple_diff.py /tmp/rf_base_on.png /tmp/rf_on 700 500 25 150); ROFF=$(python3 test/ripple_diff.py /tmp/rf_base_off.png /tmp/rf_off 700 500 25 150)
echo "    折射: $RON   不折射: $ROFF"
chk "E1 条纹桌面上点击：拿到了画面，开启折射" "$REF_on" '[true]'
chk "E1b 抓不到画面时不折射（只有反光）" "$REF_off" '[false]'
DON=$(val "$RON" darker); DOFF=$(val "$ROFF" darker)
[ "$DON" -gt 60 ] && [ "$DOFF" -lt 10 ] && ok "E2 折射把波纹下面的条纹折弯了：$DON 个浅色处被挪来的深色条纹盖住（不折射时 $DOFF 个）" || bad "E2 折射效果" "on=$RON off=$ROFF"
LASTF=$(ls /tmp/rf_on/*.png | tail -1); rm -rf /tmp/rf_last; mkdir -p /tmp/rf_last; cp $LASTF /tmp/rf_last/; R=$(python3 test/ripple_diff.py /tmp/rf_base_on.png /tmp/rf_last 700 500 0 330)
[ "$(val "$R" changed)" -lt 10 ] && ok "E4 波纹播完，画面和点击前完全一样（没有残留的旧画面）" || bad "E4 残留" "$R"
gray_root

# ================================================================ C 英文界面
stop_app
fresh en
start_app 6
cmd '{"cmd":"settings","tab":"present"}' 2.5
R=$(EV evalSettings "JSON.stringify([...document.querySelectorAll('$SEL option')].map(o=>o.textContent))" | jq -r .)
chk "C1 英文界面：波纹样式选项" "$R" '["Water ripples","Single ring (classic)"]'
R=$(EV evalSettings "document.querySelector('$SEL').closest('.row').querySelector('b').textContent"); chk "C2 英文标签" "$R" '"Ripple style"'

if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "C 无报错"; else ok "C 无报错"; fi

# ================================================================ D 电脑不支持 WebGL → 自动退回单圈，功能照常
stop_app
fresh zh '"present":{"clicks":true}'
EXTRA_ENV="BILLYSHOT_TEST_NOGL=1" start_app 6
cmd '{"cmd":"present","action":"demo","on":true}' 1.5
chk "D1 没有 WebGL 时检测得到" "$(LAYER | jq -r '.waterGL')" 'false'
xdotool mousemove 700 500 click 1; sleep 0.1
R=$(EV evalLayer "JSON.stringify([document.querySelectorAll('.rip').length, window.__present().water.length])" | jq -r .)
chk "D2 没有 WebGL 时点击照样有波纹（退回单圈）" "$R" '[1,0]'
if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "全程无报错" "$(grep -E 'Uncaught|REPORTED_ERROR|TEST ERR' /tmp/app.log | head -3)"; else ok "全程无报错"; fi
stop_app

echo "=========================="
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL"
