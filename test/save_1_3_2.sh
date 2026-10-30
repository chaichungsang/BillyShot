#!/bin/bash
# 1.3.2 录屏保存测试：录制中只有 .part；保存完才出现 .mp4 / .gif；控制条显示保存进度和「已保存」；
# MP4 整理成普通 MP4（逐包对比和原始分段 MP4 完全一样）；上次中断留下的 .part 启动时恢复
cd "$(dirname "$0")/.."
source test/env.sh
PASS=0; FAIL=0; RESULTS=()
ok()  { PASS=$((PASS+1)); RESULTS+=("PASS  $1"); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); RESULTS+=("FAIL  $1  -- $2"); echo "FAIL  $1 -- $2"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want=$3 got=$2"; fi; }
EV()  { local c=$1 js=$2; local n=$(grep -c '^EVAL' /tmp/app.log); cmd "$(jq -cn --arg c "$c" --arg js "$js" '{cmd:$c,js:$js}')" 0.7; local m=$(grep -c '^EVAL' /tmp/app.log); [ "$m" -gt "$n" ] && grep '^EVAL' /tmp/app.log | tail -1 | sed 's/^EVAL //' || echo NOEVAL; }
DB()  { local n=$(grep -c '^DONEBAR_STATE' /tmp/app.log); cmd '{"cmd":"doneBar"}' 0.5; grep '^DONEBAR_STATE' /tmp/app.log | tail -1 | sed 's/^DONEBAR_STATE //'; }
VD=/root/Videos/Hopsnap
clean() { mkdir -p $VD; find $VD -maxdepth 1 -type f -delete; }
sel() { xdotool mousemove 301 221 mousedown 1 mousemove 900 600 mousemove 1201 781 mouseup 1; sleep 0.4; }
wiggle() { for i in $(seq 1 $1); do xdotool mousemove $((350+(i*97)%800)) $((260+(i*61)%480)); sleep 0.25; done; }
# 顶层 box：普通 MP4 不应再有 moof；mvhd 时长 > 0
boxes() { python3 - "$1" <<'P'
import struct,sys
f=open(sys.argv[1],'rb'); f.seek(0,2); n=f.tell(); off=0; tops=[]; dur=None
while off<n:
    f.seek(off); h=f.read(16); sz,t=struct.unpack('>I4s',h[:8]); t=t.decode('latin1')
    if sz==1: sz=struct.unpack('>Q',h[8:16])[0]
    if sz==0: sz=n-off
    tops.append(t)
    if t=='moov':
        f.seek(off+8); b=f.read(min(sz-8,200)); i=b.find(b'mvhd'); v=b[i+4]
        dur=(struct.unpack('>IQ',b[i+24:i+36]) if v==1 else struct.unpack('>II',b[i+16:i+24]))
        dur=dur[1]/dur[0]
    off+=sz
print(','.join(sorted(set(tops))), 'moov_last=%s'%(tops[-1]=='moov'), 'dur=%.2f'%(dur or 0))
P
}
newest(){ ls -t $1 2>/dev/null | head -1; }

rm -rf /root/.config/Hopsnap; mkdir -p /root/.config/Hopsnap; clean
cat > /root/.config/Hopsnap/settings.json <<J
{"general":{"firstRun":false,"language":"zh"},"record":{"countdown":0,"quality":"1080","fps":30,"format":"mp4","regionFormat":"mp4","systemAudio":true,"mic":true},"sound":{"record":false,"countdown":false}}
J
start_x; start_app 6

# ---------------------------------------------------------------- 1 区域录屏 MP4
cmd '{"cmd":"captureRecord"}' 2; sel; xdotool key Return; sleep 1.5; wiggle 16
L=$(ls $VD); chk "S1 录制中文件夹里只有 .part，没有 .mp4" "$(echo "$L" | grep -c '\.mp4\.part$')|$(echo "$L" | grep -c '\.mp4$')" "1|0"
cmd '{"cmd":"stop"}' 2
L=$(ls $VD); chk "S2 保存完：出现 .mp4，没有 .part" "$(echo "$L" | grep -c '\.mp4$')|$(echo "$L" | grep -c '\.part$')" "1|0"
F=$(newest "$VD/*.mp4"); B=$(boxes "$F"); echo "  boxes: $B"
echo "$B" | grep -q 'moof' && bad "S3 整理成普通 MP4（没有 moof）" "$B" || ok "S3 整理成普通 MP4（没有 moof，moov 在末尾）"
D=$(echo "$B" | grep -o 'dur=[0-9.]*' | cut -d= -f2); awk "BEGIN{exit !($D>4 && $D<8)}" && ok "S3b 文件头里写了时长（$D 秒，资源管理器能显示）" || bad "S3b 文件头时长" "$D"
ffmpeg -v error -i "$F" -f null - 2>&1 | grep -v 'non monoton' | grep -q . && bad "S3c 整个文件解码无错误" "$(ffmpeg -v error -i "$F" -f null - 2>&1 | head -2)" || ok "S3c 整个文件解码无错误"
grep -q '"mp4 finalize".*"changed":true\|mp4 finalize {"changed":true' /tmp/app.log && ok "S3d 日志记录了整理（$(grep 'mp4 finalize' /tmp/app.log | tail -1 | grep -o '"ms":[0-9]*')）" || bad "S3d 整理日志" "$(grep 'finalize' /tmp/app.log | tail -1)"
R=$(EV evalBar "[document.body.classList.contains('done'),document.getElementById('meta').textContent,getComputedStyle(document.getElementById('donebtns')).display,getComputedStyle(document.getElementById('ctl')).display].join('|')")
echo "$R" | grep -q '^"true|已保存 · [0-9.]* [KM]B|flex|none"$' && ok "S4 控制条变成「已保存 · 大小」，录制按钮换成 打开文件夹 / 播放 ($R)" || bad "S4 控制条完成状态" "$R"
R=$(EV evalBar "JSON.stringify(window.__saving)"); echo "$R" | grep -q '正在保存' && ok "S4b 保存过程中显示过「正在保存」($R)" || bad "S4b 正在保存提示" "$R"
chk "S4c 已保存控制条记着文件" "$(DB | jq -r '.file')" "$F"
grep -q "NOTIFY 录屏完成 | $(basename $F)" /tmp/app.log && ok "S4d 系统通知照常发出" || bad "S4d 系统通知" "$(grep NOTIFY /tmp/app.log | tail -1)"
# 打开文件夹
EV evalBar "document.getElementById('dFolder').click();1" >/dev/null; sleep 0.5
grep -q "DONEBAR folder $F" /tmp/app.log && [ "$(DB)" = null ] && ok "S5 点「打开文件夹」：打开到这个文件，控制条收起" || bad "S5 打开文件夹" "$(grep DONEBAR /tmp/app.log | tail -1) / $(DB)"

# ---------------------------------------------------------------- 2 播放按钮；新录制关掉上一个已保存控制条
cmd '{"cmd":"recordFull"}' 1.5; wiggle 8; cmd '{"cmd":"stop"}' 2
F2=$(newest "$VD/*.mp4")
EV evalBar "document.getElementById('dPlay').click();1" >/dev/null; sleep 0.5
grep -q "DONEBAR play $F2" /tmp/app.log && ok "S6 点「播放」：用系统播放器打开这个视频" || bad "S6 播放" "$(grep DONEBAR /tmp/app.log | tail -1)"
cmd '{"cmd":"recordFull"}' 1.5; wiggle 6; cmd '{"cmd":"stop"}' 2
[ "$(DB | jq -r .visible)" = true ] && ok "S7 全屏录完也显示已保存控制条" || bad "S7 全屏已保存控制条" "$(DB)"
cmd '{"cmd":"recordFull"}' 1.2
chk "S7b 再开始录制：上一个已保存控制条自动关掉" "$(DB)" "null"
wiggle 4; cmd '{"cmd":"stop"}' 2
# 开始截图：已保存控制条收起，不挡住框选
cmd '{"cmd":"capture"}' 1.5
chk "S7c 开始截图时已保存控制条收起" "$(DB)" "null"
xdotool key Escape; sleep 0.8
cmd '{"cmd":"recordFull"}' 1.5; wiggle 4; cmd '{"cmd":"stop"}' 2
# 自动收起
sleep 21
chk "S8 不理它 20 秒后自动收起" "$(DB)" "null"

# ---------------------------------------------------------------- 3 放弃录制：不留任何文件
clean
cmd '{"cmd":"recordFull"}' 1.5; wiggle 6; cmd '{"cmd":"recAction","action":"cancel"}' 2
chk "S9 放弃录制：不留 .mp4 也不留 .part，控制条关掉" "$(ls $VD | wc -l)|$(DB)" "0|null"

# ---------------------------------------------------------------- 4 中途出错：保存录到的部分
clean
cmd '{"cmd":"recordFull"}' 1.5; wiggle 10
EV evalRec "api.send('rec:error','模拟编码器出错');1" >/dev/null; sleep 2
L=$(ls $VD); F=$(newest "$VD/*.mp4")
[ -n "$F" ] && ! echo "$L" | grep -q part && ! boxes "$F" | grep -q moof && ok "S10 录制中途出错：录到的部分整理好保存成 .mp4" || bad "S10 中途出错" "$L / $(boxes "$F" 2>/dev/null)"
R=$(EV evalBar "document.body.className+'|'+document.getElementById('meta').textContent")
echo "$R" | grep -q 'partial' && echo "$R" | grep -q '已保存录到的部分' && ok "S10b 控制条显示「已保存录到的部分」（橙色）" || bad "S10b 部分保存提示" "$R"
EV evalBar "document.getElementById('dClose').click();1" >/dev/null; sleep 0.4
chk "S10c 点 × 关掉" "$(DB)" "null"

# ---------------------------------------------------------------- 5 GIF
clean
cmd '{"cmd":"setSettings","patch":{"record":{"format":"gif","regionFormat":"gif","gifFps":12,"gifMaxWidth":640}}}' 0.4
cmd '{"cmd":"captureRecord"}' 2; sel; xdotool key Return; sleep 1.5; wiggle 10
L=$(ls $VD); chk "S11 GIF 录制中：只有 .gif.part（或还没开始写）" "$(echo "$L" | grep -c '\.gif$')" "0"
cmd '{"cmd":"stop"}' 3
L=$(ls $VD); F=$(newest "$VD/*.gif")
[ -n "$F" ] && ! echo "$L" | grep -q part && identify "$F" >/dev/null 2>&1 && ok "S12 GIF 保存完才出现 .gif，能正常打开（$(identify "$F" | wc -l) 帧）" || bad "S12 GIF 保存" "$L"
R=$(EV evalBar "JSON.stringify(window.__saving)+'|'+document.getElementById('meta').textContent")
echo "$R" | grep -q '正在生成 GIF' && echo "$R" | grep -q '|已保存 · ' && ok "S12b GIF：先显示「正在生成 GIF」，再显示「已保存」($R)" || bad "S12b GIF 进度" "$R"
cmd '{"cmd":"setSettings","patch":{"record":{"format":"mp4","regionFormat":"mp4"}}}' 0.4
EV evalBar "document.getElementById('dClose').click();1" >/dev/null

# ---------------------------------------------------------------- 6 MP4 整理前后逐包一致（关掉整理录一段，拿原始分段 MP4 自己整理再比）
kill $(cat /tmp/app.pid) 2>/dev/null; sleep 1; clean
EXTRA_ENV="HOPSNAP_NO_FINALIZE=1" start_app 6
cmd '{"cmd":"recordFull"}' 1.5; wiggle 24; cmd '{"cmd":"stop"}' 2
RAW=$(newest "$VD/*.mp4"); cp "$RAW" /tmp/s_raw.mp4; cp "$RAW" /tmp/s_fix.mp4
boxes /tmp/s_raw.mp4 | grep -q moof && ok "S13 原始录制是分段 MP4（有 moof）" || bad "S13 原始格式" "$(boxes /tmp/s_raw.mp4)"
node -e "require('./src/mp4fix').finalizeMp4('/tmp/s_fix.mp4').then(r=>console.log(JSON.stringify(r)))"
for f in s_raw s_fix; do ffmpeg -v error -i /tmp/$f.mp4 -map 0 -c copy -f framemd5 - 2>/dev/null | grep -v '^#' | awk -F', *' '{print $1,$2,$3,$5,$6}' > /tmp/$f.pm; done
N=$(wc -l < /tmp/s_raw.pm)
[ "$N" -gt 50 ] && cmp -s /tmp/s_raw.pm /tmp/s_fix.pm && ok "S14 整理前后每个音视频包（时间、大小、内容）完全一样（$N 个）" || bad "S14 逐包对比" "n=$N $(diff /tmp/s_raw.pm /tmp/s_fix.pm | head -3)"
for f in s_raw s_fix; do ffmpeg -v error -i /tmp/$f.mp4 -map 0:v -fps_mode passthrough -vf scale=160:-2 -f framemd5 - 2>/dev/null | grep -v '^#' | awk -F', *' '{print $6}' > /tmp/$f.vf; done  # 只比画面内容（时间戳在 S14 已经按原始时间单位逐个比过）
cmp -s /tmp/s_raw.vf /tmp/s_fix.vf && ok "S14b 解码出来的每一帧画面完全一样（$(wc -l < /tmp/s_fix.vf) 帧）" || bad "S14b 逐帧对比" "$(diff /tmp/s_raw.vf /tmp/s_fix.vf | head -2)"
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 /tmp/s_fix.mp4 | sort | tr '\n' ' ' | grep -q 'audio video' && ok "S14c 有声音轨（系统声音 / 麦克风）也一起整理" || bad "S14c 声音轨" "$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 /tmp/s_fix.mp4 | tr '\n' ' ')"
R=$(node -e "require('./src/mp4fix').finalizeMp4('/tmp/s_fix.mp4').then(r=>console.log(r.changed+'|'+r.reason))"); chk "S15 已经整理过的文件再整理：不动" "$R" "false|not fragmented"
# 整理到一半被打断（新 moov 已追加、旧 box 没改名）→ 再整理能修好
cp /tmp/s_raw.mp4 /tmp/s_half.mp4; tail -c +1 /tmp/s_fix.mp4 > /dev/null
node -e "
const fs=require('fs');const b=fs.readFileSync('/tmp/s_fix.mp4');let o=0,moov=null;while(o<b.length){const s=b.readUInt32BE(o),t=b.toString('latin1',o+4,o+8);if(t==='moov')moov=b.subarray(o,o+s);o+=s;}fs.appendFileSync('/tmp/s_half.mp4',moov);"
node -e "require('./src/mp4fix').finalizeMp4('/tmp/s_half.mp4').then(r=>console.log(JSON.stringify(r)))" >/dev/null
ffmpeg -v error -i /tmp/s_half.mp4 -map 0 -c copy -f framemd5 - 2>/dev/null | grep -v '^#' | awk -F', *' '{print $1,$2,$3,$5,$6}' > /tmp/s_half.pm
cmp -s /tmp/s_raw.pm /tmp/s_half.pm && ! boxes /tmp/s_half.mp4 | grep -q moof && ok "S16 整理到一半被打断：下次整理能修好，内容不变" || bad "S16 中断后重整理" "$(boxes /tmp/s_half.mp4)"
# 录到一半断电：文件末尾不完整
cp /tmp/s_raw.mp4 /tmp/s_cut.mp4; SZ=$(stat -c %s /tmp/s_cut.mp4); truncate -s $((SZ*2/3)) /tmp/s_cut.mp4
R=$(node -e "require('./src/mp4fix').finalizeMp4('/tmp/s_cut.mp4').then(r=>console.log(r.changed+'|'+r.truncated))")
DC=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/s_cut.mp4)
[ "$R" = "true|true" ] && awk "BEGIN{exit !($DC>1)}" && ! ffmpeg -v error -i /tmp/s_cut.mp4 -f null - 2>&1 | grep -v 'non monoton' | grep -q . && ok "S17 末尾不完整的文件：丢掉最后半段，前面的整理好能播（$DC 秒）" || bad "S17 截断文件" "$R dur=$DC"

# ---------------------------------------------------------------- 7 启动时恢复上次留下的 .part
clean
cp /tmp/s_raw.mp4 $VD/Hopsnap_20200101_000000.mp4.part
cp /tmp/s_raw.mp4 $VD/Hopsnap_20200101_000001.mp4.part; truncate -s 300000 $VD/Hopsnap_20200101_000001.mp4.part
: > $VD/Hopsnap_20200101_000002.mp4.part
kill $(cat /tmp/app.pid) 2>/dev/null; sleep 1; start_app 6
L=$(ls $VD | tr '\n' ' ')
[ -f $VD/Hopsnap_20200101_000000.mp4 ] && [ -f $VD/Hopsnap_20200101_000001.mp4 ] && ! echo "$L" | grep -q part && ok "S18 启动时把上次没保存完的 .part 整理好改回 .mp4，空的删掉（$L）" || bad "S18 恢复" "$L"
[ -f $VD/Hopsnap_20200101_000000.mp4 ] && ! boxes $VD/Hopsnap_20200101_000000.mp4 | grep -q moof && ok "S18b 恢复的文件也整理成普通 MP4" || bad "S18b 恢复整理" "$(boxes $VD/Hopsnap_20200101_000000.mp4)"
grep -q "NOTIFY 上次的录屏没有正常结束 | 已恢复录到的部分：Hopsnap_20200101_000000.mp4" /tmp/app.log && ok "S18c 恢复后通知" || bad "S18c 恢复通知" "$(grep NOTIFY /tmp/app.log | tail -2)"

# ---------------------------------------------------------------- 8 英文界面
kill $(cat /tmp/app.pid) 2>/dev/null; sleep 1; clean
cmd '{"cmd":"noop"}' 0
jq '.general.language="en"' /root/.config/Hopsnap/settings.json > /tmp/s.json && cp /tmp/s.json /root/.config/Hopsnap/settings.json
start_app 6
cmd '{"cmd":"recordFull"}' 1.5; wiggle 6; cmd '{"cmd":"stop"}' 2
R=$(EV evalBar "[document.getElementById('meta').textContent,document.getElementById('dFolder').textContent.trim(),document.getElementById('dPlay').textContent.trim(),document.getElementById('dClose').title].join('|')")
echo "$R" | grep -q '^"Saved · [0-9.]* [KM]B|Open folder|Play|Close"$' && ok "S19 英文界面：Saved / Open folder / Play / Close ($R)" || bad "S19 英文" "$R"

kill $(cat /tmp/app.pid) 2>/dev/null
echo; echo "== save 1.3.2: PASS=$PASS FAIL=$FAIL =="
printf '%s\n' "${RESULTS[@]}" > /tmp/save_results.txt
