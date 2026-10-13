#!/bin/bash
# 1.2.3 录音改动测试：回声消除 / 关自动增益 / 戴耳机提示 / 立体声混音提示
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1 -- $2"; }
EV()  { local c=$1 js=$2; local n=$(grep -c EVAL /tmp/app.log); cmd "{\"cmd\":\"$c\",\"js\":\"$js\"}" 1; local m=$(grep -c EVAL /tmp/app.log); [ "$m" -gt "$n" ] && grep EVAL /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
VD=~/Videos/BillyShot
rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot $VD; rm -f $VD/*
cat > ~/.config/BillyShot/settings.json <<J
{"general":{"firstRun":false,"language":"zh"},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4","systemAudio":true,"mic":true},"sound":{"record":false,"countdown":false}}
J
start_x; start_app 6
sel() { xdotool mousemove 301 221 mousedown 1 mousemove 900 600 mousemove 1201 781 mouseup 1; sleep 0.5; }

# A 系统声音 + 麦克风都开 → 显示「建议戴耳机」
cmd '{"cmd":"captureRecord"}' 2; sel
R=$(EV eval "!!document.getElementById('recWarn')"); [ "$R" = true ] && ok "两个都开时显示戴耳机提示" || bad "两个都开时显示戴耳机提示" "$R"
R=$(EV eval "document.getElementById('recWarn').textContent"); [ "$R" = '"建议戴耳机"' ] && ok "提示文字" || bad "提示文字" "$R"
R=$(EV eval "(()=>{const t=document.getElementById('toolbar').getBoundingClientRect();return t.right<=innerWidth&&t.left>=0})()"); [ "$R" = true ] && ok "工具栏没有超出屏幕" || bad "工具栏没有超出屏幕" "$R"
import -window root /tmp/t123_toolbar.png 2>/dev/null
# B 关掉麦克风 → 提示消失
R=$(EV eval "[...document.querySelectorAll('#toolbar .tog')][1].click();!!document.getElementById('recWarn')"); [ "$R" = false ] && ok "关掉麦克风后提示消失" || bad "关掉麦克风后提示消失" "$R"
# C 再打开麦克风、切到 GIF → 不显示
R=$(EV eval "[...document.querySelectorAll('#toolbar .tog')][1].click();document.querySelector('.seg button[data-fmt=gif]').click();!!document.getElementById('recWarn')"); [ "$R" = false ] && ok "GIF 不显示提示" || bad "GIF 不显示提示" "$R"
R=$(EV eval "document.querySelector('.seg button[data-fmt=mp4]').click();!!document.getElementById('recWarn')"); [ "$R" = true ] && ok "切回 MP4 提示恢复" || bad "切回 MP4 提示恢复" "$R"

# D 开始录制：麦克风的回声消除开、自动增益关，文件有音轨
xdotool key Return; sleep 2.5
R=$(EV evalRec "(()=>{const t=micStream&&micStream.getAudioTracks()[0];if(!t)return 'nomic';const s=t.getSettings();return [s.echoCancellation,s.autoGainControl,s.noiseSuppression].join(',')})()")
[ "$R" = '"true,false,true"' ] && ok "麦克风 回声消除=开 自动增益=关 降噪=开" || bad "麦克风设置" "$R"
sleep 1; cmd '{"cmd":"stop"}' 3
F=$(ls -t $VD/*.mp4 2>/dev/null | head -1)
A=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$F" 2>/dev/null)
[ -n "$A" ] && ok "录好的 MP4 有音轨 ($A)" || bad "录好的 MP4 有音轨" "file=$F"
grep -q "mic failed" /tmp/app.log && bad "麦克风无报错" "$(grep 'mic failed' /tmp/app.log)" || ok "麦克风无报错"

# E 设置页提示
cmd '{"cmd":"settings","tab":"record"}' 2.5
R=$(EV evalSettings "document.getElementById('echoTip').hidden"); [ "$R" = false ] && ok "设置页：两个都开显示提示" || bad "设置页：两个都开显示提示" "$R"
R=$(EV evalSettings "(()=>{const c=document.querySelector('[data-k=\\\"record.mic\\\"]');c.checked=false;c.dispatchEvent(new Event('change'));return 1})()"); sleep 0.8
R=$(EV evalSettings "document.getElementById('echoTip').hidden"); [ "$R" = true ] && ok "设置页：关麦克风后提示隐藏" || bad "设置页：关麦克风后提示隐藏" "$R"
R=$(EV evalSettings "(()=>{const c=document.querySelector('[data-k=\\\"record.mic\\\"]');c.checked=true;c.dispatchEvent(new Event('change'));const s=document.getElementById('micSel');const o=document.createElement('option');o.value='x1';o.textContent='立体声混音 (Realtek Audio)';s.appendChild(o);s.value='x1';s.dispatchEvent(new Event('change'));return 1})()"); sleep 0.8
R=$(EV evalSettings "document.getElementById('mixTip').hidden"); [ "$R" = false ] && ok "设置页：选了立体声混音会提醒" || bad "设置页：立体声混音提醒" "$R"
import -window root /tmp/t123_settings.png 2>/dev/null
R=$(EV evalSettings "(()=>{const s=document.getElementById('micSel');s.value='';s.dispatchEvent(new Event('change'));return 1})()"); sleep 0.8
R=$(EV evalSettings "document.getElementById('mixTip').hidden"); [ "$R" = true ] && ok "设置页：换回正常麦克风提醒消失" || bad "设置页：换回麦克风" "$R"
grep -q "Uncaught" /tmp/app.log && bad "无未捕获异常" "$(grep Uncaught /tmp/app.log | tail -1)" || ok "无未捕获异常"
echo "PASS=$PASS FAIL=$FAIL"
cmd '{"cmd":"quit"}' 1
