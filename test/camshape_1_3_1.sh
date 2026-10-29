#!/bin/bash
# 1.3.1 摄像头圆窗形状测试：画面要被裁成圆形 / 圆角方形，四角露出后面的桌面（屏幕上、录出来的视频里都一样）
cd "$(dirname "$0")/.."
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want=$3 got=$2"; fi; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "$(jq -cn --arg c "$c" --arg js "$js" '{cmd:$c,js:$js}')" 0.7; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
PS()  { local n=$(grep -c '^PSTATUS' /tmp/app.log); cmd '{"cmd":"presentStatus"}' 0.6; local m=$(grep -c '^PSTATUS' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^PSTATUS' /tmp/app.log | tail -1 | sed 's/^PSTATUS //' || echo '{}'; }
PJ()  { local r; for i in 1 2 3; do r=$(PS | jq -c "$1" 2>/dev/null) && [ -n "$r" ] && { echo "$r"; return; }; sleep 0.3; done; echo "$r"; }
pix() { convert "$1" -crop 1x1+$2+$3 -depth 8 txt:- 2>/dev/null | tail -1 | grep -o 'srgb([0-9,]*)' | tr -d 'srgb()'; }
dist() { awk -v a="$1" -v b="$2" 'BEGIN{split(a,x,",");split(b,y,",");d=0;for(i=1;i<=3;i++){t=x[i]-y[i];d+=(t<0?-t:t)};print d}'; }
newest(){ ls -t $1 2>/dev/null | head -1; }
VD=~/Videos/Hopsnap

# 在截图 $1（对照图 $2）里检查圆窗 bounds $3：四角 = 桌面，中心 = 摄像头画面
# $4 = 角上往里缩多少像素检查（圆形取 8，圆角 18px 取 2）
shape_check() {
  local img=$1 ref=$2 b=$3 in=$4 name=$5
  local x=$(echo "$b" | jq .x) y=$(echo "$b" | jq .y) w=$(echo "$b" | jq .width) h=$(echo "$b" | jq .height)
  local worst=0 pts="$((x+in)),$((y+in)) $((x+w-1-in)),$((y+in)) $((x+in)),$((y+h-1-in)) $((x+w-1-in)),$((y+h-1-in))"
  for p in $pts; do
    local px=${p%,*} py=${p#*,}
    local d=$(dist "$(pix $img $px $py)" "$(pix $ref $px $py)"); [ "$d" -gt "$worst" ] && worst=$d
  done
  local cx=$((x+w/2)) cy=$((y+h/2)); local dc=$(dist "$(pix $img $cx $cy)" "$(pix $ref $cx $cy)")
  [ "$worst" -le 12 ] && ok "$name：四角露出桌面（最大色差 $worst）" || bad "$name：四角露出桌面" "四角是摄像头画面 / 底色，最大色差 $worst"
  [ "$dc" -gt 40 ] && ok "$name：中间是摄像头画面（色差 $dc）" || bad "$name：中间是摄像头画面" "色差 $dc"
}

rm -rf ~/.config/Hopsnap; mkdir -p ~/.config/Hopsnap $VD; rm -f $VD/*
cat > ~/.config/Hopsnap/settings.json <<J
{"general":{"firstRun":false,"language":"zh"},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4"},"sound":{"record":false,"countdown":false},
 "present":{"cameraShape":"circle","cameraSize":"l","cameraMirror":true,"cameraPos":{"cx":0.3,"cy":0.45}}}
J
start_x; EXTRA_ENV="HOPSNAP_FAKE_MEDIA=1" start_app 6
xdotool mousemove 1900 5; sleep 0.3
shot /tmp/cs_ref.png

# 1 圆形 + 镜像（截图里就是这个组合）
cmd '{"cmd":"present","action":"cam","on":true}' 3
chk "C1 打开摄像头画中画" "$(PJ '[.cam.state,.cam.visible]')" '["ok",true]'
B=$(PJ '.cam.bounds'); xdotool mousemove 1900 5; sleep 0.6; shot /tmp/cs_circle.png
shape_check /tmp/cs_circle.png /tmp/cs_ref.png "$B" 8 "C2 圆形 + 镜像"
# 圆的左右上下边缘以内要是画面 / 白边，不能被多裁
x=$(echo "$B" | jq .x); y=$(echo "$B" | jq .y); w=$(echo "$B" | jq .width)
D=$(dist "$(pix /tmp/cs_circle.png $((x+w/2)) $((y+12)))" "$(pix /tmp/cs_ref.png $((x+w/2)) $((y+12)))")
[ "$D" -gt 40 ] && ok "C2c 圆内靠边的地方没有被多裁（色差 $D）" || bad "C2c 圆内靠边" "色差 $D"

R=$(EV evalCam "(()=>{const c=getComputedStyle(document.getElementById('cam')),v=getComputedStyle(document.getElementById('v'));return [c.clipPath,c.webkitMaskImage!=='none'||c.maskImage!=='none',v.borderRadius,v.clipPath].join('|')})()")
echo "$R" | grep -q '^"circle(50%[^|]*|true|50%|circle(50%[^|]*"$' && ok "C11 圆窗带 clip-path + mask，画面本身也是圆角（$R）" || bad "C11 裁剪样式" "$R"

# 2 圆形 + 不镜像
cmd '{"cmd":"setSettings","patch":{"present":{"cameraMirror":false}}}' 0.3; cmd '{"cmd":"evalSettings","js":"1"}' 0.8
xdotool mousemove 1900 5; sleep 0.4; shot /tmp/cs_circle2.png
shape_check /tmp/cs_circle2.png /tmp/cs_ref.png "$(PJ '.cam.bounds')" 8 "C3 圆形 + 不镜像"

# 3 圆角方形（形状按钮）
EV evalCam "document.getElementById('bShape').click();1" >/dev/null; sleep 0.8
B=$(PJ '.cam.bounds'); chk "C4 切到圆角方形 4:3" "$(echo $B | jq -c '[.width,.height]')|$(EV evalCam "document.body.classList.contains('rounded')")" '[453,340]|true'
xdotool mousemove 1900 5; sleep 0.5; shot /tmp/cs_round.png
shape_check /tmp/cs_round.png /tmp/cs_ref.png "$B" 2 "C5 圆角方形"
x=$(echo "$B" | jq .x); y=$(echo "$B" | jq .y); w=$(echo "$B" | jq .width)
D=$(dist "$(pix /tmp/cs_round.png $((x+40)) $((y+40)))" "$(pix /tmp/cs_ref.png $((x+40)) $((y+40)))")
[ "$D" -gt 40 ] && ok "C5c 圆角方形不是被裁成圆（左上内侧 40px 处是画面，色差 $D）" || bad "C5c 圆角方形被裁成圆" "色差 $D"
cmd '{"cmd":"setSettings","patch":{"present":{"cameraMirror":true}}}' 0.3; cmd '{"cmd":"evalSettings","js":"1"}' 0.5
xdotool mousemove 1900 5; sleep 0.4; shot /tmp/cs_round2.png
shape_check /tmp/cs_round2.png /tmp/cs_ref.png "$(PJ '.cam.bounds')" 2 "C6 圆角方形 + 镜像"

# 4 悬停时按钮条仍然显示在圆窗里
EV evalCam "document.getElementById('bShape').click();1" >/dev/null; sleep 0.8
B=$(PJ '.cam.bounds'); x=$(echo "$B" | jq .x); y=$(echo "$B" | jq .y); w=$(echo "$B" | jq .width); h=$(echo "$B" | jq .height)
xdotool mousemove $((x+w/2)) $((y+h/2)); sleep 0.6
R=$(EV evalCam "(()=>{const r=document.getElementById('ctl').getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return getComputedStyle(document.getElementById('ctl')).opacity+'|'+!!(e&&e.closest('#ctl'))})()")
chk "C7 悬停按钮条在圆形里能看到、能点到" "$R" '"1|true"'
cmd '{"cmd":"present","action":"cam","on":false}' 1

# 5 录屏：录出来的视频里四角也是桌面
cmd '{"cmd":"setSettings","patch":{"present":{"camera":true,"cameraShape":"circle","cameraSize":"l","cameraPos":{"cx":0.3,"cy":0.45}}}}' 0.4
cmd '{"cmd":"recordFull"}' 4
B=$(PJ '.cam.bounds'); chk "C8 全屏录屏时圆窗出现" "$(PJ '[.rec,.cam.state,.cam.visible]')" '[true,"ok",true]'
xdotool mousemove 1900 5; sleep 2
cmd '{"cmd":"stop"}' 4
F=$(newest "$VD/*.mp4"); ffmpeg -v error -y -sseof -0.6 -i "$F" -frames:v 1 /tmp/cs_vframe.png
convert /tmp/cs_ref.png -resize "$(identify -format '%wx%h!' /tmp/cs_vframe.png)" /tmp/cs_vref.png
# 视频有压缩，阈值放宽
x=$(echo "$B" | jq .x); y=$(echo "$B" | jq .y); w=$(echo "$B" | jq .width); h=$(echo "$B" | jq .height); worst=0
for p in "$((x+10)),$((y+10))" "$((x+w-11)),$((y+10))" "$((x+10)),$((y+h-11))" "$((x+w-11)),$((y+h-11))"; do
  d=$(dist "$(pix /tmp/cs_vframe.png ${p%,*} ${p#*,})" "$(pix /tmp/cs_vref.png ${p%,*} ${p#*,})"); [ "$d" -gt "$worst" ] && worst=$d
done
dc=$(dist "$(pix /tmp/cs_vframe.png $((x+w/2)) $((y+h/2)))" "$(pix /tmp/cs_vref.png $((x+w/2)) $((y+h/2)))")
[ "$worst" -le 40 ] && [ "$dc" -gt 40 ] && ok "C9 录出的视频里摄像头是圆的（四角色差 $worst，中心色差 $dc）" || bad "C9 视频里的圆窗" "四角 $worst 中心 $dc"

# 6 不依赖已经不存在的 Chromium 开关
grep -q "disable-direct-composition-video-overlays" src/main.js && bad "C10 不用 Chromium 144 已删除的开关" "main.js 里还有" || ok "C10 不用 Chromium 144 已删除的开关（只靠页面裁剪）"

kill $(cat /tmp/app.pid) 2>/dev/null
echo; echo "== camshape 1.3.1: PASS=$PASS FAIL=$FAIL =="
printf '%s\n' "${RESULTS[@]}" > /tmp/camshape_results.txt
