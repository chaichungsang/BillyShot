// 可选。Billy 在 Mac 上编译后放进 .app，签名脚本会连同整个包一起签。
// 没有这个二进制时，用同目录的 shift-drag.jxa.js（osascript，不是 Mach-O）。
// 协议和 JXA 一样：一行一个 JSON。不读文件路径，不监听键盘。
import Cocoa

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func screenTop() -> CGFloat {
    NSScreen.screens.map { $0.frame.maxY }.max() ?? 0
}

func flip(_ p: NSPoint) -> [String: Double] {
    ["x": Double(p.x), "y": Double(screenTop() - p.y)]
}

func isFileDrag() -> Bool {
    let pb = NSPasteboard(name: .drag)
    let types = pb.types ?? []
    return types.contains(NSPasteboard.PasteboardType("public.file-url"))
        || types.contains(NSPasteboard.PasteboardType("NSFilenamesPboardType"))
}

emit(["type": "ready", "permission": "none", "ok": true])

let mask: NSEvent.EventTypeMask = [.leftMouseDragged, .leftMouseUp]
var tracking = false
var shown = false
var origin = NSPoint.zero
NSEvent.addGlobalMonitorForEvents(matching: mask) { ev in
    let p = ev.locationInWindow
    let shift = ev.modifierFlags.contains(.shift)
    if ev.type == .leftMouseDragged {
        if !shift || !isFileDrag() {
            if shown { emit(["type": "shift-up"]) }
            shown = false
            tracking = false
            return
        }
        if !tracking { tracking = true; origin = p; shown = false }
        let dist = hypot(p.x - origin.x, p.y - origin.y)
        if !shown && dist >= 8 {
            shown = true
            emit(["type": "shift-drag", "x": flip(p)["x"]!, "y": flip(p)["y"]!])
        } else if shown {
            emit(["type": "move", "x": flip(p)["x"]!, "y": flip(p)["y"]!])
        }
    } else if ev.type == .leftMouseUp {
        if shown { emit(["type": "up", "x": flip(p)["x"]!, "y": flip(p)["y"]!]) }
        shown = false
        tracking = false
    }
}
RunLoop.current.run()
