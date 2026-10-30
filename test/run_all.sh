#!/bin/bash
# Hopsnap 端到端回归测试（Xvfb + openbox + xcompmgr）
cd "$(dirname "$0")/.."
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()   { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
E()    { local n=$(grep -c EVAL /tmp/app.log); cmd "{\"cmd\":\"eval\",\"js\":\"$1\"}" 0.7; local m=$(grep -c EVAL /tmp/app.log); [ "$m" -gt "$n" ] && grep EVAL /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
status(){ local n=$(grep -c STATUS /tmp/app.log); cmd '{"cmd":"status"}' 0.7; local m=$(grep -c STATUS /tmp/app.log); if [ "$m" -gt "$n" ]; then grep STATUS /tmp/app.log | tail -1; else echo 'HUNG "overlayVisible":hung "rec":hung'; fi; }
vis()  { status | grep -o '"overlayVisible":[a-z]*' | cut -d: -f2; }
recon(){ status | grep -o '"rec":[a-z]*' | cut -d: -f2; }
newest(){ ls -t $1 2>/dev/null | head -1; }
probe(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null; }
VD=~/Videos/Hopsnap

# 干净的设置
rm -rf ~/.config/Hopsnap ~/Hopsnap; mkdir -p $VD; rm -f $VD/*
mkdir -p ~/.config/Hopsnap
cat > ~/.config/Hopsnap/settings.json <<J
{"general":{"firstRun":false},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4"},"sound":{"record":true,"countdown":true}}
J
start_x; start_app 6

# 1 截图 + 矩形 + Enter 复制
cmd '{"cmd":"capture"}' 2
xdotool mousemove 400 300 mousedown 1 mousemove 700 500 mousemove 1000 700 mouseup 1; sleep 0.4
xdotool key r; sleep 0.2; xdotool mousemove 450 340 mousedown 1 mousemove 600 400 mousemove 700 450 mouseup 1; sleep 0.3
xdotool key Return; sleep 1.2
cmd '{"cmd":"clipboard"}' 1
grep CLIP /tmp/app.log | tail -1 | grep -q '"width":600,"height":400' && [ "$(vis)" = false ] && ok "截图复制 600x400" || bad "截图复制" "$(grep CLIP /tmp/app.log | tail -1)"

# 2 Esc 退出
cmd '{"cmd":"capture"}' 2; xdotool key Escape; sleep 0.8
[ "$(vis)" = false ] && ok "Esc 退出截图" || bad "Esc 退出截图" "still visible"

# 3 右键三连退出
cmd '{"cmd":"capture"}' 2; xdotool mousemove 400 300 mousedown 1 mousemove 800 600 mouseup 1; sleep 0.3; xdotool key r; sleep 0.1
xdotool click 3; sleep 0.2; xdotool click 3; sleep 0.2; xdotool click 3; sleep 0.8
[ "$(vis)" = false ] && ok "右键取消/重选/退出" || bad "右键退出" "still visible"

# 4 全屏截图
cmd '{"cmd":"captureFull"}' 2; cmd '{"cmd":"clipboard"}' 1
grep CLIP /tmp/app.log | tail -1 | grep -q '"width":1920,"height":1080' && ok "全屏截图到剪贴板" || bad "全屏截图" "$(grep CLIP /tmp/app.log | tail -1)"

# 5 贴图 + 关闭
cmd '{"cmd":"pinClipboard"}' 1.5
status | grep -q '"pins":1' && ok "贴图打开" || bad "贴图打开" "$(status)"
cmd '{"cmd":"eval","js":"1"}' 0.3

# 6 拖动标注时撤销（之前会抛异常）
cmd '{"cmd":"capture"}' 2; xdotool mousemove 400 300 mousedown 1 mousemove 900 700 mouseup 1; sleep 0.3
xdotool key r; xdotool mousemove 450 350 mousedown 1 mousemove 600 450 mouseup 1; sleep 0.2
xdotool mousemove 450 380 mousedown 1 mousemove 470 390; xdotool key ctrl+z; xdotool mousemove 500 420 mousemove 520 430 mouseup 1; sleep 0.3
R=$(E "String(!!S)+','+S.shapes.length"); [ "$R" = '"true,1"' ] && ok "拖动中撤销（撤回移动，图形还在）" || bad "拖动中撤销" "$R"
grep -q "Uncaught" /tmp/app.log && bad "渲染进程无异常" "$(grep Uncaught /tmp/app.log | tail -1)" || ok "渲染进程无异常"

# 7 模糊 + 马赛克 + 文字 后导出
xdotool key m; sleep 0.2
E "style.mosaic.effect='blur';style.mosaic.brush=60;1" >/dev/null
xdotool mousemove 450 500 mousedown 1 mousemove 650 505 mousemove 800 510 mouseup 1; sleep 0.2
xdotool key t; xdotool mousemove 500 600 click 1; sleep 0.2; xdotool type "Test 123"; xdotool key ctrl+Return; sleep 0.2
R=$(E "S.shapes.map(s=>s.type+(s.effect||'')).join(',')")
echo "$R" | grep -q 'mosaicblur' && echo "$R" | grep -q 'text' && ok "模糊+文字标注" || bad "模糊+文字" "$R"
xdotool key Return; sleep 1.2; cmd '{"cmd":"clipboard"}' 1
grep CLIP /tmp/app.log | tail -1 | grep -q '"width":500,"height":400' && ok "带标注导出" || bad "带标注导出" "$(grep CLIP /tmp/app.log | tail -1)"

# 8 区域录屏 MP4
cmd '{"cmd":"captureRecord"}' 2; xdotool mousemove 301 221 mousedown 1 mousemove 900 600 mousemove 1201 781 mouseup 1; sleep 0.4; xdotool key Return
sleep 2; for i in 1 2 3 4 5; do xdotool mousemove $((400+i*80)) $((300+i*40)); sleep 0.3; done
cmd '{"cmd":"stop"}' 3
F=$(newest "$VD/*.mp4"); D=$(probe "$F")
[ -n "$F" ] && awk "BEGIN{exit !($D>1.0)}" && ok "区域录屏 MP4 ($D s)" || bad "区域录屏 MP4" "file=$F dur=$D"
ls $VD | grep -q '\.part' && bad "不残留 .part" "$(ls $VD)" || ok "不残留临时文件"

# 9 暂停/继续
cmd '{"cmd":"recordFull"}' 1.5; sleep 1.5; cmd '{"cmd":"recAction","action":"pause"}' 1.5; cmd '{"cmd":"recAction","action":"resume"}' 0.5; sleep 1.5
cmd '{"cmd":"stop"}' 3
F=$(newest "$VD/*.mp4"); D=$(probe "$F")
[ "$(recon)" = false ] && awk "BEGIN{exit !($D>1.0)}" && ok "暂停/继续后保存 ($D s)" || bad "暂停/继续" "dur=$D rec=$(recon)"

# 10 连按两次全屏录屏（只应开一个，第二次=停止）
N0=$(ls $VD | wc -l)
cmd '{"cmd":"double","gap":30}' 3
sleep 1; [ "$(recon)" = false ] && ok "快速连按不会开两个录制" || { bad "快速连按" "rec still on"; cmd '{"cmd":"stop"}' 3; }
cmd '{"cmd":"double","gap":600}' 4; [ "$(recon)" = false ] && ok "启动后马上停止（页面未就绪）" || { bad "启动后马上停止" "rec on"; cmd '{"cmd":"stop"}' 3; }
cmd '{"cmd":"windows"}' 0.6; W=$(grep WINDOWS /tmp/app.log | tail -1 | awk '{print $2}')
[ "$W" -le 3 ] && ok "无残留窗口 (窗口数 $W)" || bad "残留窗口" "windows=$W"

# 11 倒计时中取消
cmd '{"cmd":"setSettings","patch":{"record":{"countdown":3}}}' 0.5
N0=$(ls $VD | wc -l)
cmd '{"cmd":"recordFull"}' 1.2; cmd '{"cmd":"recAction","action":"cancel"}' 2
N1=$(ls $VD | wc -l)
[ "$(recon)" = false ] && [ "$N0" = "$N1" ] && ok "倒计时中放弃，不留文件" || bad "倒计时放弃" "rec=$(recon) files $N0->$N1"
cmd '{"cmd":"setSettings","patch":{"record":{"countdown":0}}}' 0.5

# 12 GIF
cmd '{"cmd":"setSettings","patch":{"record":{"format":"gif"}}}' 0.5
cmd '{"cmd":"recordFull"}' 1.5; for i in 1 2 3 4 5 6; do xdotool mousemove $((300+i*100)) $((300+i*50)); sleep 0.3; done
cmd '{"cmd":"stop"}' 6
F=$(newest "$VD/*.gif"); NF=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$F" 2>/dev/null)
[ -n "$F" ] && [ "${NF:-0}" -gt 3 ] && ok "GIF 录制 ($NF 帧)" || bad "GIF" "file=$F frames=$NF"
cmd '{"cmd":"setSettings","patch":{"record":{"format":"mp4"}}}' 0.5

# 13 保存文件夹不可写 → 自动改存到 ~/Hopsnap
cmd '{"cmd":"setSettings","patch":{"record":{"saveDir":"/proc/hopsnap-nope"}}}' 0.5
cmd '{"cmd":"recordFull"}' 1.5; xdotool mousemove 800 500; sleep 1.2; cmd '{"cmd":"stop"}' 3
F=$(newest "$HOME/Hopsnap/*.mp4"); D=$(probe "$F")
[ -n "$F" ] && awk "BEGIN{exit !($D>0.5)}" && ok "文件夹不可写时自动改存 ($F)" || bad "不可写文件夹回退" "file=$F"
cmd "{\"cmd\":\"setSettings\",\"patch\":{\"record\":{\"saveDir\":\"$VD\"}}}" 0.5

# 14 录屏中按截图快捷键 / 截图中按全屏录屏
cmd '{"cmd":"capture"}' 2; cmd '{"cmd":"recordFull"}' 2.5
[ "$(vis)" = false ] && ok "截图中开录屏会先关闭截图层" || bad "截图中开录屏" "overlay still visible"
cmd '{"cmd":"stop"}' 3

# 15 极小区域录屏
cmd '{"cmd":"captureRecord"}' 2; xdotool mousemove 500 500 mousedown 1 mousemove 510 508 mouseup 1; sleep 0.3
R=$(E "S && S.sel ? S.sel.w+'x'+S.sel.h : 'none'"); xdotool key Return; sleep 1
[ "$(recon)" = false ] && ok "过小区域不会开始录制 ($R)" || { bad "过小区域" "recording started"; cmd '{"cmd":"stop"}' 3; }
xdotool key Escape; sleep 0.5

# 16 全局：没有未捕获异常 / 报告的错误
if grep -qE "Uncaught|REPORTED_ERROR|TEST ERR" /tmp/app.log; then bad "全程无报错" "$(grep -E 'Uncaught|REPORTED_ERROR|TEST ERR' /tmp/app.log | head -3)"; else ok "全程无报错"; fi
grep -E "ERROR " ~/.config/Hopsnap/logs/hopsnap.log 2>/dev/null | head -3

echo "=========================="
printf '%s\n' "${RESULTS[@]}"
echo "PASS=$PASS FAIL=$FAIL"
