const fs = require("fs");
const path = require("path");
const { ipcMain, app, shell, BrowserWindow } = require("electron");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");

const AUTO_LEARN_DEBOUNCE_MS = 1500;

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.windowManager = managers.windowManager;
    this.edgeFunctionLogger = managers.edgeFunctionLogger;
    this.globeKeyManager = managers.globeKeyManager;
    this.privateProxyManager = managers.privateProxyManager;
    this.parakeetManager = managers.parakeetManager;
    this.sherpaOnnxInstaller = managers.sherpaOnnxInstaller;
    this.gemmaManager = managers.gemmaManager;
    this.llamaServerInstaller = managers.llamaServerInstaller;
    this.textEditMonitor = managers.textEditMonitor;

    // Auto-learn state
    this._autoLearnEnabled = true;
    this._autoLearnDebounceTimer = null;
    this._autoLearnLatestData = null;
    this._textEditHandler = null;

    this._setupTextEditMonitor();
    this.setupHandlers();
    this.setupPrivateProxyHandlers();
    if (this.parakeetManager) {
      this.setupParakeetHandlers();
    }
    if (this.gemmaManager) {
      this.setupGemmaHandlers();
    }
  }

  _getDictionaryTermsSafe() {
    try {
      const terms = this.databaseManager.getDictionary();
      return terms.map((t) => t.term);
    } catch {
      return [];
    }
  }

  _cleanupTextEditMonitor() {
    if (this._autoLearnDebounceTimer) {
      clearTimeout(this._autoLearnDebounceTimer);
      this._autoLearnDebounceTimer = null;
    }
    this._autoLearnLatestData = null;
    if (this.textEditMonitor && this._textEditHandler) {
      this.textEditMonitor.removeListener("text-edited", this._textEditHandler);
      this._textEditHandler = null;
    }
  }

  _setupTextEditMonitor() {
    if (!this.textEditMonitor) return;

    this._textEditHandler = (data) => {
      if (
        !data ||
        typeof data.originalText !== "string" ||
        typeof data.newFieldValue !== "string"
      ) {
        return;
      }

      const { originalText, newFieldValue } = data;

      debugLogger.logEvent("auto-learn", "text-edited", {
        originalLength: originalText.length,
        newValueLength: newFieldValue.length,
      });

      this._autoLearnLatestData = { originalText, newFieldValue };

      if (this._autoLearnDebounceTimer) {
        clearTimeout(this._autoLearnDebounceTimer);
      }

      this._autoLearnDebounceTimer = setTimeout(() => {
        this._processCorrections();
      }, AUTO_LEARN_DEBOUNCE_MS);
    };

    this.textEditMonitor.on("text-edited", this._textEditHandler);
  }

  _processCorrections() {
    this._autoLearnDebounceTimer = null;
    if (!this._autoLearnLatestData) return;
    if (!this._autoLearnEnabled) {
      debugLogger.logEvent("auto-learn", "disabled-skipping");
      this._autoLearnLatestData = null;
      return;
    }

    const { originalText, newFieldValue } = this._autoLearnLatestData;
    this._autoLearnLatestData = null;

    try {
      const { extractCorrections } = require("../utils/correctionLearner");
      const currentDict = this._getDictionaryTermsSafe();
      const corrections = extractCorrections(
        originalText,
        newFieldValue,
        currentDict,
      );
      debugLogger.logEvent("auto-learn", "corrections-result", {
        corrections,
        dictSize: currentDict.length,
      });

      if (corrections.length > 0) {
        const result = this.databaseManager.addDictionaryTermsBulk(corrections);
        if (result.success && result.added.length > 0) {
          // Broadcast full dictionary refresh
          const allTerms = this.databaseManager.getDictionary();
          this.broadcastToAllWindows("dictionary-updated", allTerms);
          // Show overlay so toast is visible
          this.windowManager.showDictationPanel();
          // Broadcast corrections for toast notification
          this.broadcastToAllWindows("corrections-learned", corrections);
          debugLogger.logEvent("auto-learn", "saved-corrections", {
            corrections,
          });
        }
      }
    } catch (error) {
      debugLogger.error("auto-learn", "process-failed", {
        error: error.message,
      });
    }
  }

  setupHandlers() {
    ipcMain.handle("window-minimize", () => {
      this.windowManager.minimizeControlPanel();
    });

    ipcMain.handle("window-maximize", () => {
      this.windowManager.maximizeControlPanel();
    });

    ipcMain.handle("window-close", () => {
      this.windowManager.closeControlPanel();
    });

    ipcMain.handle("window-is-maximized", () => {
      return this.windowManager.isControlPanelMaximized();
    });

    ipcMain.handle("hide-window", () => {
      if (process.platform === "darwin") {
        this.windowManager.hideDictationPanel();
        if (app.dock) app.dock.show();
      } else {
        this.windowManager.hideDictationPanel();
      }
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    ipcMain.handle("resize-main-window", (event, width, height) => {
      this.windowManager.resizeMainWindow(width, height);
      return { success: true };
    });

    // Environment handlers
    ipcMain.handle("get-ppq-key", async (event) => {
      return this.environmentManager.getPPQApiKey();
    });

    ipcMain.handle("save-ppq-key", async (event, key) => {
      return this.environmentManager.savePPQApiKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("save-settings", async (event, settings) => {
      try {
        if (settings.apiKey) {
          await this.environmentManager.savePPQApiKey(settings.apiKey);
        }

        // Persist main-process-relevant settings to disk so they're
        // available at next startup (before the renderer loads).
        const persistKeys = [
          "transcriptionProvider",
          "parakeetModel",
          "reasoningProvider",
          "gemmaModel",
          "gemmaIdleShutdownEnabled",
        ];
        const toPersist = {};
        for (const key of persistKeys) {
          if (settings[key] !== undefined) {
            toPersist[key] = settings[key];
          }
        }
        if (Object.keys(toPersist).length > 0) {
          this.environmentManager.savePersistedSettings(toPersist);
        }

        // Apply idle-shutdown setting to the running Gemma server if present
        if (settings.gemmaIdleShutdownEnabled !== undefined && this.gemmaManager) {
          const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
          const ms = settings.gemmaIdleShutdownEnabled ? IDLE_SHUTDOWN_MS : 0;
          this.gemmaManager.setIdleShutdown(ms);
        }

        return { success: true };
      } catch (error) {
        debugLogger.error("ipc", "save-settings-failed", {
          error: error.message,
          stack: error.stack,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.transcription) {
        this.broadcastTranscriptionEvent(
          "transcription-added",
          result.transcription,
        );
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      const result = this.databaseManager.clearTranscriptions();
      this.broadcastTranscriptionEvent("transcriptions-cleared", result);
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        this.broadcastTranscriptionEvent("transcription-deleted", result.id);
      }
      return result;
    });

    // Dictionary handlers
    ipcMain.handle("db-get-dictionary", async () => {
      return this.databaseManager.getDictionary();
    });

    ipcMain.handle("db-add-dictionary-term", async (event, term) => {
      const result = this.databaseManager.addDictionaryTerm(term);
      if (result?.term && !result.duplicate) {
        this.broadcastTranscriptionEvent("dictionary-term-added", result.term);
      }
      return result;
    });

    ipcMain.handle("db-remove-dictionary-term", async (event, id) => {
      const result = this.databaseManager.removeDictionaryTerm(id);
      if (result?.success) {
        this.broadcastTranscriptionEvent("dictionary-term-removed", result.id);
      }
      return result;
    });

    ipcMain.handle("db-clear-dictionary", async () => {
      const result = this.databaseManager.clearDictionary();
      this.broadcastTranscriptionEvent("dictionary-cleared", result);
      return result;
    });

    // Auto-learn handlers
    ipcMain.on("auto-learn-changed", (_event, enabled) => {
      this._autoLearnEnabled = !!enabled;
      if (!this._autoLearnEnabled) {
        if (this._autoLearnDebounceTimer) {
          clearTimeout(this._autoLearnDebounceTimer);
          this._autoLearnDebounceTimer = null;
        }
        this._autoLearnLatestData = null;
      }
      debugLogger.logEvent("auto-learn", "setting-changed", {
        enabled: this._autoLearnEnabled,
      });
    });

    ipcMain.handle("undo-learned-corrections", async (_event, words) => {
      try {
        if (!Array.isArray(words) || words.length === 0) {
          return { success: false };
        }
        const validWords = words.filter(
          (w) => typeof w === "string" && w.trim().length > 0,
        );
        if (validWords.length === 0) {
          return { success: false };
        }

        const result =
          this.databaseManager.removeDictionaryTermsByWord(validWords);
        if (result.success) {
          const allTerms = this.databaseManager.getDictionary();
          this.broadcastToAllWindows("dictionary-updated", allTerms);
          debugLogger.logEvent("auto-learn", "undo-corrections", {
            words: validWords,
          });
        }
        return result;
      } catch (err) {
        debugLogger.error("auto-learn", "undo-failed", {
          error: err.message,
        });
        return { success: false };
      }
    });

    // Clipboard handlers
    ipcMain.handle("paste-text", async (event, text) => {
      const result = await this.clipboardManager.pasteText(text);

      // Start auto-learn monitoring after successful paste
      if (this.textEditMonitor && this._autoLearnEnabled && text) {
        const targetPid = this.textEditMonitor.lastTargetPid || null;
        setTimeout(() => {
          try {
            this.textEditMonitor.startMonitoring(text, 30000, { targetPid });
          } catch (err) {
            debugLogger.error("auto-learn", "start-monitoring-failed", {
              error: err.message,
            });
          }
        }, 500);
      }

      return result;
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text);
    });

    // Utility handlers
    ipcMain.handle("cleanup-app", async (event) => {
      try {
        await AppUtils.cleanup({
          mainWindow: this.windowManager.mainWindow,
          databaseManager: this.databaseManager,
        });
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 750);
        return {
          success: true,
          relaunch: true,
          message: "Cleanup completed. Relaunching Private Whisper...",
        };
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    // External link handler
    ipcMain.handle("open-external", async (event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Debug logging handlers
    ipcMain.handle("log-reasoning", async (_event, stage, details) => {
      debugLogger.logReasoning(stage, details);
      return { success: true };
    });

    ipcMain.handle("debug-log", async (_event, payload = {}) => {
      const {
        channel = "app",
        event: entryEvent = "event",
        details,
        level,
      } = payload;
      debugLogger.logEvent(channel, entryEvent, details || {}, level || "info");
      return { success: true };
    });

    ipcMain.handle("get-debug-mode", async () => {
      return { enabled: debugLogger.isEnabled() };
    });

    ipcMain.handle("log-pipeline-metrics", async (_event, payload = {}) => {
      if (this.edgeFunctionLogger?.logPipelineMetrics) {
        void this.edgeFunctionLogger.logPipelineMetrics(payload);
      }
      return { queued: true };
    });

    // Log viewer handlers
    ipcMain.handle("get-log-files", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        if (!fs.existsSync(logsDir)) {
          return { files: [] };
        }
        const files = fs
          .readdirSync(logsDir)
          .filter((f) => f.endsWith(".log"))
          .map((f) => {
            const filePath = path.join(logsDir, f);
            const stats = fs.statSync(filePath);
            return {
              name: f,
              path: filePath,
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          })
          .sort((a, b) => new Date(b.modified) - new Date(a.modified));
        return { files };
      } catch (error) {
        return { files: [], error: error.message };
      }
    });

    ipcMain.handle("read-log-file", async (_event, filePath) => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        // Security: ensure the path is within the logs directory
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(logsDir)) {
          return { content: "", error: "Access denied" };
        }
        if (!fs.existsSync(resolved)) {
          return { content: "", error: "File not found" };
        }
        const content = fs.readFileSync(resolved, "utf-8");
        return { content };
      } catch (error) {
        return { content: "", error: error.message };
      }
    });

    ipcMain.handle("collect-diagnostic-logs", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        const lines = [];

        // App info header
        lines.push("=== Private Whisper Diagnostic Logs ===");
        lines.push(`Version: ${app.getVersion()}`);
        lines.push(`Platform: ${process.platform} ${process.arch}`);
        lines.push(`Electron: ${process.versions.electron}`);
        lines.push(`Node: ${process.version}`);
        lines.push(`Date: ${new Date().toISOString()}`);
        lines.push("");

        // Collect recent log files (last 3)
        if (fs.existsSync(logsDir)) {
          const logFiles = fs
            .readdirSync(logsDir)
            .filter((f) => f.endsWith(".log"))
            .map((f) => ({
              name: f,
              path: path.join(logsDir, f),
              mtime: fs.statSync(path.join(logsDir, f)).mtime,
            }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 3);

          for (const file of logFiles) {
            lines.push(`=== ${file.name} ===`);
            const content = fs.readFileSync(file.path, "utf-8");
            // Limit each file to last 500 lines
            const fileLines = content.split("\n");
            const truncated = fileLines.slice(-500);
            if (fileLines.length > 500) {
              lines.push(`... (truncated ${fileLines.length - 500} earlier lines)`);
            }
            lines.push(...truncated);
            lines.push("");
          }
        } else {
          lines.push("No log files found. The app may have just started.");
        }

        return { content: lines.join("\n") };
      } catch (error) {
        return {
          content: `Failed to collect logs: ${error.message}`,
          error: error.message,
        };
      }
    });

    // Settings sync handlers - broadcast to all windows
    ipcMain.handle("update-hotkey-mode", async (_event, mode) => {
      this.broadcastToAllWindows("hotkey-mode-changed", mode);
      return { success: true };
    });

    // Update globe key listener mode based on hotkey and mode settings
    // globeOnly = true: Only listen for Globe/Fn key (no Input Monitoring required)
    // globeOnly = false: Also listen for keyDown/keyUp events (requires Input Monitoring)
    // suppressKey: When set, prevents the default system action for that key (e.g., emoji picker for backtick)
    ipcMain.handle(
      "update-globe-listener-mode",
      async (_event, { hotkey, hotkeyMode }) => {
        if (!this.globeKeyManager || process.platform !== "darwin") {
          return { success: true, globeOnly: true };
        }

        const isGlobeKey = hotkey === "GLOBE";
        const isCompoundHotkey = !isGlobeKey && hotkey.includes("+");

        // Globe-only mode now works for compound hotkeys in ANY mode (including hold)
        // because we detect modifier release via flagsChanged instead of keyUp.
        // This eliminates the need for Input Monitoring for compound hotkeys.
        // Only simple single-key hotkeys still require full keyboard monitoring.
        const globeOnly = isGlobeKey || isCompoundHotkey;

        // Only suppress simple single-key hotkeys (e.g., backtick) to prevent
        // the character from being typed. Compound hotkeys (e.g., Control+Space)
        // don't need suppression — the modifier prevents unintended character input,
        // and unconditional suppression of the base key would block it system-wide.
        const suppressKey = isGlobeKey || isCompoundHotkey ? null : hotkey;

        // Check if we need to restart the listener
        const currentGlobeOnly = this.globeKeyManager.isGlobeOnlyMode();
        const currentSuppressKeycode =
          this.globeKeyManager.getSuppressKeycode();
        const GlobeKeyManager = require("./globeKeyManager");
        const newSuppressKeycode = suppressKey
          ? GlobeKeyManager.keyToKeycode(suppressKey)
          : null;

        const needsRestart =
          globeOnly !== currentGlobeOnly ||
          newSuppressKeycode !== currentSuppressKeycode;

        if (needsRestart) {
          this.globeKeyManager.restart({ globeOnly, suppressKey });
        }

        // Notify main.js of current hotkey settings (used for emoji picker dismissal)
        if (this.onHotkeySettingsChange) {
          this.onHotkeySettingsChange({ hotkey, hotkeyMode });
        }

        return { success: true, globeOnly, suppressKey };
      },
    );

    // Open macOS accessibility settings (macOS only)
    ipcMain.handle("open-accessibility-settings", async () => {
      if (process.platform !== "darwin") {
        return { success: false, error: "Only available on macOS" };
      }
      try {
        this.clipboardManager.openSystemSettings();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Check if accessibility permissions are granted (macOS only)
    // Uses silent mode to avoid showing dialogs - this is for UI state only
    ipcMain.handle("check-accessibility-permissions", async () => {
      if (process.platform !== "darwin") {
        // Non-macOS platforms don't need accessibility permissions
        return { granted: true };
      }
      try {
        const granted =
          await this.clipboardManager.checkAccessibilityPermissions({
            silent: true,
          });
        return { granted };
      } catch (error) {
        return { granted: false, error: error.message };
      }
    });

    // Set hotkey listening mode - suppresses dictation trigger during hotkey selection
    ipcMain.handle("set-hotkey-listening-mode", async (_event, isListening) => {
      // Update the global flag in main.js via a callback
      if (this.onHotkeyListeningModeChange) {
        this.onHotkeyListeningModeChange(Boolean(isListening));
      }
      return { success: true };
    });

    // Check if macOS "Use F1, F2, etc. keys as standard function keys" is enabled
    // Returns true if F-keys work as standard function keys (no Fn needed)
    // Returns false if F-keys trigger special features (Fn needed for actual F-key)
    ipcMain.handle("get-fn-key-mode", async () => {
      if (process.platform !== "darwin") {
        // Non-macOS: F-keys work as standard function keys
        return { standardFunctionKeys: true };
      }

      try {
        const { execSync } = require("child_process");
        // Check the macOS setting - returns 1 if F-keys are standard, 0 or error if not
        const result = execSync(
          "defaults read NSGlobalDomain com.apple.keyboard.fnState 2>/dev/null || echo 0",
          { encoding: "utf8" },
        ).trim();
        const standardFunctionKeys = result === "1";
        return { standardFunctionKeys };
      } catch {
        // Default: F-keys trigger special features (most common)
        return { standardFunctionKeys: false };
      }
    });
  }

  setupPrivateProxyHandlers() {
    // Private proxy controls
    ipcMain.handle("private-proxy-start", async () => {
      debugLogger.logEvent("ipc", "private-proxy-start-called", {
        hasManager: !!this.privateProxyManager,
      });
      if (!this.privateProxyManager) {
        return { success: false, error: "Private proxy manager not available" };
      }
      const apiKey = this.environmentManager.getPPQApiKey();
      debugLogger.logEvent("ipc", "private-proxy-start-api-key", {
        hasKey: !!apiKey,
      });
      if (!apiKey) {
        return { success: false, error: "No PPQ API key configured" };
      }
      const result = await this.privateProxyManager.start(apiKey);
      debugLogger.logEvent("ipc", "private-proxy-start-result", result);
      return result;
    });

    ipcMain.handle("private-proxy-stop", async () => {
      if (!this.privateProxyManager) {
        return { success: false, error: "Private proxy manager not available" };
      }
      return this.privateProxyManager.stop();
    });

    ipcMain.handle("private-proxy-status", async () => {
      if (!this.privateProxyManager) {
        return { running: false, starting: false, error: "Not available" };
      }
      return this.privateProxyManager.getStatus();
    });
  }

  setupParakeetHandlers() {
    // Forward server status changes to all renderer windows
    const wsServer = this.parakeetManager?.serverManager?.wsServer;
    if (wsServer) {
      wsServer.on("status-changed", (status) => {
        this.broadcastToAllWindows("parakeet-server-status-changed", status);
      });
    }

    ipcMain.handle("transcribe-local-parakeet", async (_event, audioData, options) => {
      try {
        return await this.parakeetManager.transcribeLocalParakeet(audioData, options);
      } catch (error) {
        debugLogger.error("ipc", "transcribe-local-parakeet-failed", {
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("check-parakeet-installation", async () => {
      return this.parakeetManager.checkInstallation();
    });

    ipcMain.handle("download-parakeet-model", async (event, modelName) => {
      try {
        return await this.parakeetManager.downloadParakeetModel(modelName, (progress) => {
          event.sender.send("parakeet-download-progress", progress);
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-parakeet-download", async () => {
      return this.parakeetManager.cancelDownload();
    });

    ipcMain.handle("check-parakeet-model-status", async (_event, modelName) => {
      return this.parakeetManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-parakeet-models", async () => {
      return this.parakeetManager.listParakeetModels();
    });

    ipcMain.handle("delete-parakeet-model", async (_event, modelName) => {
      return this.parakeetManager.deleteParakeetModel(modelName);
    });

    ipcMain.handle("parakeet-server-start", async (_event, modelName) => {
      return this.parakeetManager.startServer(modelName);
    });

    ipcMain.handle("parakeet-server-stop", async () => {
      return this.parakeetManager.stopServer();
    });

    ipcMain.handle("parakeet-server-status", async () => {
      return this.parakeetManager.getServerStatus();
    });

    // Sherpa-onnx binary runtime installer
    ipcMain.handle("install-sherpa-onnx", async (event) => {
      try {
        return await this.sherpaOnnxInstaller.install((progress) => {
          event.sender.send("sherpa-onnx-install-progress", progress);
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-sherpa-onnx-install", async () => {
      return this.sherpaOnnxInstaller.cancelInstall();
    });

    ipcMain.handle("check-sherpa-onnx-status", async () => {
      return {
        installed: this.sherpaOnnxInstaller.isInstalled(),
        path: this.sherpaOnnxInstaller.getBinaryPath(),
      };
    });
  }

  setupGemmaHandlers() {
    const serverProcess = this.gemmaManager?.serverManager?.process;
    if (serverProcess) {
      serverProcess.on("status-changed", (status) => {
        this.broadcastToAllWindows("gemma-server-status-changed", status);
      });
    }

    ipcMain.handle("gemma-server-start", async (_event, modelName) => {
      if (!this.gemmaManager) {
        return { success: false, error: "Gemma manager not available" };
      }
      try {
        return await this.gemmaManager.startServer(modelName);
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("gemma-server-stop", async () => {
      if (!this.gemmaManager) {
        return { success: false, error: "Gemma manager not available" };
      }
      return this.gemmaManager.stopServer();
    });

    ipcMain.handle("gemma-server-status", async () => {
      if (!this.gemmaManager) {
        return { available: false, ready: false, running: false, starting: false };
      }
      return this.gemmaManager.getServerStatus();
    });

    ipcMain.handle("gemma-notify-activity", async () => {
      if (this.gemmaManager) this.gemmaManager.notifyActivity();
      return { success: true };
    });

    ipcMain.handle("download-gemma-model", async (event, modelName) => {
      if (!this.gemmaManager) {
        return { success: false, error: "Gemma manager not available" };
      }
      try {
        return await this.gemmaManager.downloadGemmaModel(modelName, (progress) => {
          event.sender.send("gemma-download-progress", progress);
        });
      } catch (error) {
        debugLogger.error("ipc", "download-gemma-model-failed", {
          modelName,
          error: error.message,
        });
        // Forward the failure to the renderer so the UI can surface it
        event.sender.send("gemma-download-progress", {
          type: "error",
          model: modelName,
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-gemma-download", async () => {
      if (!this.gemmaManager) {
        return { success: false, error: "Gemma manager not available" };
      }
      return this.gemmaManager.cancelDownload();
    });

    ipcMain.handle("check-gemma-model-status", async (_event, modelName) => {
      if (!this.gemmaManager) {
        return { model: modelName, downloaded: false, success: false };
      }
      return this.gemmaManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-gemma-models", async () => {
      if (!this.gemmaManager) {
        return { models: [], cache_dir: null, success: false };
      }
      return this.gemmaManager.listGemmaModels();
    });

    ipcMain.handle("delete-gemma-model", async (_event, modelName) => {
      if (!this.gemmaManager) {
        return { success: false, error: "Gemma manager not available" };
      }
      return this.gemmaManager.deleteGemmaModel(modelName);
    });

    // llama-server binary runtime installer
    ipcMain.handle("install-llama-server", async (event) => {
      if (!this.llamaServerInstaller) {
        return { success: false, error: "llama-server installer not available" };
      }
      try {
        const result = await this.llamaServerInstaller.install((progress) => {
          event.sender.send("llama-server-install-progress", progress);
        });
        // Clear the server's cached binary path so it picks up the newly installed binary
        const serverProcess = this.gemmaManager?.serverManager?.process;
        if (serverProcess) serverProcess.clearBinaryCache();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-llama-server-install", async () => {
      if (!this.llamaServerInstaller) {
        return { success: false, error: "llama-server installer not available" };
      }
      return this.llamaServerInstaller.cancelInstall();
    });

    ipcMain.handle("check-llama-server-status", async () => {
      if (!this.llamaServerInstaller) {
        return { installed: false, supported: false };
      }
      return {
        installed: this.llamaServerInstaller.isInstalled(),
        supported: this.llamaServerInstaller.isSupported(),
        path: this.llamaServerInstaller.getBinaryPath(),
      };
    });
  }

  broadcastToAllWindows(channel, payload) {
    BrowserWindow.getAllWindows().forEach((windowInstance) => {
      if (!windowInstance.isDestroyed()) {
        windowInstance.webContents.send(channel, payload);
      }
    });
  }

  broadcastTranscriptionEvent(channel, payload) {
    this.broadcastToAllWindows(channel, payload);
  }
}

module.exports = IPCHandlers;
