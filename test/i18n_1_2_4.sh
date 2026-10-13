#!/bin/bash
# 1.2.4 中英文界面测试
cd /home/claude/billyshot
source test/env.sh
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1 -- $2"; }
EV()  { local c=$1 js=$2; local n=$(grep -c EVAL /tmp/app.log); cmd "{\"cmd\":\"$c\",\"js\":\"$js\"}" 1; local m=$(grep -c EVAL /tmp/app.log); [ "$m" -gt "$n" ] && grep EVAL /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
HOOK(){ local tag=$1 c=$2; local n=$(grep -c "^$tag " /tmp/app.log); cmd "{\"cmd\":\"$c\"}" 1; grep "^$tag " /tmp/app.log | tail -1 | cut -d' ' -f2-; }
VD=~/Videos/BillyShot
fresh() {
  rm -rf ~/.config/BillyShot; mkdir -p ~/.config/BillyShot $VD
  cat > ~/.config/BillyShot/settings.json <<J
{"general":{"firstRun":false${1:+,\"language\":\"$1\"}},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4","systemAudio":true,"mic":true},"sound":{"record":false,"countdown":false}}
J
}
# 页面里除了刻意保留的双语文字，不应再有中文
CJK_JS="(()=>{const allow=['界面语言 · Language','跟随系统 · System','简体中文'];const bad=[];const w=document.createTreeWalker(document.body,4);while(w.nextNode()){const v=w.currentNode.nodeValue.trim();if(/[\\\\u4e00-\\\\u9fff]/.test(v)&&!allow.includes(v))bad.push(v)}document.querySelectorAll('[title],[placeholder]').forEach(e=>{for(const a of ['title','placeholder']){const v=e.getAttribute(a);if(v&&/[\\\\u4e00-\\\\u9fff]/.test(v))bad.push(a+':'+v)}});return bad.slice(0,5)})()"
sel() { xdotool mousemove 301 221 mousedown 1 mousemove 900 600 mousemove 1201 781 mouseup 1; sleep 0.5; }

start_x
# ===== A 英文系统 + 跟随系统 → 英文
fresh; EXTRA_ENV="BILLYSHOT_SYSLANG=en-US" start_app 6
R=$(HOOK LANG lang); [ "$R" = en ] && ok "英文系统 + 跟随系统 → English" || bad "英文系统默认英文" "$R"
R=$(HOOK TRAY trayLabels); echo "$R" | grep -q '"Screenshot\\t' && echo "$R" | grep -q '"Quit"' && echo "$R" | grep -q 'Presenting:' && echo "$R" | grep -q 'File:' && ok "托盘菜单是英文（7 行 IA）" || bad "托盘菜单英文" "$R"
echo "$R" | grep -qP '[\x{4e00}-\x{9fff}]' 2>/dev/null; python3 -c "import sys,re;s=sys.argv[1];sys.exit(0 if re.search('[一-鿿]',s) else 1)" "$R" && bad "托盘菜单无中文" "$R" || ok "托盘菜单无中文"
cmd '{"cmd":"capture"}' 2; sel
R=$(EV eval "document.querySelector('[data-tool=rect]').title"); [ "$R" = '"Rectangle (R) — hold Shift for a square"' ] && ok "截图工具栏提示英文" || bad "截图工具栏提示英文" "$R"
R=$(EV eval "$CJK_JS"); [ "$R" = '[]' ] && ok "截图界面无中文" || bad "截图界面无中文" "$R"
R=$(EV eval "document.querySelector('.hint').textContent"); [ "$R" = '"C: copy color · Esc: exit"' ] && ok "放大镜提示英文" || bad "放大镜提示英文" "$R"
xdotool key m; sleep 0.3
R=$(EV eval "[...document.querySelectorAll('#stylebar .seg button')].map(b=>b.textContent).join(',')"); [ "$R" = '"Mosaic,Blur"' ] && ok "马赛克样式栏英文" || bad "马赛克样式栏英文" "$R"
import -window root /tmp/i18n_en_shot.png 2>/dev/null
xdotool key Escape; sleep 0.8
cmd '{"cmd":"captureRecord"}' 2; sel
R=$(EV eval "document.getElementById('toolbar').innerText.replace(/\\\\s+/g,' ')"); echo "$R" | grep -q 'System audio' && echo "$R" | grep -q 'Mic' && echo "$R" | grep -q 'Use headphones' && echo "$R" | grep -q 'Start recording' && ok "录屏工具栏英文 ($R)" || bad "录屏工具栏英文" "$R"
R=$(EV eval "$CJK_JS"); [ "$R" = '[]' ] && ok "录屏工具栏无中文" || bad "录屏工具栏无中文" "$R"
R=$(EV eval "(()=>{const t=document.getElementById('toolbar').getBoundingClientRect();return t.right<=innerWidth&&t.left>=0&&t.height<60})()"); [ "$R" = true ] && ok "英文工具栏没有超出屏幕、没有换行" || bad "英文工具栏宽度" "$R"
import -window root /tmp/i18n_en_rectb.png 2>/dev/null
xdotool key Return; sleep 3
import -window root /tmp/i18n_en_recbar.png 2>/dev/null
cmd '{"cmd":"stop"}' 3
grep "^NOTIFY" /tmp/app.log | tail -1 | grep -q "Recording saved" && ok "录屏完成通知英文 ($(grep ^NOTIFY /tmp/app.log | tail -1 | cut -c1-60))" || bad "录屏完成通知英文" "$(grep ^NOTIFY /tmp/app.log | tail -1)"
cmd '{"cmd":"eval","js":"1"}' 0.3
cmd '{"cmd":"pinClipboard"}' 1.5
grep "^NOTIFY" /tmp/app.log | tail -1 | grep -q "No image on the clipboard" && ok "贴图提示英文" || bad "贴图提示英文" "$(grep ^NOTIFY /tmp/app.log | tail -1)"
# 设置窗口每一页
cmd '{"cmd":"settings","tab":"welcome"}' 3
for tab in welcome hotkeys capture record present sound history general about; do
  EV evalSettings "showTab('$tab');1" >/dev/null
  R=$(EV evalSettings "(()=>{const s=document.querySelector('section.on');const bad=[];const w=document.createTreeWalker(s,4);while(w.nextNode()){const v=w.currentNode.nodeValue.trim();if(/[\\\\u4e00-\\\\u9fff]/.test(v)&&!['界面语言 · Language','跟随系统 · System','简体中文'].includes(v)&&!w.currentNode.parentElement.closest('[hidden]'))bad.push(v)}return bad.slice(0,4)})()")
  [ "$R" = '[]' ] && ok "设置页「$tab」无中文" || bad "设置页「$tab」无中文" "$R"
  import -window root /tmp/i18n_en_set_$tab.png 2>/dev/null
done
R=$(EV evalSettings "[...document.querySelectorAll('nav a')].map(a=>a.textContent.trim()).join('|')"); [ "$R" = '"Get started|Shortcuts|Screenshot|Recording|Presenting|Sound|History / Clipboard|General|About"' ] && ok "设置导航英文" || bad "设置导航英文" "$R"
R=$(EV evalSettings "document.title"); [ "$R" = '"BillyShot"' ] && ok "设置窗口标题（BillyShot，中英文相同）" || bad "设置窗口标题" "$R"
R=$(EV evalSettings "document.getElementById('langSel').value"); [ "$R" = '"auto"' ] && ok "语言选择显示「跟随系统」" || bad "语言选择默认" "$R"
R=$(EV evalSettings "[...document.querySelectorAll('nav a')].every(a=>a.scrollHeight<=a.clientHeight+2)"); [ "$R" = true ] && ok "导航文字没有被截断" || bad "导航截断" "$R"

# ===== B 在设置里切到中文：设置页重新加载为中文，截图层、托盘也变中文，并记住
EV evalSettings "(()=>{const s=document.getElementById('langSel');s.value='zh';s.dispatchEvent(new Event('change'));return 1})()" >/dev/null; sleep 2.5
R=$(HOOK LANG lang); [ "$R" = zh ] && ok "切换到中文" || bad "切换到中文" "$R"
R=$(EV evalSettings "document.querySelector('nav a[data-tab=general]').textContent.trim()+'|'+document.querySelector('section.on').dataset.tab"); [ "$R" = '"常规|general"' ] && ok "设置页立即变中文并停在「常规」" || bad "设置页切换" "$R"
R=$(HOOK TRAY trayLabels); echo "$R" | grep -q '"退出"' && echo "$R" | grep -q '演示:' && echo "$R" | grep -q '文件:' && ok "托盘菜单变中文（7 行 IA）" || bad "托盘中文" "$R"
cmd '{"cmd":"capture"}' 2; sel
R=$(EV eval "document.querySelector('[data-tool=rect]').title"); [ "$R" = '"矩形 (R)  按住 Shift 画正方形"' ] && ok "截图层重建为中文" || bad "截图层中文" "$R"
xdotool key Escape; sleep 0.8
grep -q '"language": "zh"' ~/.config/BillyShot/settings.json && ok "语言选择已保存" || bad "语言保存" "$(grep language ~/.config/BillyShot/settings.json)"

# ===== C 托盘菜单切回英文
cmd '{"cmd":"quit"}' 1.5
fresh en; EXTRA_ENV="BILLYSHOT_SYSLANG=zh-CN" start_app 6
R=$(HOOK LANG lang); [ "$R" = en ] && ok "中文系统但手动选 English → 英文" || bad "手动英文" "$R"
cmd '{"cmd":"quit"}' 1.5
# ===== D 中文系统 + 跟随系统 → 中文；繁体系统 → 中文
fresh; EXTRA_ENV="BILLYSHOT_SYSLANG=zh-CN" start_app 6
R=$(HOOK LANG lang); [ "$R" = zh ] && ok "中文系统 + 跟随系统 → 中文" || bad "中文系统默认" "$R"
cmd '{"cmd":"settings","tab":"general"}' 3
R=$(EV evalSettings "document.querySelector('section.on h1').textContent"); [ "$R" = '"常规"' ] && ok "中文设置页正常" || bad "中文设置页" "$R"
import -window root /tmp/i18n_zh_general.png 2>/dev/null
# 恢复全部默认 → 语言回到「跟随系统」
EV evalSettings "window.confirm=()=>true;document.getElementById('langSel').value='en';document.getElementById('langSel').dispatchEvent(new Event('change'));1" >/dev/null; sleep 2.5
R=$(HOOK LANG lang); [ "$R" = en ] && ok "中文系统里切到 English" || bad "切到English" "$R"
EV evalSettings "window.confirm=()=>true;document.getElementById('resetAll').click();1" >/dev/null; sleep 2.5
R=$(HOOK LANG lang); [ "$R" = zh ] && ok "恢复默认后回到跟随系统（中文）" || bad "恢复默认语言" "$R"
cmd '{"cmd":"quit"}' 1.5
fresh; EXTRA_ENV="BILLYSHOT_SYSLANG=zh-TW" start_app 6
R=$(HOOK LANG lang); [ "$R" = zh ] && ok "繁体中文系统 → 中文" || bad "繁体系统" "$R"
cmd '{"cmd":"quit"}' 1.5
fresh; EXTRA_ENV="BILLYSHOT_SYSLANG=ja-JP" start_app 6
R=$(HOOK LANG lang); [ "$R" = en ] && ok "其他语言系统（日文）→ English" || bad "日文系统" "$R"
grep -q "Uncaught" /tmp/app.log && bad "无未捕获异常" "$(grep Uncaught /tmp/app.log | tail -1)" || ok "无未捕获异常"
# ===== E 1.3.0 演示录屏的英文界面：演示模式通知、摄像头圆窗、录屏工具栏的摄像头开关、控制条
cmd '{"cmd":"quit"}' 1.5
fresh en; EXTRA_ENV="BILLYSHOT_SYSLANG=en-US BILLYSHOT_FAKE_MEDIA=1" start_app 6
cmd '{"cmd":"present","action":"demo","on":true}' 1.5
grep "^NOTIFY" /tmp/app.log | tail -1 | grep -q "Cursor halo and click ripples turned on" && ok "演示模式通知英文" || bad "演示模式通知英文" "$(grep ^NOTIFY /tmp/app.log | tail -1)"
R=$(HOOK TRAY trayLabels); echo "$R" | grep -q 'Presenting:' && echo "$R" | grep -q 'Halo' && echo "$R" | grep -q 'Water ripples' && echo "$R" | grep -q 'Spotlight' && echo "$R" | grep -q 'Camera bubble' && ok "托盘演示菜单英文" || bad "托盘演示菜单英文" "$R"
cmd '{"cmd":"present","action":"demo","on":false}' 1
cmd '{"cmd":"present","action":"cam","on":true}' 3
R=$(EV evalCam "$CJK_JS"); [ "$R" = '[]' ] && ok "摄像头圆窗无中文" || bad "摄像头圆窗无中文" "$R"
R=$(EV evalCam "document.getElementById('bSize').title"); [ "$R" = '"Size (S / M / L)"' ] && ok "摄像头圆窗按钮提示英文" || bad "圆窗按钮英文" "$R"
cmd '{"cmd":"present","action":"cam","on":false}' 1
cmd '{"cmd":"captureRecord"}' 2; sel
R=$(EV eval "document.getElementById('togCam').textContent.trim()+'|'+document.getElementById('togCam').title"); [ "$R" = '"Camera|Show your camera in the bottom-right of the recording area (draggable)"' ] && ok "录屏工具栏摄像头开关英文" || bad "摄像头开关英文" "$R"
R=$(EV eval "(()=>{const t=document.getElementById('toolbar').getBoundingClientRect();return t.right<=innerWidth&&t.left>=0})()"); [ "$R" = true ] && ok "英文录屏工具栏不超出屏幕" || bad "英文工具栏宽度" "$R"
xdotool key Return; sleep 3
R=$(EV evalBar "$CJK_JS"); [ "$R" = '[]' ] && ok "录制控制条无中文" || bad "控制条无中文" "$R"
R=$(EV evalBar "document.getElementById('spot').title"); [ "$R" = '"Spotlight: off"' ] && ok "控制条聚光灯按钮提示英文" || bad "控制条按钮英文" "$R"
cmd '{"cmd":"stop"}' 3
grep -q "Uncaught" /tmp/app.log && bad "E 无未捕获异常" "$(grep Uncaught /tmp/app.log | tail -1)" || ok "E 无未捕获异常"
cmd '{"cmd":"quit"}' 1
echo "PASS=$PASS FAIL=$FAIL"
