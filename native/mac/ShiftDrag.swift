// Shift 拖的默认路径。必须是带 NSApplication 的真正 App，全局鼠标监视才会送达。
// osascript / JXA 不是默认路径。托盘拖放和快捷键是退路。
// 签名：打进 .app 之后，scripts/sign-mac.js 会跟其他 Mach-O 一起签。不要单独 ad-hoc 签名。
// 协议：一行一个 JSON。不读文件路径，不监听键盘。
import Cocoa

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

// Cocoa 的 y 轴从主屏幕左下角往上。翻成左上角原点时只用主屏幕 NSScreen.screens[0]，不用最高的那块。
func primaryTop() -> CGFloat {
    NSScreen.screens.first?.frame.maxY ?? 0
}

func flip(_ p: NSPoint) -> [String: Double] {
    ["x": Double(p.x), "y": Double(primaryTop() - p.y)]
}

func isFileDrag() -> Bool {
    let pb = NSPasteboard(name: .drag)
    let types = pb.types ?? []
    return types.contains(NSPasteboard.PasteboardType("public.file-url"))
        || types.contains(NSPasteboard.PasteboardType("NSFilenamesPboardType"))
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var tracking = false
    var shown = false
    var origin = NSPoint.zero

    func applicationDidFinishLaunching(_ notification: Notification) {
        emit(["type": "ready", "permission": "none", "ok": true])
        let mask: NSEvent.EventTypeMask = [.leftMouseDragged, .leftMouseUp]
        NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] ev in
            self?.handle(ev)
        }
    }

    func handle(_ ev: NSEvent) {
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
                let f = flip(p)
                emit(["type": "shift-drag", "x": f["x"]!, "y": f["y"]!])
            } else if shown {
                let f = flip(p)
                emit(["type": "move", "x": f["x"]!, "y": f["y"]!])
            }
        } else if ev.type == .leftMouseUp {
            if shown {
                let f = flip(p)
                emit(["type": "up", "x": f["x"]!, "y": f["y"]!])
            }
            shown = false
            tracking = false
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
