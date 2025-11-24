const { ipcMain, app, shell, BrowserWindow } = require("electron");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.windowManager = managers.windowManager;
    this.setupHandlers();
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
        return { success: true };
      } catch (error) {
        debugLogger.error("ipc", "save-settings-failed", {
          error: error.message,
          stack: error.stack
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.transcription) {
        this.broadcastTranscriptionEvent(
          "transcription-added",
          result.transcription
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

    // Clipboard handlers
    ipcMain.handle("paste-text", async (event, text) => {
      return this.clipboardManager.pasteText(text);
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
        AppUtils.cleanup(this.windowManager.mainWindow);
        return { success: true, message: "Cleanup completed successfully" };
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
      const { channel = "app", event: entryEvent = "event", details, level } =
        payload;
      debugLogger.logEvent(channel, entryEvent, details || {}, level || "info");
      return { success: true };
    });

    ipcMain.handle("get-debug-mode", async () => {
      return { enabled: debugLogger.isEnabled() };
    });
  }

  broadcastTranscriptionEvent(channel, payload) {
    BrowserWindow.getAllWindows().forEach((windowInstance) => {
      if (!windowInstance.isDestroyed()) {
        windowInstance.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;
