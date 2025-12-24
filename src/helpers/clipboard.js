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
      this.safeLog("original-buffered", {
        preview: originalClipboard.substring(0, 50),
        length: originalClipboard.length,
      });

      // Copy text to clipboard first - this always works
      clipboard.writeText(text);
      this.safeLog("text-copied", {
        preview: text.substring(0, 50),
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
        platform: PlatformDetector.current
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

      let errorOutput = "";
      let hasTimedOut = false;

      pasteProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;

        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          this.safeLog("paste-success", { method: "system-events" });
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
            this.safeLog("clipboard-restored");
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
              `Windows paste failed with code ${code}. Text is copied to clipboard.`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Windows paste failed: ${error.message}. Text is copied to clipboard.`
          )
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
              `Linux paste failed with code ${code}. Text is copied to clipboard.`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Linux paste failed: ${error.message}. Text is copied to clipboard.`
          )
        );
      });
    });
  }

  async checkAccessibilityPermissions() {
    if (!PlatformDetector.isMacOS()) return true;

    return new Promise((resolve) => {
      // Check accessibility permissions

      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testOutput = "";
      let testError = "";

      testProcess.stdout.on("data", (data) => {
        testOutput += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          this.showAccessibilityDialog(testError);
          resolve(false);
        }
      });

      testProcess.on("error", (error) => {
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
      dialogMessage = `🔒 PPQ Voice needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled PPQ Voice, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "PPQ Voice" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW PPQ Voice app
5. Make sure the checkbox is enabled
6. Restart PPQ Voice

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
    } else {
      dialogMessage = `🔒 PPQ Voice needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add PPQ Voice to the list and check the box
5. Restart PPQ Voice

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

    permissionDialog.on("error", (error) => {
      // Permission dialog error - user will need to manually grant permissions
    });
  }

  openSystemSettings() {
    const settingsCommands = [
      [
        "open",
        [
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ],
      ],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        // All settings commands failed, try fallback
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {
            // Could not open settings app
          });
        });
      }
    };

    tryNextCommand();
  }

  async readClipboard() {
    try {
      const text = clipboard.readText();
      return text;
    } catch (error) {
      throw error;
    }
  }

  async writeClipboard(text) {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ClipboardManager;
