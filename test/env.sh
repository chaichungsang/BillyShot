export DISPLAY=:99
start_x() {
  [ -f /tmp/xvfb.pid ] && kill $(cat /tmp/xvfb.pid) 2>/dev/null; sleep 0.3
  Xvfb :99 -screen 0 1920x1080x24 >/tmp/xvfb.log 2>&1 & echo $! > /tmp/xvfb.pid
  sleep 1
  openbox >/tmp/openbox.log 2>&1 &
  sleep 0.6
  xcompmgr >/tmp/xcompmgr.log 2>&1 &
  sleep 0.4
  display -geometry +0+0 /home/claude/billyshot/test/bg.png >/dev/null 2>&1 &
  sleep 0.5
  display -geometry +300+200 -title "Sample" /home/claude/billyshot/test/sample.png >/dev/null 2>&1 &
  sleep 1
}
start_app() {
  [ -f /tmp/app.pid ] && kill $(cat /tmp/app.pid) 2>/dev/null; sleep 0.5
  cd /home/claude/billyshot
  env BILLYSHOT_TEST=1 BILLYSHOT_DEBUG=1 ${EXTRA_ENV} ${APP_BIN:-node_modules/.bin/electron --no-sandbox .} > /tmp/app.log 2>&1 & echo $! > /tmp/app.pid
  sleep ${1:-4}
}
export BILLYSHOT_TEST_CMD=/tmp/billyshot-cmd.json
cmd() { echo "$1" > /tmp/billyshot-cmd.json; sleep ${2:-1}; }
shot() { import -window root "$1" 2>/dev/null; }
applog() { grep -v -E "dbus|Fontconfig|libva|viz_main|gpu_init|ERROR:.*(bus|gl_|egl|vaapi|command_buffer)|Xlib|sandbox" /tmp/app.log | tail -${1:-30}; }
