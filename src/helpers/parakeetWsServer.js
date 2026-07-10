const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const EventEmitter = require("events");
const debugLogger = require("./parakeetLogger");
const os = require("os");
const {
  findAvailablePort,
  resolveBinaryPath,
  gracefulStopProcess,
  killOrphanedProcesses,
} = require("../utils/serverUtils");
const { killProcess } = require("../utils/process");
const { getSafeTempDir } = require("./safeTempDir");

const PORT_RANGE_START = 6006;
const PORT_RANGE_END = 6029;
const MAX_PORT_CONFLICT_RETRIES = 3;
const STARTUP_TIMEOUT_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const TRANSCRIPTION_TIMEOUT_MS = 300000;
const KEEPWARM_INTERVAL_MS = 120000; // Run a warm-up inference every 2 minutes to keep caches hot

class ParakeetWsServer extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.port = null;
    this.ready = false;
    this.modelName = null;
    this.modelDir = null;
    this.startupPromise = null;
    this.healthCheckInterval = null;
    this.keepWarmInterval = null;
    this.transcribing = false;
    this.cachedWsBinaryPath = null;
    this.lastTranscriptionTime = 0;
  }

  getWsBinaryPath() {
    if (this.cachedWsBinaryPath) return this.cachedWsBinaryPath;

    const platformArch = `${process.platform}-${process.arch}`;
    const binaryName =
      process.platform === "win32"
        ? `sherpa-onnx-ws-${platformArch}.exe`
        : `sherpa-onnx-ws-${platformArch}`;

    const resolved = resolveBinaryPath(binaryName);
    if (resolved) this.cachedWsBinaryPath = resolved;
    return resolved;
  }

  isAvailable() {
    return this.getWsBinaryPath() !== null;
  }

  clearBinaryCache() {
    this.cachedWsBinaryPath = null;
  }

  _setReady(value) {
    const prev = this.ready;
    this.ready = value;
    if (prev !== value) {
      this.emit("status-changed", this.getStatus());
    }
  }

  async start(modelName, modelDir) {
    if (this.startupPromise) return this.startupPromise;
    if (this.ready && this.modelName === modelName) return;
    if (this.process) await this.stop();

    this.startupPromise = this._doStart(modelName, modelDir);
    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart(modelName, modelDir) {
    const wsBinary = this.getWsBinaryPath();
    if (!wsBinary) throw new Error("sherpa-onnx WS server binary not found");
    if (!fs.existsSync(modelDir)) throw new Error(`Model directory not found: ${modelDir}`);

    // A crashed or force-quit app instance can leave an orphaned server
    // holding a port in our range (and the model in RAM). Reap it first.
    const reaped = await killOrphanedProcesses(wsBinary);
    if (reaped > 0) {
      debugLogger.warn("Killed orphaned parakeet-ws process(es) from a previous run", {
        count: reaped,
      });
    }

    this.modelName = modelName;
    this.modelDir = modelDir;

    let portSearchStart = PORT_RANGE_START;
    for (let attempt = 0; ; attempt++) {
      this.port = await findAvailablePort(portSearchStart, PORT_RANGE_END);
      try {
        await this._spawnServer(wsBinary, modelDir);
        break;
      } catch (error) {
        const portInUse = /address already in use/i.test(error.message);
        if (portInUse && attempt < MAX_PORT_CONFLICT_RETRIES && this.port < PORT_RANGE_END) {
          debugLogger.warn("parakeet-ws port already in use, retrying on next port", {
            port: this.port,
            attempt: attempt + 1,
          });
          portSearchStart = this.port + 1;
          continue;
        }
        if (portInUse) {
          throw new Error(
            `Local transcription server could not start: port ${this.port} is already in use by another application.`,
          );
        }
        throw error;
      }
    }

    this._startHealthCheck();

    debugLogger.info("parakeet-ws server started successfully", {
      port: this.port,
      model: modelName,
    });

    await this._warmUp();
  }

  async _spawnServer(wsBinary, modelDir) {
    const args = [
      `--tokens=${path.join(modelDir, "tokens.txt")}`,
      `--encoder=${path.join(modelDir, "encoder.int8.onnx")}`,
      `--decoder=${path.join(modelDir, "decoder.int8.onnx")}`,
      `--joiner=${path.join(modelDir, "joiner.int8.onnx")}`,
      `--port=${this.port}`,
      `--num-threads=${Math.max(1, Math.min(4, Math.floor(os.cpus().length * 0.75)))}`,
    ];

    debugLogger.debug("Starting parakeet WS server", {
      port: this.port,
      modelName: this.modelName,
      args,
    });

    const spawnEnv = { ...process.env };
    const binaryDir = path.dirname(wsBinary);
    if (process.platform === "darwin") {
      spawnEnv.DYLD_LIBRARY_PATH = binaryDir;
    } else if (process.platform === "linux") {
      spawnEnv.LD_LIBRARY_PATH = binaryDir;
    }

    this.process = spawn(wsBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: getSafeTempDir(),
      env: spawnEnv,
    });

    let stderrBuffer = "";
    let exitCode = null;
    let readyResolve = null;
    const readyFromStderr = new Promise((resolve) => {
      readyResolve = resolve;
    });

    this.process.stdout.on("data", (data) => {
      debugLogger.debug("parakeet-ws stdout", { data: data.toString().trim() });
    });

    this.process.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      debugLogger.debug("parakeet-ws stderr", { data: data.toString().trim() });
      if (data.toString().includes("Listening on:")) {
        readyResolve(true);
      }
    });

    this.process.on("error", (error) => {
      debugLogger.error("parakeet-ws process error", { error: error.message });
      this._setReady(false);
      readyResolve(false);
    });

    this.process.on("close", (code) => {
      exitCode = code;
      debugLogger.debug("parakeet-ws process exited", { code });
      this._setReady(false);
      this.process = null;
      this.stopHealthCheck();
      readyResolve(false);
    });

    await this._waitForReady(readyFromStderr, () => ({ stderr: stderrBuffer, exitCode }));
  }

  async _warmUp() {
    try {
      const sampleRate = 16000;
      const numSamples = sampleRate;
      const silentSamples = Buffer.alloc(numSamples * 4);
      await this.transcribe(silentSamples, sampleRate);
      debugLogger.debug("parakeet-ws warm-up inference complete");
    } catch (err) {
      debugLogger.warn("parakeet-ws warm-up failed (non-fatal)", {
        error: err.message,
      });
    }
  }

  async _waitForReady(readySignal, getProcessInfo) {
    const startTime = Date.now();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`parakeet-ws failed to start within ${STARTUP_TIMEOUT_MS}ms`)),
        STARTUP_TIMEOUT_MS
      );
    });

    const ready = await Promise.race([readySignal, timeoutPromise]);

    if (!ready) {
      const info = getProcessInfo ? getProcessInfo() : {};
      const stderr = info.stderr ? info.stderr.trim().slice(0, 200) : "";
      const details = stderr || (info.exitCode !== null ? `exit code: ${info.exitCode}` : "");
      throw new Error(`parakeet-ws process died during startup${details ? `: ${details}` : ""}`);
    }

    this._setReady(true);
    debugLogger.debug("parakeet-ws ready", { startupTimeMs: Date.now() - startTime });
  }

  _isProcessAlive() {
    if (!this.process || this.process.killed) return false;
    try {
      process.kill(this.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  _startHealthCheck() {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(() => {
      if (this.transcribing) return;

      if (!this.process || !this._isProcessAlive()) {
        debugLogger.warn("parakeet-ws health check: process not alive, auto-restarting");
        this._setReady(false);
        this.stopHealthCheck();
        this._autoRestart();
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    this._startKeepWarm();
  }

  _startKeepWarm() {
    this._stopKeepWarm();
    this.keepWarmInterval = setInterval(() => {
      if (!this.ready || !this.process || this.transcribing) return;

      const idleMs = Date.now() - this.lastTranscriptionTime;
      if (idleMs < KEEPWARM_INTERVAL_MS) return;

      debugLogger.debug("parakeet-ws keep-warm: running idle inference");
      const sampleRate = 16000;
      const silentSamples = Buffer.alloc(sampleRate * 4); // 1 second of silence
      this.transcribe(silentSamples, sampleRate).catch((err) => {
        debugLogger.warn("parakeet-ws keep-warm inference failed", { error: err.message });
      });
    }, KEEPWARM_INTERVAL_MS);
  }

  _stopKeepWarm() {
    if (this.keepWarmInterval) {
      clearInterval(this.keepWarmInterval);
      this.keepWarmInterval = null;
    }
  }

  _autoRestart() {
    if (!this.modelName || !this.modelDir) return;
    const modelName = this.modelName;
    const modelDir = this.modelDir;
    debugLogger.info("parakeet-ws auto-restarting server", { modelName });
    this.start(modelName, modelDir).catch((err) => {
      debugLogger.error("parakeet-ws auto-restart failed", { error: err.message });
    });
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this._stopKeepWarm();
  }

  transcribe(samplesBuffer, sampleRate) {
    if (!this.ready || !this.process) {
      throw new Error("parakeet-ws server is not running");
    }

    this.transcribing = true;
    this.lastTranscriptionTime = Date.now();

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let result = "";

      const done =
        (fn) =>
        (...args) => {
          this.transcribing = false;
          fn(...args);
        };

      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        done(reject)(new Error("parakeet-ws transcription timed out"));
      }, TRANSCRIPTION_TIMEOUT_MS);

      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

      ws.on("open", () => {
        // sherpa-onnx offline WS binary protocol:
        // [int32LE sample_rate][int32LE num_audio_bytes][float32 samples...]
        const message = Buffer.alloc(8 + samplesBuffer.length);
        message.writeInt32LE(sampleRate, 0);
        message.writeInt32LE(samplesBuffer.length, 4);
        samplesBuffer.copy(message, 8);

        debugLogger.debug("parakeet-ws sending audio", {
          samplesBytes: samplesBuffer.length,
          sampleRate,
        });

        ws.send(message, (err) => {
          if (err) {
            debugLogger.error("parakeet-ws send error", { error: err.message });
          }
        });
      });

      ws.on("message", (data) => {
        result += data.toString();
        ws.send("Done");
      });

      ws.on("close", (code) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;

        debugLogger.debug("parakeet-ws transcription completed", {
          elapsed,
          code,
          resultLength: result.length,
        });

        try {
          const parsed = JSON.parse(result);
          done(resolve)({ text: (parsed.text || "").trim(), elapsed });
        } catch {
          done(resolve)({ text: result.trim(), elapsed });
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        done(reject)(new Error(`parakeet-ws transcription failed: ${error.message}`));
      });
    });
  }

  async stop() {
    this.stopHealthCheck();

    if (!this.process) {
      this._setReady(false);
      return;
    }

    debugLogger.debug("Stopping parakeet-ws server");

    try {
      await gracefulStopProcess(this.process);
    } catch (error) {
      debugLogger.error("Error stopping parakeet-ws server", { error: error.message });
    }

    this.process = null;
    this._setReady(false);
    this.port = null;
    this.modelName = null;
    this.modelDir = null;
  }

  /**
   * Synchronously hard-kill the server. For app quit: stop()'s SIGTERM plus
   * timed SIGKILL fallback never fires once the app exits, which leaked the
   * process (and the port) whenever sherpa didn't act on the SIGTERM in time.
   * The server is stateless, so there is nothing to be graceful about.
   */
  killNow() {
    this.stopHealthCheck();
    if (this.process) {
      killProcess(this.process, "SIGKILL");
      this.process = null;
    }
    this._setReady(false);
    this.port = null;
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      running: this.ready && this.process !== null,
      port: this.port,
      modelName: this.modelName,
    };
  }
}

module.exports = ParakeetWsServer;
