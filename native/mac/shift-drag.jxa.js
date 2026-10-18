// Mac 全局 Shift 拖。只看鼠标拖动事件上的 modifierFlags，以及拖拽剪贴板的 changeCount 和类型。
// 不读文件路径，不监听按键，所以不需要辅助功能或输入监控。
ObjC.import('Cocoa');

function emit(obj) {
  const line = JSON.stringify(obj) + '\n';
  const data = $.NSString.alloc.initWithString(line).dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

function screenTop() {
  let top = 0;
  const screens = $.NSScreen.screens;
  const n = screens.count;
  for (let i = 0; i < n; i++) {
    const f = screens.objectAtIndex(i).frame;
    const t = f.origin.y + f.size.height;
    if (t > top) top = t;
  }
  return top;
}

function flip(p) {
  return { x: p.x, y: screenTop() - p.y };
}

function isFileDrag() {
  const pb = $.NSPasteboard.pasteboardWithName('NSDragPboard');
  const types = pb.types;
  if (!types) return false;
  const n = types.count;
  for (let i = 0; i < n; i++) {
    const name = ObjC.unwrap(types.objectAtIndex(i));
    if (name === 'public.file-url' || name === 'NSFilenamesPboardType') return true;
  }
  return false;
}

emit({ type: 'ready', permission: 'none', ok: true });

const NSShiftKeyMask = 1 << 17;
const dragged = 6;
const up = 2;
let tracking = false;
let shown = false;
let origin = null;

// 全局鼠标监视（不含按键）不需要辅助功能。Shift 来自拖动事件自己的 modifierFlags。
$.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler((1 << dragged) | (1 << up), (ev) => {
  const type = ev.type;
  const loc = ev.locationInWindow;
  const p = flip({ x: loc.x, y: loc.y });
  const shift = (ev.modifierFlags & NSShiftKeyMask) !== 0;
  if (type === dragged) {
    if (!shift || !isFileDrag()) {
      if (shown) emit({ type: 'shift-up' });
      shown = false;
      tracking = false;
      return;
    }
    if (!tracking) { tracking = true; origin = p; shown = false; }
    const dist = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (!shown && dist >= 8) { shown = true; emit({ type: 'shift-drag', x: p.x, y: p.y }); }
    else if (shown) emit({ type: 'move', x: p.x, y: p.y });
  } else if (type === up) {
    if (shown) emit({ type: 'up', x: p.x, y: p.y });
    shown = false;
    tracking = false;
  }
});

$.NSRunLoop.currentRunLoop.run();
