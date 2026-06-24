const { clipboard } = require("electron");
const { spawn } = require("child_process");
const debugLogger = require("./debugLogger");
const { PlatformDetector } = require("../utils/PlatformDetector");
const { TIMING_CONFIG } = require("../config/timing");

class ClipboardManager {
  constructor() {
    this.accessibilityStatus = { checked: false, granted: false };
  }

  safeLog(event, details = {}) {
    debugLogger.logEvent("clipboard", event, details, "debug");
  }

  async ensureAccessibilityPermissions() {
    if (!PlatformDetector.isMacOS()) {
      return true;
    }

    if (this.accessibilityStatus.checked) {
      return this.accessibilityStatus.granted;
    }

    this.safeLog("accessibility-check");
    const hasPermissions = await this.checkAccessibilityPermissions();
    this.accessibilityStatus = { checked: true, granted: hasPermissions };
    this.safeLog(hasPermissions ? "accessibility-ok" : "accessibility-missing");
    return hasPermissions;
  }

  async pasteText(text) {
    try {
      // Save original clipboard content first
      const originalClipboard = clipboard.readText();
      // this.safeLog("original-buffered", {
      //   preview: originalClipboard.substring(0, 50),
      //   length: originalClipboard.length,
      // });

      // Copy text to clipboard first - this always works
      clipboard.writeText(text);
      this.safeLog("text-copied", {
        length: text.length,
      });

      if (PlatformDetector.isMacOS()) {
        const hasPermissions = await this.ensureAccessibilityPermissions();
        if (!hasPermissions) {
          const errorMsg =
            "Accessibility permissions required for automatic pasting. Text has been copied to clipboard - please paste manually with Cmd+V.";
          throw new Error(errorMsg);
        }

        return await this.pasteMacOS(originalClipboard);
      } else if (PlatformDetector.isWindows()) {
        return await this.pasteWindows(originalClipboard);
      } else {
        return await this.pasteLinux(originalClipboard);
      }
    } catch (error) {
      this.safeLog("paste-error", {
        error: error.message,
        platform: PlatformDetector.current,
      });
      throw error;
    }
  }

  async pasteMacOS(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;

        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          this.safeLog("paste-success", { method: "system-events" });
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, TIMING_CONFIG.CLIPBOARD_RESTORE_DELAY);
          resolve();
        } else {
          const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();
        const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
        reject(new Error(errorMsg));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        pasteProcess.kill("SIGKILL");
        pasteProcess.removeAllListeners();
        const errorMsg =
          "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V.";
        reject(new Error(errorMsg));
      }, TIMING_CONFIG.PASTE_TIMEOUT);
    });
  }

  async pasteWindows(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // Text pasted successfully
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, TIMING_CONFIG.CLIPBOARD_RESTORE_DELAY);
          resolve();
        } else {
          reject(
            new Error(
              `Windows paste failed with code ${code}. Text is copied to clipboard.`,
            ),
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Windows paste failed: ${error.message}. Text is copied to clipboard.`,
          ),
        );
      });
    });
  }

  async pasteLinux(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("xdotool", ["key", "ctrl+v"]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // Text pasted successfully
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, TIMING_CONFIG.CLIPBOARD_RESTORE_DELAY);
          resolve();
        } else {
          reject(
            new Error(
              `Linux paste failed with code ${code}. Text is copied to clipboard.`,
            ),
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Linux paste failed: ${error.message}. Text is copied to clipboard.`,
          ),
        );
      });
    });
  }

  async checkAccessibilityPermissions(options = {}) {
    const { silent = false } = options;
    if (!PlatformDetector.isMacOS()) return true;

    return new Promise((resolve) => {
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testError = "";

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          if (!silent) {
            this.showAccessibilityDialog(testError);
          }
          resolve(false);
        }
      });

      testProcess.on("error", () => {
        resolve(false);
      });
    });
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 PPQ Whisper needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled PPQ Whisper, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "PPQ Whisper" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW PPQ Whisper app
5. Make sure the checkbox is enabled
6. Restart PPQ Whisper

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
    } else {
      dialogMessage = `🔒 PPQ Whisper needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add PPQ Whisper to the list and check the box
5. Restart PPQ Whisper

⚠️ Without this permission, dictated text will only be copied to clipboard but won't paste automatically.

💡 In production builds, this permission is required for full functionality.

Would you like to open System Settings now?`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} default button "Open System Settings"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", () => {
      // Permission dialog error - user will need to manually grant permissions
    });
  }

  openSystemSettings() {
    // Use AppleScript to open System Settings directly to Accessibility pane
    // This is more reliable across macOS versions than URL schemes
    const script = `
      tell application "System Settings"
        activate
        delay 0.5
        reveal anchor "Privacy_Accessibility" of pane id "com.apple.settings.PrivacySecurity.extension"
      end tell
    `;

    const appleScriptProcess = spawn("osascript", ["-e", script]);

    appleScriptProcess.on("close", (code) => {
      if (code !== 0) {
        // Fallback for older macOS versions (pre-Ventura) using System Preferences
        const legacyScript = `
          tell application "System Preferences"
            activate
            set current pane to pane "com.apple.preference.security"
            reveal anchor "Privacy_Accessibility" of pane id "com.apple.preference.security"
          end tell
        `;

        const legacyProcess = spawn("osascript", ["-e", legacyScript]);

        legacyProcess.on("close", (legacyCode) => {
          if (legacyCode !== 0) {
            // Final fallback: try URL scheme
            spawn("open", [
              "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ]).on("error", () => {
              // Last resort: just open System Settings/Preferences
              spawn("open", ["-a", "System Settings"]).on("error", () => {
                spawn("open", ["-a", "System Preferences"]);
              });
            });
          }
        });
      }
    });

    appleScriptProcess.on("error", () => {
      // If osascript fails entirely, try URL scheme directly
      spawn("open", [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      ]);
    });
  }

  readClipboard() {
    return clipboard.readText();
  }

  writeClipboard(text) {
    clipboard.writeText(text);
    return { success: true };
  }
}

module.exports = ClipboardManager;
