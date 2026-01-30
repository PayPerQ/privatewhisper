import Cocoa
import Foundation
import Darwin

// Check for --globe-only flag to limit monitoring to Globe/Fn key only
// This avoids requiring Input Monitoring permission when only Globe key PTT is needed
let globeOnly = CommandLine.arguments.contains("--globe-only")

// Check for --suppress-keycode=XX to suppress a specific keycode (prevents default system action)
var suppressKeycode: Int64? = nil
for arg in CommandLine.arguments {
    if arg.hasPrefix("--suppress-keycode=") {
        let value = arg.replacingOccurrences(of: "--suppress-keycode=", with: "")
        suppressKeycode = Int64(value)
    }
}

// Determine if we need to intercept (modify/suppress) events or just listen
// We need defaultTap (intercept mode) if:
// 1. globeOnly mode (to suppress globe key)
// 2. OR we have a keycode to suppress
let needsIntercept = globeOnly || suppressKeycode != nil

// In globe-only mode, we still need to listen for keyDown/keyUp to catch synthesized
// globe key events that might trigger the emoji picker
let mask: CGEventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) |
    CGEventMask(1 << CGEventType.keyDown.rawValue) |
    CGEventMask(1 << CGEventType.keyUp.rawValue)

var fnIsDown = false
var eventTap: CFMachPort?
let fnKeyCode: Int64 = 63

// Track if we need to dismiss emoji picker (safety mechanism)
var shouldDismissEmojiPicker = false
var lastFnUpTime: Date? = nil

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .keyDown || type == .keyUp {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

        // In globe-only mode, suppress any keyDown/keyUp for the Fn key itself
        // This catches synthesized key events that might trigger the emoji picker
        if globeOnly && keyCode == fnKeyCode {
            return nil
        }

        // Output key events (only in non-globe-only mode for regular key monitoring)
        if !globeOnly {
            let prefix = (type == .keyDown) ? "KEY_DOWN:" : "KEY_UP:"
            if let data = "\(prefix)\(keyCode)\n".data(using: .utf8) {
                FileHandle.standardOutput.write(data)
                fflush(stdout)
            }
        }

        // Suppress the key event if it matches the configured suppress keycode
        if let suppress = suppressKeycode, keyCode == suppress {
            return nil
        }
    }

    if type == .flagsChanged {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let containsFn = event.flags.contains(.maskSecondaryFn)

        if keyCode == fnKeyCode {
            if containsFn && !fnIsDown {
                fnIsDown = true
                FileHandle.standardOutput.write("FN_DOWN\n".data(using: .utf8)!)
                fflush(stdout)
                // In globe-only mode, suppress the event entirely to prevent emoji picker
                if globeOnly {
                    return nil
                }
            } else if !containsFn && fnIsDown {
                fnIsDown = false
                lastFnUpTime = Date()
                shouldDismissEmojiPicker = true
                FileHandle.standardOutput.write("FN_UP\n".data(using: .utf8)!)
                fflush(stdout)
                // In globe-only mode, suppress the event entirely to prevent emoji picker
                if globeOnly {
                    // Immediately dismiss emoji picker - don't wait
                    dismissEmojiPickerIfNeeded()
                    // Also schedule additional dismissals to catch late-spawning popover
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
                        shouldDismissEmojiPicker = true
                        dismissEmojiPickerIfNeeded()
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        shouldDismissEmojiPicker = true
                        dismissEmojiPickerIfNeeded()
                    }
                    return nil
                }
            }
        } else if globeOnly && containsFn {
            // For other keys pressed while Fn is held, strip the Fn flag
            // This prevents macOS from interpreting Fn+key combinations
            var newFlags = event.flags
            newFlags.remove(.maskSecondaryFn)
            event.flags = newFlags
        }
    }

    return Unmanaged.passUnretained(event)
}

/// Dismiss the emoji picker window if it appeared despite our suppression.
/// This is a safety mechanism to ensure the popover never stays visible.
func dismissEmojiPickerIfNeeded() {
    guard shouldDismissEmojiPicker else { return }
    shouldDismissEmojiPicker = false

    // Method 1: Kill CharacterPalette process immediately (most reliable)
    // This closes the emoji picker before it can fully render
    let killTask = Process()
    killTask.launchPath = "/usr/bin/killall"
    killTask.arguments = ["-9", "CharacterPalette"]
    killTask.standardOutput = FileHandle.nullDevice
    killTask.standardError = FileHandle.nullDevice
    try? killTask.run()

    // Method 2: Send Escape key to dismiss any popover (backup)
    if let escapeEvent = CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: true) {
        escapeEvent.post(tap: .cghidEventTap)
        if let escapeUp = CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: false) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
                escapeUp.post(tap: .cghidEventTap)
            }
        }
    }

    // Method 3: Kill again after a short delay in case it spawned late
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        let killTask2 = Process()
        killTask2.launchPath = "/usr/bin/killall"
        killTask2.arguments = ["-9", "CharacterPalette"]
        killTask2.standardOutput = FileHandle.nullDevice
        killTask2.standardError = FileHandle.nullDevice
        try? killTask2.run()
    }
}

// Try HID-level tap first (intercepts events earlier in the chain, before system handlers)
// Fall back to session-level tap if HID tap fails (HID tap may require elevated privileges)
var createdTap: CFMachPort? = nil

// First attempt: HID-level event tap (highest priority, intercepts before system sees events)
createdTap = CGEvent.tapCreate(tap: .cghidEventTap,
                               place: .headInsertEventTap,
                               options: needsIntercept ? .defaultTap : .listenOnly,
                               eventsOfInterest: mask,
                               callback: eventTapCallback,
                               userInfo: nil)

if createdTap == nil {
    // Fallback: Session-level event tap (still effective with Accessibility permission)
    createdTap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                   place: .headInsertEventTap,
                                   options: needsIntercept ? .defaultTap : .listenOnly,
                                   eventsOfInterest: mask,
                                   callback: eventTapCallback,
                                   userInfo: nil)
}

guard let finalTap = createdTap else {
    FileHandle.standardError.write("Failed to create event tap\n".data(using: .utf8)!)
    exit(1)
}

eventTap = finalTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, finalTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: finalTap, enable: true)

let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    CFRunLoopStop(CFRunLoopGetCurrent())
}
signalSource.resume()

CFRunLoopRun()
