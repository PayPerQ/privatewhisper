const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");

class GlobeKeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isSupported = process.platform === "darwin";
    this.hasReportedError = false;
    this.globeOnly = true; // Default to globe-only mode (no Input Monitoring required)
  }

  /**
   * Start the globe key listener.
   * @param {Object} options
   * @param {boolean} options.globeOnly - If true, only listen for Globe/Fn key (no Input Monitoring needed).
   *                                      If false, also listen for all keyDown/keyUp events (requires Input Monitoring).
   */
  start(options = {}) {
    if (!this.isSupported || this.process) {
      return;
    }

    this.globeOnly = options.globeOnly !== false; // Default to true

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

    // Build spawn arguments - add --globe-only flag if in globe-only mode
    const spawnArgs = this.globeOnly ? ["--globe-only"] : [];
    this.process = spawn(listenerPath, spawnArgs);

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
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

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message.length > 0) {
        console.error("GlobeKeyManager stderr:", message);
        this.reportError(new Error(message));
      }
    });

    this.process.on("error", (error) => {
      this.reportError(error);
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
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
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Restart the listener with new options.
   * Useful when settings change (e.g., switching between Globe key and other hotkeys).
   * @param {Object} options
   * @param {boolean} options.globeOnly - If true, only listen for Globe/Fn key.
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
}

module.exports = GlobeKeyManager;
