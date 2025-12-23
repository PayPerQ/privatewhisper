import Cocoa
import Foundation
import Darwin

let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) |
           CGEventMask(1 << CGEventType.keyDown.rawValue) |
           CGEventMask(1 << CGEventType.keyUp.rawValue)
var fnIsDown = false
var eventTap: CFMachPort?

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .keyDown || type == .keyUp {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let prefix = (type == .keyDown) ? "KEY_DOWN:" : "KEY_UP:"
        if let data = "\(prefix)\(keyCode)\n".data(using: .utf8) {
            FileHandle.standardOutput.write(data)
            fflush(stdout)
        }
    }

    let flags = event.flags
    let containsFn = flags.contains(.maskSecondaryFn)

    if containsFn && !fnIsDown {
        fnIsDown = true
        FileHandle.standardOutput.write("FN_DOWN\n".data(using: .utf8)!)
        fflush(stdout)
    } else if !containsFn && fnIsDown {
        fnIsDown = false
        FileHandle.standardOutput.write("FN_UP\n".data(using: .utf8)!)
        fflush(stdout)
    }

    return Unmanaged.passUnretained(event)
}

guard let createdTap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                         place: .headInsertEventTap,
                                         options: .listenOnly,
                                         eventsOfInterest: mask,
                                         callback: eventTapCallback,
                                         userInfo: nil) else {
    FileHandle.standardError.write("Failed to create event tap\n".data(using: .utf8)!)
    exit(1)
}

eventTap = createdTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: createdTap, enable: true)

let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    CFRunLoopStop(CFRunLoopGetCurrent())
}
signalSource.resume()

CFRunLoopRun()
