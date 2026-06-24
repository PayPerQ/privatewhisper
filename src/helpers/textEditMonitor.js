const { spawn, execFile } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const debugLogger = require("./debugLogger");

const POLL_INTERVAL_MS = 500;
const INITIAL_QUERY_DELAY_MS = 500; // Wait for paste to settle in target app
const INITIAL_QUERY_RETRIES = 4; // Retry if AXValue is empty (paste not yet processed)
const INITIAL_QUERY_RETRY_DELAY_MS = 300;

const log = (event, details = {}) =>
  debugLogger.logEvent("text-edit-monitor", event, details, "debug");

// AppleScript to enable AXEnhancedUserInterface on the target app.
// Chromium-based apps (Chrome, Electron, VS Code, Slack, etc.) don't build their
// accessibility tree until an assistive technology announces itself via this attribute.
const MACOS_AX_ENABLE_SCRIPT = (pid) =>
  `tell application "System Events"\n` +
  `\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\ttry\n` +
  `\t\tset value of attribute "AXEnhancedUserInterface" of targetProc to true\n` +
  `\tend try\n` +
  `end tell`;

// AppleScript to read the focused text field value from a specific app by PID.
// Using PID avoids the problem where the Electron overlay is "frontmost".
const MACOS_AX_SCRIPT_BY_PID = (pid) =>
  `tell application "System Events"\n` +
  `\tset targetProc to first application process whose unix id is ${pid}\n` +
  `\tset focAttr to value of attribute "AXFocusedUIElement" of targetProc\n` +
  `\tif focAttr is missing value then return ""\n` +
  `\ttry\n` +
  `\t\tset val to value of attribute "AXValue" of focAttr\n` +
  `\t\tif val is not missing value and val is not "" then return val\n` +
  `\tend try\n` +
  `\ttry\n` +
  `\t\tset charCount to value of attribute "AXNumberOfCharacters" of focAttr\n` +
  `\t\tif charCount is greater than 0 then\n` +
  `\t\t\treturn value of attribute "AXSelectedText" of focAttr\n` +
  `\t\tend if\n` +
  `\tend try\n` +
  `\treturn ""\n` +
  `end tell`;

class TextEditMonitor extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.currentOriginalText = null;
    this.timeout = null;
    this._pollInterval = null;
    this._lastValue = null;
    this._stdoutBuffer = "";
    this.lastTargetPid = null;
  }

  /**
   * macOS: capture the active app's PID via NSWorkspace before the overlay steals focus.
   * Must be called at hotkey press time, BEFORE showDictationPanel()/mainWindow.show().
   */
  captureTargetPid() {
    if (process.platform !== "darwin") return;
    const script =
      'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier';
    execFile("osascript", ["-l", "JavaScript", "-e", script], { timeout: 2000 }, (err, stdout) => {
      if (err) {
        this.lastTargetPid = null;
      } else {
        const pid = parseInt(stdout.trim(), 10);
        this.lastTargetPid = isNaN(pid) ? null : pid;
      }
      log("captured-target-pid", { pid: this.lastTargetPid });
    });
  }

  /**
   * Start monitoring the focused text field for edits after a paste.
   * Kills any existing monitor before starting a new one.
   * @param {string} originalText - The transcribed text that was pasted
   * @param {number} timeoutMs - How long to monitor (default 30s)
   */
  startMonitoring(originalText, timeoutMs = 30000, options = {}) {
    this.stopMonitoring();
    this.currentOriginalText = originalText;

    if (process.platform === "darwin") {
      const resolved = this.resolveBinary();
      if (resolved) {
        this._startMacOSNative(originalText, timeoutMs, options.targetPid, resolved);
        return;
      }
      this._startMacOSPolling(originalText, timeoutMs, options.targetPid);
      return;
    }

    const resolved = this.resolveBinary();
    if (!resolved) {
      log("no-binary-found", { platform: process.platform });
      this.currentOriginalText = null;
      return;
    }

    const { command, args } = resolved;
    log("resolved-binary", { command, args });

    // For native binaries, verify executable permission
    if (command !== "python3") {
      try {
        fs.accessSync(command, fs.constants.X_OK);
      } catch {
        log("binary-not-executable", { command });
        this.currentOriginalText = null;
        return;
      }
    }

    log("spawning-monitor", { textLength: originalText.length });

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send original text via stdin
    this.process.stdin.write(originalText + "\n");
    this.process.stdin.end();

    this._stdoutBuffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      log("stdout", { data: chunk.trim() });
      this._handleProcessStdoutChunk(chunk);
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      log("stderr", { data: data.trim() });
    });

    this.process.on("error", (err) => {
      log("process-error", { error: err.message });
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
      log("process-exited", { code, signal });
      this.process = null;
    });

    // Safety net timeout (binary also self-exits after its own timeout)
    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  stopMonitoring() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    this._lastValue = null;
    this._stdoutBuffer = "";
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      }
      this.process = null;
    }
    this.currentOriginalText = null;
  }

  _handleProcessStdoutChunk(chunk) {
    this._stdoutBuffer += chunk;
    const lines = this._stdoutBuffer.split(/\r?\n/);
    this._stdoutBuffer = lines.pop() || "";

    for (const rawLine of lines) {
      if (!rawLine) continue;
      this._handleProcessLine(rawLine);
    }
  }

  _decodeBase64Payload(encoded) {
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
      log("base64-decode-failed", { error: error.message });
      return null;
    }
  }

  _emitTextEdited(newFieldValue) {
    if (typeof newFieldValue !== "string" || this.currentOriginalText === null) {
      return;
    }

    log("text-changed", { newFieldValueLength: newFieldValue.length });
    this.emit("text-edited", {
      originalText: this.currentOriginalText,
      newFieldValue,
    });
  }

  _handleProcessLine(line) {
    if (line.startsWith("CHANGED_B64:")) {
      const decoded = this._decodeBase64Payload(line.slice("CHANGED_B64:".length));
      if (decoded !== null) {
        this._emitTextEdited(decoded);
      }
      return;
    }

    if (line.startsWith("CHANGED:")) {
      this._emitTextEdited(line.slice("CHANGED:".length));
      return;
    }

    if (line === "NO_ELEMENT" || line === "NO_VALUE") {
      log("no-target-element", { status: line });
      this.stopMonitoring();
    }
  }

  /**
   * macOS: tell the target app that an assistive technology is present.
   * This causes Chromium/Electron apps to build their accessibility tree.
   */
  _enableAccessibility(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_ENABLE_SCRIPT(pid);
      execFile("osascript", ["-e", script], { timeout: 3000 }, (err) => {
        if (err) {
          log("ax-enhanced-ui-failed", { error: err.message });
        } else {
          log("ax-enhanced-ui-enabled", { pid });
        }
        resolve();
      });
    });
  }

  /**
   * macOS: use the native Swift AXObserver binary for event-based text monitoring.
   * Falls back to osascript polling if the binary fails to start.
   */
  async _startMacOSNative(originalText, timeoutMs, targetPid, resolved) {
    if (!targetPid) {
      log("macos-native-no-pid");
      this.stopMonitoring();
      return;
    }

    log("macos-native-starting", {
      targetPid,
      textLength: originalText.length,
    });

    await this._enableAccessibility(targetPid);
    if (this.currentOriginalText === null) return;

    await new Promise((r) => setTimeout(r, INITIAL_QUERY_DELAY_MS));
    if (this.currentOriginalText === null) return;

    const { command, args } = resolved;

    try {
      fs.accessSync(command, fs.constants.X_OK);
    } catch {
      log("macos-native-not-executable-fallback", { command });
      this._startMacOSPolling(originalText, timeoutMs, targetPid);
      return;
    }

    this.process = spawn(command, [...args, String(targetPid)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdin.write(originalText + "\n");
    this.process.stdin.end();

    this._stdoutBuffer = "";
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      log("stdout", { data: chunk.trim() });
      this._handleProcessStdoutChunk(chunk);
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      log("stderr", { data: data.trim() });
    });

    this.process.on("error", (err) => {
      log("macos-native-error-fallback", { error: err.message });
      this.process = null;
      if (this.currentOriginalText === null) return;
      this._startMacOSPolling(originalText, timeoutMs, targetPid);
    });

    this.process.on("exit", (code, signal) => {
      log("process-exited", { code, signal });
      this.process = null;
    });

    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  /**
   * macOS: query the focused text field value via osascript for a specific app PID.
   * Returns the field value string, or null on error.
   */
  _queryMacOSValue(pid) {
    return new Promise((resolve) => {
      const script = MACOS_AX_SCRIPT_BY_PID(pid);
      execFile("osascript", ["-e", script], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve(null);
        } else {
          resolve(stdout.replace(/\n$/, ""));
        }
      });
    });
  }

  /**
   * macOS: poll the focused text field for changes using osascript.
   * Uses Apple-signed osascript binary which inherits accessibility trust.
   */
  _startMacOSPolling(originalText, timeoutMs, targetPid) {
    if (!targetPid) {
      log("macos-polling-no-pid");
      this.stopMonitoring();
      return;
    }

    log("macos-polling-starting", {
      targetPid,
      textLength: originalText.length,
    });

    this._enableAccessibility(targetPid).then(() => {
      if (this.currentOriginalText === null) return;
      setTimeout(
        () => this._queryInitialValue(targetPid, originalText, timeoutMs),
        INITIAL_QUERY_DELAY_MS
      );
    });
  }

  /**
   * Query the initial AXValue with retries. The target app may not have processed
   * the pasted text yet, so an empty value is retried a few times before giving up.
   */
  async _queryInitialValue(targetPid, originalText, timeoutMs, attempt = 1) {
    if (this.currentOriginalText === null) return;

    const initialValue = await this._queryMacOSValue(targetPid);
    if (this.currentOriginalText === null) return;

    if (initialValue === null) {
      log("macos-no-focused-element");
      this.stopMonitoring();
      return;
    }

    if (!initialValue) {
      if (attempt < INITIAL_QUERY_RETRIES) {
        log("macos-axvalue-empty-retrying", {
          attempt,
          maxRetries: INITIAL_QUERY_RETRIES,
        });
        setTimeout(
          () => this._queryInitialValue(targetPid, originalText, timeoutMs, attempt + 1),
          INITIAL_QUERY_RETRY_DELAY_MS
        );
        return;
      }
      log("macos-no-text-after-retries");
      this.stopMonitoring();
      return;
    }

    this._lastValue = initialValue;
    log("macos-initial-value", {
      valueLength: initialValue.length,
      attempt,
    });

    this._pollInterval = setInterval(async () => {
      const currentValue = await this._queryMacOSValue(targetPid);
      if (this.currentOriginalText === null) return;

      if (currentValue === null) {
        log("macos-lost-focused-element");
        this.stopMonitoring();
        return;
      }

      if (currentValue !== this._lastValue) {
        this._lastValue = currentValue;
        log("macos-text-changed", {
          newValueLength: currentValue.length,
        });
        this.emit("text-edited", {
          originalText: this.currentOriginalText,
          newFieldValue: currentValue,
        });
      }
    }, POLL_INTERVAL_MS);

    this.timeout = setTimeout(() => this.stopMonitoring(), timeoutMs);
  }

  /**
   * Resolve the platform-specific binary.
   * Returns { command, args } or null if unavailable.
   */
  resolveBinary() {
    const platform = process.platform;

    if (platform === "linux") {
      const nativePath = this._findFile("linux-text-monitor");
      if (nativePath) return { command: nativePath, args: [] };
      const scriptPath = this._findFile("linux-text-monitor.py");
      return scriptPath ? { command: "python3", args: [scriptPath] } : null;
    }

    if (platform === "win32") {
      const binaryPath = this._findFile("windows-text-monitor.exe");
      return binaryPath ? { command: binaryPath, args: [] } : null;
    }

    if (platform === "darwin") {
      const nativePath = this._findFile("macos-text-monitor");
      if (nativePath) return { command: nativePath, args: [] }; // PID added at spawn time
      return null;
    }

    return null;
  }

  _findFile(fileName) {
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", fileName),
      path.join(__dirname, "..", "..", "resources", fileName),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, fileName),
        path.join(process.resourcesPath, "bin", fileName),
        path.join(process.resourcesPath, "resources", fileName),
        path.join(process.resourcesPath, "resources", "bin", fileName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", fileName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", fileName),
      ].forEach((c) => candidates.add(c));
    }

    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }
}

module.exports = TextEditMonitor;
