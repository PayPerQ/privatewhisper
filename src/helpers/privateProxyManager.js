const { BrowserWindow, app } = require("electron");
const debugLogger = require("./debugLogger");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Write debug info to a file we can inspect
function proxyLog(msg) {
  const logFile = path.join(
    app.getPath("userData"),
    "private-proxy-debug.log",
  );
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(`[PrivateProxy] ${msg}`);
}

const net = require("net");

const PROXY_PORT = 8787;
const PROXY_HOST = "127.0.0.1";
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 3;
const STARTUP_TIMEOUT_MS = 30_000;
const PORT_RETRY_DELAY_MS = 1000;
const PORT_RETRY_MAX = 5;

class PrivateProxyManager {
  constructor() {
    this.childProcess = null;
    this.healthInterval = null;
    this.restartAttempts = 0;
    this.starting = false;
    this.running = false;
    this.lastError = null;
    this._currentApiKey = null;
  }

  /**
   * Check if a port is available by attempting to listen on it briefly.
   */
  _isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, PROXY_HOST);
    });
  }

  /**
   * Try to kill whatever process is holding a port.
   */
  async _killPortHolder(port) {
    const { execSync } = require("child_process");
    try {
      const pid = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
      if (pid) {
        proxyLog(`Killing PID ${pid} holding port ${port}`);
        execSync(`kill -9 ${pid}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // No process found on port, or kill failed — either way, continue
    }
  }

  /**
   * Wait for a port to become available, retrying up to PORT_RETRY_MAX times.
   */
  async _waitForPort(port) {
    if (await this._isPortAvailable(port)) return true;

    // Port is occupied — try killing whatever holds it
    await this._killPortHolder(port);

    for (let i = 0; i < PORT_RETRY_MAX; i++) {
      if (await this._isPortAvailable(port)) return true;
      proxyLog(`Port ${port} still in use, retrying (${i + 1}/${PORT_RETRY_MAX})...`);
      await new Promise((r) => setTimeout(r, PORT_RETRY_DELAY_MS));
    }
    return false;
  }

  /**
   * Start the private mode proxy as a child process using tsx.
   */
  async start(apiKey) {
    if (this.running) {
      debugLogger.logEvent("private-proxy", "already-running", {
        port: PROXY_PORT,
      });
      return { success: true, port: PROXY_PORT };
    }

    // If a previous process is still winding down, stop it first
    if (this.childProcess) {
      proxyLog("Previous process still exists, stopping first...");
      await this.stop();
    }

    if (this.starting) {
      return { success: false, error: "Proxy is already starting" };
    }

    this.starting = true;
    this.lastError = null;
    this._currentApiKey = apiKey;
    this.broadcastStatus();

    try {
      debugLogger.logEvent("private-proxy", "starting", { port: PROXY_PORT });
      proxyLog("Starting proxy...");

      // Resolve paths — find tsx CLI via package.json location
      const tsxPkgPath = require.resolve("tsx/package.json");
      const tsxCli = path.join(path.dirname(tsxPkgPath), "dist", "cli.mjs");
      const serverScript = require.resolve("ppq-private-mode/bin/server.ts");

      // Find a Node.js 20+ binary (process.execPath is Electron, not Node)
      const nodeBin = this._findNodeBin();

      proxyLog(`Node binary: ${nodeBin}`);
      proxyLog(`tsx CLI: ${tsxCli}`);
      proxyLog(`Server script: ${serverScript}`);

      // Wait for port to be available before spawning
      const portFree = await this._waitForPort(PROXY_PORT);
      if (!portFree) {
        throw new Error(
          `Port ${PROXY_PORT} is still in use. Please try again in a few seconds.`,
        );
      }

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Proxy startup timed out"));
        }, STARTUP_TIMEOUT_MS);

        this.childProcess = spawn(nodeBin, [tsxCli, serverScript], {
          env: {
            ...process.env,
            PPQ_API_KEY: apiKey,
            PORT: String(PROXY_PORT),
            PPQ_API_BASE: "https://api.ppq.ai",
            DEBUG: debugLogger.isEnabled() ? "true" : "false",
          },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.childProcess.stdout.on("data", (data) => {
          const msg = data.toString().trim();
          if (msg) {
            proxyLog(msg);
            debugLogger.logEvent("private-proxy", "stdout", { message: msg });

            // Detect when proxy is listening
            if (msg.includes("listening on")) {
              clearTimeout(timeout);
              this.running = true;
              this.starting = false;
              this.restartAttempts = 0;
              resolve();
            }
          }
        });

        this.childProcess.stderr.on("data", (data) => {
          const msg = data.toString().trim();
          if (msg) {
            proxyLog(`[stderr] ${msg}`);
            debugLogger.logEvent("private-proxy", "stderr", { message: msg });
          }
        });

        this.childProcess.on("error", (error) => {
          proxyLog(`Spawn error: ${error.message}`);
          clearTimeout(timeout);
          reject(error);
        });

        this.childProcess.on("exit", (code, signal) => {
          proxyLog(`Process exited: code=${code} signal=${signal}`);
          debugLogger.logEvent("private-proxy", "process-exit", {
            code,
            signal,
          });
          const wasRunning = this.running;
          this.running = false;
          this.childProcess = null;

          if (this.starting) {
            clearTimeout(timeout);
            reject(
              new Error(`Proxy process exited with code ${code} during startup`),
            );
          } else if (wasRunning) {
            // Unexpected exit — attempt restart
            this.broadcastStatus();
            this.handleUnhealthy();
          }
        });
      });

      this.startHealthCheck();
      this.broadcastStatus();

      debugLogger.logEvent("private-proxy", "started", { port: PROXY_PORT });
      return { success: true, port: PROXY_PORT };
    } catch (error) {
      this.starting = false;
      this.running = false;
      this.lastError = error.message;
      debugLogger.logEvent("private-proxy", "start-failed", {
        error: error.message,
      });
      proxyLog(`Failed to start: ${error.message}`);

      // Clean up child process if it's still around
      if (this.childProcess) {
        try {
          this.childProcess.kill();
        } catch {
          // ignore
        }
        this.childProcess = null;
      }

      this.broadcastStatus();
      return { success: false, error: error.message };
    }
  }

  async stop() {
    this.stopHealthCheck();

    if (this.childProcess) {
      try {
        this.childProcess.kill("SIGTERM");
        // Give it a moment to exit gracefully
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (this.childProcess) {
              this.childProcess.kill("SIGKILL");
            }
            resolve();
          }, 3000);

          if (this.childProcess) {
            this.childProcess.on("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          } else {
            clearTimeout(timeout);
            resolve();
          }
        });
        debugLogger.logEvent("private-proxy", "stopped", {});
      } catch (error) {
        debugLogger.logEvent("private-proxy", "stop-error", {
          error: error.message,
        });
      }
    }

    this.childProcess = null;
    this.running = false;
    this.starting = false;
    this.restartAttempts = 0;
    this.lastError = null;
    this.broadcastStatus();
    return { success: true };
  }

  getStatus() {
    return {
      running: this.running,
      starting: this.starting,
      port: PROXY_PORT,
      attestation: this.running, // attestation happens during startup
      error: this.lastError,
    };
  }

  startHealthCheck() {
    this.stopHealthCheck();
    this.healthInterval = setInterval(async () => {
      if (!this.running) return;

      try {
        const healthy = await this.checkHealth();
        if (!healthy) {
          debugLogger.logEvent("private-proxy", "health-check-failed", {});
          await this.handleUnhealthy();
        }
      } catch {
        await this.handleUnhealthy();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthCheck() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  checkHealth() {
    return new Promise((resolve) => {
      const req = http.get(
        `http://${PROXY_HOST}:${PROXY_PORT}/health`,
        { timeout: 5000 },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed.status === "ok");
            } catch {
              resolve(false);
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

  async handleUnhealthy() {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      debugLogger.logEvent("private-proxy", "max-restarts-reached", {
        attempts: this.restartAttempts,
      });
      this.lastError = "Proxy crashed and could not be restarted";
      await this.stop();
      return;
    }

    this.restartAttempts++;
    debugLogger.logEvent("private-proxy", "restarting", {
      attempt: this.restartAttempts,
    });

    // Kill existing process
    if (this.childProcess) {
      try {
        this.childProcess.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.childProcess = null;
      this.running = false;
    }

    // Attempt restart
    if (this._currentApiKey) {
      await this.start(this._currentApiKey);
    }
  }

  /**
   * Find a Node.js binary >= 20. Checks nvm versions, then falls back to
   * system `node` from PATH.
   */
  _findNodeBin() {
    const { execSync } = require("child_process");
    const fs = require("fs");

    // 1. Try nvm — look for installed Node 22, 24, 20 (in that order)
    const nvmDir =
      process.env.NVM_DIR || path.join(require("os").homedir(), ".nvm");
    const versionsDir = path.join(nvmDir, "versions", "node");
    if (fs.existsSync(versionsDir)) {
      try {
        const versions = fs.readdirSync(versionsDir).sort().reverse();
        for (const ver of versions) {
          const match = ver.match(/^v(\d+)\./);
          if (match && parseInt(match[1], 10) >= 20) {
            const candidate = path.join(versionsDir, ver, "bin", "node");
            if (fs.existsSync(candidate)) {
              debugLogger.logEvent("private-proxy", "node-found", {
                source: "nvm",
                path: candidate,
              });
              return candidate;
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. Try system `node` from PATH
    try {
      const systemNode = execSync("which node", { encoding: "utf8" }).trim();
      if (systemNode) {
        debugLogger.logEvent("private-proxy", "node-found", {
          source: "which",
          path: systemNode,
        });
        return systemNode;
      }
    } catch {
      // ignore
    }

    // 3. Common fallback paths
    for (const candidate of ["/usr/local/bin/node", "/opt/homebrew/bin/node"]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      "Could not find Node.js >= 20. Install Node 20+ via nvm: nvm install 22",
    );
  }

  broadcastStatus() {
    const status = this.getStatus();
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("private-proxy-status-changed", status);
      }
    });
  }
}

module.exports = PrivateProxyManager;
