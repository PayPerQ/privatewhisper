const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const LEVELS = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

class DebugLogger {
  constructor() {
    this.debugMode = this.shouldEnableDebug();
    this.logFile = null;
    this.logStream = null;
    this.initialized = false;

    if (this.debugMode) {
      this.initializeWhenReady();
    }
  }

  shouldEnableDebug() {
    return (
      process.env.PPQVOICE_DEBUG === "true" ||
      process.argv.includes("--debug") ||
      this.checkDebugFile()
    );
  }

  initializeLogging() {
    if (this.initialized) return;

    try {
      const logsDir = path.join(app.getPath("userData"), "logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.logFile = path.join(logsDir, `debug-${timestamp}.log`);
      this.logStream = fs.createWriteStream(this.logFile, { flags: "a" });
      this.initialized = true;

      this.logEvent("system", "debug-enabled", {
        logFile: this.logFile,
        platform: process.platform,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appPath: app.getAppPath(),
        userDataPath: app.getPath("userData"),
        resourcesPath: process.resourcesPath,
        environment: process.env.NODE_ENV,
      });
    } catch (error) {
      // If logging initialization fails, disable debug mode
      this.debugMode = false;
      console.error("Failed to initialize debug logging:", error.message);
    }
  }

  initializeWhenReady() {
    if (this.initialized) {
      return;
    }
    if (app && app.getPath) {
      this.initializeLogging();
    } else {
      setImmediate(() => {
        if (app && app.getPath) {
          this.initializeLogging();
        }
      });
    }
  }

  refreshDebugMode() {
    if (this.debugMode) {
      return true;
    }
    const shouldEnable = this.shouldEnableDebug();
    if (!shouldEnable) {
      return false;
    }
    this.debugMode = true;
    this.initializeWhenReady();
    return true;
  }

  isEnabled() {
    return this.debugMode;
  }

  getLogPath() {
    return this.logFile;
  }

  logEvent(channel, event, details = {}, level = "info") {
    if (!this.debugMode) {
      return;
    }

    const timestamp = new Date().toISOString();
    const normalizedLevel = LEVELS[level] || LEVELS.info;
    const normalizedDetails =
      details && typeof details === "object" ? details : { message: details };
    const entry = {
      timestamp,
      level: normalizedLevel,
      channel,
      event,
      ...normalizedDetails,
    };

    const consoleMethod =
      normalizedLevel === LEVELS.error
        ? console.error
        : normalizedLevel === LEVELS.warn
          ? console.warn
          : console.log;

    consoleMethod(
      `[${entry.level}] [${entry.channel}] ${entry.event}`,
      normalizedDetails,
    );

    if (this.logStream) {
      this.logStream.write(JSON.stringify(entry) + "\n");
    }
  }

  logReasoning(stage, details) {
    this.logEvent("reasoning", stage, details, "debug");
  }

  logFFmpegDebug(context, ffmpegPath, additionalInfo = {}) {
    if (!this.debugMode) return;

    const debugInfo = {
      context,
      ffmpegPath,
      exists: ffmpegPath ? fs.existsSync(ffmpegPath) : false,
      ...additionalInfo,
    };

    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      try {
        const stats = fs.statSync(ffmpegPath);
        debugInfo.fileInfo = {
          size: stats.size,
          isFile: stats.isFile(),
          isExecutable: !!(stats.mode & fs.constants.X_OK),
          permissions: stats.mode.toString(8),
          modified: stats.mtime,
        };
      } catch (e) {
        debugInfo.statError = e.message;
      }
    }

    if (ffmpegPath) {
      const dir = path.dirname(ffmpegPath);
      try {
        fs.accessSync(dir, fs.constants.R_OK);
        debugInfo.dirReadable = true;
      } catch (e) {
        debugInfo.dirReadable = false;
        debugInfo.dirError = e.message;
      }
    }

    const possiblePaths = [
      ffmpegPath,
      ffmpegPath?.replace("app.asar", "app.asar.unpacked"),
      path.join(
        process.resourcesPath || "",
        "app.asar.unpacked",
        "node_modules",
        "ffmpeg-static",
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      ),
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ].filter(Boolean);

    debugInfo.pathChecks = possiblePaths.map((p) => ({
      path: p,
      exists: fs.existsSync(p),
    }));

    this.logEvent("ffmpeg", context, debugInfo, "debug");
  }

  logAudioData(context, audioBlob) {
    if (!this.debugMode) return;

    const audioInfo = {
      context,
      type: audioBlob?.type || "unknown",
      size: audioBlob?.size || 0,
      constructor: audioBlob?.constructor?.name || "unknown",
    };

    if (audioBlob instanceof ArrayBuffer) {
      audioInfo.byteLength = audioBlob.byteLength;
      const view = new Uint8Array(
        audioBlob,
        0,
        Math.min(16, audioBlob.byteLength),
      );
      audioInfo.firstBytes = Array.from(view)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    } else if (audioBlob instanceof Uint8Array) {
      audioInfo.byteLength = audioBlob.byteLength;
      const view = audioBlob.slice(0, Math.min(16, audioBlob.byteLength));
      audioInfo.firstBytes = Array.from(view)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    }

    this.logEvent("audio", context, audioInfo, "debug");
  }

  logProcessStart(command, args, options = {}) {
    if (!this.debugMode) return;

    this.logEvent("process", "start", {
      command,
      args,
      cwd: options.cwd || process.cwd(),
      env: {
        FFMPEG_PATH: options.env?.FFMPEG_PATH,
        FFMPEG_EXECUTABLE: options.env?.FFMPEG_EXECUTABLE,
        FFMPEG_BINARY: options.env?.FFMPEG_BINARY,
        PATH_preview: options.env?.PATH?.substring(0, 200) + "...",
      },
    });
  }

  logProcessOutput(processName, type, data) {
    if (!this.debugMode) return;

    const output = data.toString().trim();
    if (output) {
      this.logEvent("process", `${processName}-${type}`, { output }, "debug");
    }
  }

  logWhisperPipeline(stage, details) {
    this.logEvent("whisper", stage, details, "debug");
  }

  error(channel, event, details = {}) {
    this.logEvent(channel, event, details, "error");
  }

  close() {
    if (this.logStream) {
      this.logEvent("system", "debug-disabled");
      this.logStream.end();
      this.logStream = null;
    }
  }

  checkDebugFile() {
    try {
      // Return false if app is not ready yet
      if (!app || !app.getPath) {
        return false;
      }
      const debugFilePath = path.join(app.getPath("userData"), "ENABLE_DEBUG");
      return fs.existsSync(debugFilePath);
    } catch (e) {
      return false;
    }
  }
}

const debugLogger = new DebugLogger();

module.exports = debugLogger;
