const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EventEmitter = require("events");
const {
  findAvailablePort,
  resolveBinaryPath,
  gracefulStopProcess,
} = require("../utils/serverUtils");
const { killProcess } = require("../utils/process");
const debugLogger = require("./gemmaLogger");

/**
 * Returns actually-available memory in bytes.
 *
 * On macOS, `os.freemem()` only counts completely-unused pages — it ignores
 * inactive/speculative/purgeable pages that the OS will evict on demand. A
 * Mac with 32 GB physical RAM routinely reports 1–2 GB "free". For a user-
 * facing pre-flight check we want the number Activity Monitor would show as
 * "available", which is free + inactive + speculative + purgeable.
 */
function getAvailableMemoryBytes() {
  if (process.platform !== "darwin") {
    return os.freemem();
  }
  try {
    const stdout = execFileSync("vm_stat", { encoding: "utf8", timeout: 2000 });
    const pageMatch = stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageMatch ? parseInt(pageMatch[1], 10) : 16384;
    const pagesOf = (label) => {
      const m = stdout.match(new RegExp(`Pages ${label}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) : 0;
    };
    const reclaimablePages =
      pagesOf("free") +
      pagesOf("inactive") +
      pagesOf("speculative") +
      pagesOf("purgeable");
    return reclaimablePages * pageSize;
  } catch {
    return os.freemem();
  }
}

const PORT_RANGE_START = 6050;
const PORT_RANGE_END = 6069;
const DEFAULT_PORT = 6050;
const STARTUP_TIMEOUT_MS = 90_000;
const HEALTH_POLL_INTERVAL_MS = 500;
const LIVENESS_INTERVAL_MS = 30_000;
const LIVENESS_FAILURE_THRESHOLD = 3;
const MAX_RESTART_ATTEMPTS = 3;
const MIN_FREE_RAM_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB

function clampThreads(count) {
  const cpuCount = Math.max(1, os.cpus().length);
  return Math.max(2, Math.min(8, Math.floor(cpuCount * 0.75)));
}

function getBinaryName() {
  const key = `${process.platform}-${process.arch}`;
  return process.platform === "win32"
    ? `llama-server-${key}.exe`
    : `llama-server-${key}`;
}

class GemmaServerProcess extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.port = null;
    this.ready = false;
    this.starting = false;
    this.modelName = null;
    this.modelPath = null;
    this.startupPromise = null;
    this.livenessInterval = null;
    this.livenessFailures = 0;
    this.restartAttempts = 0;
    this.lastError = null;
    this.cachedBinaryPath = null;
    this.idleTimer = null;
    this.idleShutdownMs = null;
    this.lastUsedTime = 0;
  }

  getBinaryPath() {
    if (this.cachedBinaryPath) return this.cachedBinaryPath;
    const resolved = resolveBinaryPath(getBinaryName());
    if (resolved) this.cachedBinaryPath = resolved;
    return resolved;
  }

  clearBinaryCache() {
    this.cachedBinaryPath = null;
  }

  isAvailable() {
    return this.getBinaryPath() !== null;
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      ready: this.ready,
      running: this.ready && this.process !== null,
      starting: this.starting,
      port: this.port || DEFAULT_PORT,
      modelName: this.modelName,
      error: this.lastError,
    };
  }

  _setReady(value) {
    const prev = this.ready;
    this.ready = value;
    if (prev !== value) {
      this.emit("status-changed", this.getStatus());
    }
  }

  _broadcast() {
    this.emit("status-changed", this.getStatus());
  }

  setIdleShutdown(enabledMs) {
    // enabledMs is the timeout in ms, or null/0 to disable
    this.idleShutdownMs = enabledMs && enabledMs > 0 ? enabledMs : null;
    if (!this.idleShutdownMs) {
      this._clearIdleTimer();
    } else if (this.ready) {
      this._resetIdleTimer();
    }
  }

  /**
   * Call this on every inbound cleanup request so the idle timer resets.
   * Renderer invokes via `notifyGemmaActivity()` from ReasoningService.
   */
  notifyActivity() {
    this.lastUsedTime = Date.now();
    if (this.ready && this.idleShutdownMs) {
      this._resetIdleTimer();
    }
  }

  _resetIdleTimer() {
    this._clearIdleTimer();
    if (!this.idleShutdownMs || !this.ready) return;
    this.idleTimer = setTimeout(() => {
      debugLogger.info("Gemma server idle shutdown fired", {
        idleMs: this.idleShutdownMs,
      });
      this.stop().catch((err) =>
        debugLogger.warn("Idle shutdown stop failed", { error: err.message }),
      );
    }, this.idleShutdownMs);
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async start(modelName, modelPath) {
    if (this.startupPromise) return this.startupPromise;
    if (this.ready && this.modelName === modelName) {
      return { success: true, port: this.port };
    }
    if (this.process) await this.stop();

    this.startupPromise = this._doStart(modelName, modelPath);
    try {
      return await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart(modelName, modelPath) {
    const binary = this.getBinaryPath();
    if (!binary) {
      const err = new Error("llama-server binary not found");
      this.lastError = err.message;
      this._broadcast();
      throw err;
    }
    if (!fs.existsSync(modelPath)) {
      const err = new Error(`Gemma model file not found: ${modelPath}`);
      this.lastError = err.message;
      this._broadcast();
      throw err;
    }

    const available = getAvailableMemoryBytes();
    const total = os.totalmem();
    // Block only when the machine genuinely can't fit the model. macOS will
    // evict file cache on demand, so "available" (free + inactive + speculative
    // + purgeable) is the realistic number — not os.freemem().
    if (total < MIN_FREE_RAM_BYTES) {
      const err = new Error(
        `This machine has only ${(total / 1024 / 1024 / 1024).toFixed(
          1,
        )} GB of total RAM. Local Gemma needs at least 4 GB total and ~4.5 GB resident while running.`,
      );
      this.lastError = err.message;
      this._broadcast();
      throw err;
    }
    if (available < MIN_FREE_RAM_BYTES) {
      const err = new Error(
        `Only ${(available / 1024 / 1024 / 1024).toFixed(
          1,
        )} GB of RAM is currently available. Close some apps and try again — Local Gemma needs ~3 GB free to load (~4.5 GB resident).`,
      );
      this.lastError = err.message;
      this._broadcast();
      throw err;
    }

    this.starting = true;
    this.lastError = null;
    this.modelName = modelName;
    this.modelPath = modelPath;
    this._broadcast();

    try {
      this.port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
    } catch {
      this.port = DEFAULT_PORT;
    }

    const args = [
      "-m",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(this.port),
      "--ctx-size",
      "8192",
      "--threads",
      String(clampThreads()),
      "--no-warmup",
    ];

    debugLogger.info("Starting llama-server", {
      binary,
      port: this.port,
      modelName,
      modelPath,
      threads: clampThreads(),
    });

    const spawnEnv = { ...process.env };
    const binaryDir = path.dirname(binary);
    if (process.platform === "darwin") {
      spawnEnv.DYLD_LIBRARY_PATH = binaryDir + (spawnEnv.DYLD_LIBRARY_PATH ? `:${spawnEnv.DYLD_LIBRARY_PATH}` : "");
    } else if (process.platform === "linux") {
      spawnEnv.LD_LIBRARY_PATH = binaryDir + (spawnEnv.LD_LIBRARY_PATH ? `:${spawnEnv.LD_LIBRARY_PATH}` : "");
    } else if (process.platform === "win32") {
      spawnEnv.PATH = binaryDir + (spawnEnv.PATH ? `;${spawnEnv.PATH}` : "");
    }

    this.process = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: spawnEnv,
    });

    let stderrBuffer = "";

    this.process.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) debugLogger.debug("llama-server stdout", { data: msg.slice(0, 300) });
    });

    this.process.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderrBuffer += chunk;
      if (stderrBuffer.length > 20000) {
        stderrBuffer = stderrBuffer.slice(-20000);
      }
      const msg = chunk.trim();
      if (msg) debugLogger.debug("llama-server stderr", { data: msg.slice(0, 300) });
    });

    this.process.on("error", (error) => {
      debugLogger.error("llama-server process error", { error: error.message });
      this.lastError = error.message;
      this._setReady(false);
    });

    this.process.on("close", (code) => {
      debugLogger.info("llama-server process exited", { code });
      const wasReady = this.ready;
      this._setReady(false);
      this._clearLiveness();
      this._clearIdleTimer();
      this.process = null;
      if (wasReady && !this.starting) {
        this._handleUnexpectedExit();
      }
    });

    // Poll /health until ready or timeout
    try {
      await this._waitForHealthy();
      this.starting = false;
      this.restartAttempts = 0;
      this._setReady(true);
      this.lastUsedTime = Date.now();
      this._startLivenessCheck();
      this._resetIdleTimer();

      debugLogger.info("llama-server ready", { port: this.port });
      return { success: true, port: this.port };
    } catch (error) {
      this.starting = false;
      this.lastError = _userFriendlyError(error.message, stderrBuffer);

      if (this.process) {
        try {
          this.process.kill("SIGKILL");
        } catch {}
        this.process = null;
      }
      this._setReady(false);
      throw new Error(this.lastError);
    }
  }

  _waitForHealthy() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const poll = async () => {
        if (!this.process) {
          reject(new Error("llama-server process died during startup"));
          return;
        }
        const ok = await this._checkHealthOnce();
        if (ok) {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `llama-server failed to become ready within ${STARTUP_TIMEOUT_MS}ms`,
            ),
          );
          return;
        }
        setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
      };
      poll();
    });
  }

  _checkHealthOnce() {
    if (!this.port) return Promise.resolve(false);
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/health`,
        { timeout: 3000 },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              // llama-server returns { "status": "ok" } when fully loaded
              resolve(parsed.status === "ok");
            } catch {
              resolve(res.statusCode === 200);
            }
          });
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  _startLivenessCheck() {
    this._clearLiveness();
    this.livenessFailures = 0;
    this.livenessInterval = setInterval(async () => {
      if (!this.process || this.starting) return;
      const ok = await this._checkHealthOnce();
      if (ok) {
        this.livenessFailures = 0;
        return;
      }
      this.livenessFailures += 1;
      debugLogger.warn("llama-server liveness check failed", {
        failures: this.livenessFailures,
      });
      if (this.livenessFailures >= LIVENESS_FAILURE_THRESHOLD) {
        this._clearLiveness();
        this._handleUnexpectedExit();
      }
    }, LIVENESS_INTERVAL_MS);
  }

  _clearLiveness() {
    if (this.livenessInterval) {
      clearInterval(this.livenessInterval);
      this.livenessInterval = null;
    }
  }

  async _handleUnexpectedExit() {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.lastError = "llama-server crashed and could not be restarted";
      debugLogger.error("llama-server max restart attempts reached", {
        attempts: this.restartAttempts,
      });
      this._setReady(false);
      return;
    }

    this.restartAttempts += 1;
    const modelName = this.modelName;
    const modelPath = this.modelPath;
    if (!modelName || !modelPath) return;

    debugLogger.info("llama-server auto-restarting", {
      attempt: this.restartAttempts,
      modelName,
    });

    if (this.process) {
      try {
        this.process.kill("SIGKILL");
      } catch {}
      this.process = null;
    }

    try {
      await this.start(modelName, modelPath);
    } catch (err) {
      debugLogger.error("llama-server auto-restart failed", {
        error: err.message,
      });
    }
  }

  async stop() {
    this._clearLiveness();
    this._clearIdleTimer();

    if (!this.process) {
      this._setReady(false);
      return;
    }

    debugLogger.info("Stopping llama-server");
    try {
      await gracefulStopProcess(this.process);
    } catch (err) {
      debugLogger.warn("Error stopping llama-server", { error: err.message });
    }

    this.process = null;
    this.port = null;
    this.modelName = null;
    this.modelPath = null;
    this.restartAttempts = 0;
    this._setReady(false);
  }

  /**
   * Synchronously hard-kill the server. For app quit: stop()'s SIGTERM plus
   * timed SIGKILL fallback never fires once the app exits, which leaked the
   * process (and the port) whenever llama-server didn't act on the SIGTERM
   * in time. The server is stateless, so there is nothing to be graceful about.
   */
  killNow() {
    this._clearLiveness();
    this._clearIdleTimer();
    if (this.process) {
      killProcess(this.process, "SIGKILL");
      this.process = null;
    }
    this.port = null;
    this._setReady(false);
  }
}

function _userFriendlyError(message, stderr) {
  const lower = (stderr || "").toLowerCase();
  if (lower.includes("ggml_aligned_malloc") || lower.includes("killed") || lower.includes("out of memory")) {
    return "Local Gemma ran out of memory. Close other apps and try again, or switch to Groq/Tinfoil.";
  }
  if (lower.includes("failed to load model") || lower.includes("invalid gguf") || lower.includes("magic number")) {
    return "Local Gemma model file is corrupt. Delete and re-download it from Settings.";
  }
  return message || "llama-server failed to start";
}

module.exports = GemmaServerProcess;
