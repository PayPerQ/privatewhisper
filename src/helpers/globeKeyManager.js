const { spawn, execSync } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const { macKeyCodeFromHotkey } = require("./hotkeyKeycodes");

class GlobeKeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isSupported = process.platform === "darwin";
    this.hasReportedError = false;
    this.globeOnly = true; // Default to globe-only mode (no Input Monitoring required)
    this.suppressKeycode = null; // Keycode to suppress (prevent default system action)
  }

  /**
   * Convert an Electron accelerator key to a macOS keycode.
   * Handles both simple keys ("A", "F1") and compound accelerators ("Ctrl+K").
   * @param {string} key - The key (e.g., "`", "A", "F1", "Shift+Space")
   * @returns {number|null} - The macOS keycode or null if not found
   */
  static keyToKeycode(key) {
    return macKeyCodeFromHotkey(key);
  }

  /**
   * Start the globe key listener.
   * @param {Object} options
   * @param {boolean} options.globeOnly - If true, only listen for Globe/Fn key (no Input Monitoring needed).
   *                                      If false, also listen for all keyDown/keyUp events (requires Input Monitoring).
   * @param {string} options.suppressKey - An Electron accelerator key to suppress (e.g., "`" for backtick).
   *                                       When set, the key's default system action will be prevented.
   */
  start(options = {}) {
    if (!this.isSupported || this.process) {
      return;
    }

    GlobeKeyManager.killAll();

    this.globeOnly = options.globeOnly !== false; // Default to true
    this.suppressKeycode = options.suppressKey
      ? GlobeKeyManager.keyToKeycode(options.suppressKey)
      : null;

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      this.reportError(
        new Error(
          "macOS Globe listener binary not found. Run `npm run compile:globe` before packaging.",
        ),
      );
      return;
    }

    try {
      fs.accessSync(listenerPath, fs.constants.X_OK);
    } catch (accessError) {
      this.reportError(
        new Error(`macOS Globe listener is not executable: ${listenerPath}`),
      );
      return;
    }

    this.hasReportedError = false;

    // Build spawn arguments
    const spawnArgs = [];
    if (this.globeOnly && !this.suppressKeycode) {
      // Globe-only mode: only listen for Globe/Fn key, no Input Monitoring needed
      spawnArgs.push("--globe-only");
    }
    if (this.suppressKeycode) {
      // Add suppress keycode argument to prevent default system action
      spawnArgs.push(`--suppress-keycode=${this.suppressKeycode}`);
    }
    const proc = spawn(listenerPath, spawnArgs);
    this.process = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line === "FN_DOWN") {
            this.emit("globe-down");
          } else if (line === "FN_UP") {
            this.emit("globe-up");
          } else if (line.startsWith("KEY_DOWN:")) {
            const keyCode = parseInt(line.replace("KEY_DOWN:", ""), 10);
            if (!Number.isNaN(keyCode)) {
              this.emit("key-down", keyCode);
            }
          } else if (line.startsWith("KEY_UP:")) {
            const keyCode = parseInt(line.replace("KEY_UP:", ""), 10);
            if (!Number.isNaN(keyCode)) {
              this.emit("key-up", keyCode);
            }
          }
        });
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message.length > 0) {
        console.error("GlobeKeyManager stderr:", message);
        this.reportError(new Error(message));
      }
    });

    // Guard exit/error handlers: ignore events from a stale process entirely.
    // Without this, a killed process's async exit handler would null the
    // reference to (or reportError-kill) a newer process spawned by restart().
    proc.on("error", (error) => {
      if (this.process !== proc) return;
      this.process = null;
      this.reportError(error);
    });

    proc.on("exit", (code, signal) => {
      if (this.process !== proc) return;
      this.process = null;
      if (code !== 0) {
        const error = new Error(
          `Globe key listener exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
        );
        this.reportError(error);
      }
    });
  }

  stop() {
    if (this.process) {
      const proc = this.process;
      this.process = null;

      // Send SIGTERM first (allows graceful cleanup)
      proc.kill("SIGTERM");

      // Force kill after 100ms if still running (ensures event tap is released)
      setTimeout(() => {
        try {
          // Check if process is still running by sending signal 0
          process.kill(proc.pid, 0);
          // Still running, force kill
          proc.kill("SIGKILL");
        } catch {
          // Process already exited, which is good
        }
      }, 100);
    }
  }

  /**
   * Restart the listener with new options.
   * Useful when settings change (e.g., switching between Globe key and other hotkeys).
   * @param {Object} options
   * @param {boolean} options.globeOnly - If true, only listen for Globe/Fn key.
   * @param {string} options.suppressKey - An Electron accelerator key to suppress.
   */
  restart(options = {}) {
    this.stop();
    this.hasReportedError = false;
    this.start(options);
  }

  /**
   * Check if currently running in globe-only mode.
   * Returns the current mode setting (true if not running).
   * @returns {boolean}
   */
  isGlobeOnlyMode() {
    return this.globeOnly;
  }

  /**
   * Get the current suppress keycode.
   * @returns {number|null}
   */
  getSuppressKeycode() {
    return this.suppressKeycode;
  }

  reportError(error) {
    if (this.hasReportedError) {
      return;
    }
    this.hasReportedError = true;
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      } finally {
        this.process = null;
      }
    }
    console.error("GlobeKeyManager error:", error);
    this.emit("error", error);
  }

  resolveListenerBinary() {
    // Build candidate paths in priority order
    const candidates = [];
    const archSuffix =
      process.arch === "arm64"
        ? "arm64"
        : process.arch === "x64"
          ? "x86_64"
          : process.arch;

    // Packaged app paths (check these first as they're most common in production)
    if (process.resourcesPath) {
      candidates.push(
        // Architecture-specific build (preferred when present)
        path.join(
          process.resourcesPath,
          "bin",
          `macos-globe-listener-${archSuffix}`,
        ),
        // Primary location after electron-builder extraResources fix
        path.join(process.resourcesPath, "bin", "macos-globe-listener"),
        // Legacy location (resources/bin nested path)
        path.join(
          process.resourcesPath,
          "resources",
          "bin",
          "macos-globe-listener",
        ),
        // Direct in resources
        path.join(process.resourcesPath, "macos-globe-listener"),
      );
    }

    // Development paths (relative to this file in src/helpers)
    candidates.push(
      path.join(
        __dirname,
        "..",
        "..",
        "resources",
        "bin",
        `macos-globe-listener-${archSuffix}`,
      ),
      path.join(
        __dirname,
        "..",
        "..",
        "resources",
        "bin",
        "macos-globe-listener",
      ),
      path.join(__dirname, "..", "..", "resources", "macos-globe-listener"),
    );

    for (const candidate of candidates) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  static killAll() {
    if (process.platform !== "darwin") return;
    try {
      execSync("pkill -f macos-globe-listener", {
        stdio: "ignore",
      });
    } catch {
      // Ignore when no matching process is found
    }
  }
}

module.exports = GlobeKeyManager;
