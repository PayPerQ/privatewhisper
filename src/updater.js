const { ipcMain } = require("electron");
const debugLogger = require("./helpers/debugLogger");

function friendlyUpdateError(err) {
  const msg = err?.message || String(err || "");

  if (/HttpError:\s*404|Cannot find.*latest.*\.yml/i.test(msg)) {
    return {
      message:
        "Update info not available yet for this version. Please try again later or download the latest release manually from ppq.ai.",
      code: "RELEASE_NOT_FOUND",
    };
  }

  if (
    /net::ERR_|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed/i.test(msg)
  ) {
    return {
      message:
        "Couldn't reach the update server. Please check your internet connection and try again.",
      code: "NETWORK_ERROR",
    };
  }

  return {
    message:
      "The updater encountered a problem. Please try again or download the latest release manually from ppq.ai.",
    code: "UNKNOWN",
  };
}

class UpdateManager {
  constructor() {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.lastUpdateInfo = null;
    this.isInstalling = false;
    this.isDownloading = false;
    this.installTimeout = null;
    this.installFallbackTimeout = null;
    this.ipcHandlers = [];
    this.eventListeners = [];
    this.autoUpdater = null;

    // Delay autoUpdater initialization to avoid loading issues
    setImmediate(() => {
      const { autoUpdater } = require("electron-updater");
      this.autoUpdater = autoUpdater;
      this.setupAutoUpdater();
    });

    this.setupIPCHandlers();
  }

  clearInstallTimers() {
    if (this.installTimeout) {
      clearTimeout(this.installTimeout);
      this.installTimeout = null;
    }
    if (this.installFallbackTimeout) {
      clearTimeout(this.installFallbackTimeout);
      this.installFallbackTimeout = null;
    }
  }

  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelWindow = controlPanelWindow;
  }

  setupAutoUpdater() {
    if (process.env.NODE_ENV === "development") {
      return;
    }

    if (!this.autoUpdater) {
      return;
    }

    this.autoUpdater.setFeedURL({
      provider: "github",
      owner: "PayPerQ",
      repo: "ppq-voice-releases",
      private: false,
    });

    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = true;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    const handlers = {
      "checking-for-update": () => {
        this.notifyRenderers("checking-for-update");
      },
      "update-available": (info) => {
        this.updateAvailable = true;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-available", info);
      },
      "update-not-available": (info) => {
        this.updateAvailable = false;
        this.updateDownloaded = false;
        this.isDownloading = false;
        this.lastUpdateInfo = null;
        this.notifyRenderers("update-not-available", info);
      },
      error: (err) => {
        const friendly = friendlyUpdateError(err);
        debugLogger.error("updater", "auto-updater-error", {
          error: err?.message || err,
          stack: err?.stack,
          code: friendly.code,
        });
        this.isDownloading = false;
        this.isInstalling = false;
        this.clearInstallTimers();
        // Don't pop UI errors for missing release artifacts — not actionable.
        // Manual checks surface this via the IPC handler's own throw path.
        if (friendly.code === "RELEASE_NOT_FOUND") return;
        this.notifyRenderers("update-error", {
          message: friendly.message,
          code: friendly.code,
        });
      },
      "download-progress": (progressObj) => {
        debugLogger.logEvent("updater", "download-progress", {
          percent: progressObj.percent.toFixed(2),
          transferredMB: (progressObj.transferred / 1024 / 1024).toFixed(2),
          totalMB: (progressObj.total / 1024 / 1024).toFixed(2),
        });
        this.notifyRenderers("update-download-progress", progressObj);
      },
      "update-downloaded": (info) => {
        debugLogger.logEvent("updater", "update-downloaded", {
          version: info?.version,
        });
        this.updateDownloaded = true;
        this.isDownloading = false;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-downloaded", info);
      },
    };

    Object.entries(handlers).forEach(([event, handler]) => {
      this.autoUpdater.on(event, handler);
      this.eventListeners.push({ event, handler });
    });
  }

  notifyRenderers(channel, data) {
    if (
      this.mainWindow &&
      !this.mainWindow.isDestroyed() &&
      this.mainWindow.webContents
    ) {
      this.mainWindow.webContents.send(channel, data);
    }
    if (
      this.controlPanelWindow &&
      !this.controlPanelWindow.isDestroyed() &&
      this.controlPanelWindow.webContents
    ) {
      this.controlPanelWindow.webContents.send(channel, data);
    }
  }

  setupIPCHandlers() {
    const handlers = [
      {
        channel: "check-for-updates",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                updateAvailable: false,
                message: "Update checks are disabled in development mode",
              };
            }

            debugLogger.logEvent("updater", "checking-for-updates");
            const result = await this.autoUpdater.checkForUpdates();

            if (result?.isUpdateAvailable && result?.updateInfo) {
              debugLogger.logEvent("updater", "update-available", {
                version: result.updateInfo.version,
                files: result.updateInfo.files
                  ?.map((f) => `${(f.size / 1024 / 1024).toFixed(2)}MB`)
                  .join(", "),
              });
              return {
                updateAvailable: true,
                version: result.updateInfo.version,
                releaseDate: result.updateInfo.releaseDate,
                files: result.updateInfo.files,
                releaseNotes: result.updateInfo.releaseNotes,
              };
            } else {
              debugLogger.logEvent("updater", "already-latest-version");
              return {
                updateAvailable: false,
                message: "You are running the latest version",
              };
            }
          } catch (error) {
            const friendly = friendlyUpdateError(error);
            debugLogger.error("updater", "update-check-error", {
              error: error.message,
              stack: error.stack,
              code: friendly.code,
            });
            throw new Error(friendly.message);
          }
        },
      },
      {
        channel: "download-update",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                success: false,
                message: "Update downloads are disabled in development mode",
              };
            }

            if (this.isDownloading) {
              return {
                success: false,
                message: "Download already in progress",
              };
            }

            if (this.updateDownloaded) {
              return {
                success: false,
                message: "Update already downloaded. Ready to install.",
              };
            }

            this.isDownloading = true;
            debugLogger.logEvent("updater", "starting-download");
            await this.autoUpdater.downloadUpdate();
            debugLogger.logEvent("updater", "download-initiated");

            return { success: true, message: "Update download started" };
          } catch (error) {
            this.isDownloading = false;
            debugLogger.error("updater", "download-error", {
              error: error.message,
              stack: error.stack,
            });
            throw error;
          }
        },
      },
      {
        channel: "install-update",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                success: false,
                message: "Update installation is disabled in development mode",
              };
            }

            if (!this.updateDownloaded) {
              return {
                success: false,
                message: "No update available to install",
              };
            }

            if (this.isInstalling) {
              return {
                success: false,
                message: "Update installation already in progress",
              };
            }

            if (!this.autoUpdater) {
              return {
                success: false,
                message: "Updater not initialized yet. Please try again.",
              };
            }

            this.isInstalling = true;
            debugLogger.logEvent("updater", "installing-update");

            this.clearInstallTimers();
            this.installTimeout = setTimeout(() => {
              this.installTimeout = null;
              try {
                debugLogger.logEvent("updater", "calling-quit-and-install", {
                  platform: process.platform,
                  updateDownloaded: this.updateDownloaded,
                });

                const { app } = require("electron");
                app.emit("before-quit");
                this.autoUpdater.quitAndInstall(false, true);

                debugLogger.logEvent("updater", "quit-and-install-called");
              } catch (error) {
                this.isInstalling = false;
                this.clearInstallTimers();
                const friendly = friendlyUpdateError(error);
                debugLogger.error("updater", "quit-and-install-failed", {
                  error: error?.message || error,
                  stack: error?.stack,
                  code: friendly.code,
                });
                this.notifyRenderers("update-error", {
                  message: friendly.message,
                  code: friendly.code,
                });
              }
            }, 100);

            this.installFallbackTimeout = setTimeout(() => {
              if (!this.isInstalling) return;
              this.isInstalling = false;
              this.installFallbackTimeout = null;
              debugLogger.error("updater", "install-timeout", {
                error: "Update installation timed out. Please try again.",
              });
              this.notifyRenderers("update-install-timeout", {
                message:
                  "PPQ Whisper didn't restart automatically. Please quit the app manually to finish installing the update.",
              });
            }, 10000);

            return { success: true, message: "Update installation started" };
          } catch (error) {
            this.isInstalling = false;
            this.clearInstallTimers();
            debugLogger.error("updater", "installation-error", {
              error: error.message,
              stack: error.stack,
            });
            throw error;
          }
        },
      },
      {
        channel: "get-app-version",
        handler: async () => {
          try {
            const { app } = require("electron");
            return { version: app.getVersion() };
          } catch (error) {
            debugLogger.error("updater", "get-version-error", {
              error: error.message,
            });
            throw error;
          }
        },
      },
      {
        channel: "get-update-status",
        handler: async () => {
          try {
            return {
              updateAvailable: this.updateAvailable,
              updateDownloaded: this.updateDownloaded,
              isDevelopment: process.env.NODE_ENV === "development",
            };
          } catch (error) {
            debugLogger.error("updater", "get-status-error", {
              error: error.message,
            });
            throw error;
          }
        },
      },
      {
        channel: "get-update-info",
        handler: async () => {
          try {
            return this.lastUpdateInfo;
          } catch (error) {
            debugLogger.error("updater", "get-info-error", {
              error: error.message,
            });
            throw error;
          }
        },
      },
    ];

    // Register all handlers and track for cleanup
    handlers.forEach(({ channel, handler }) => {
      ipcMain.handle(channel, handler);
      this.ipcHandlers.push({ channel, handler });
    });
  }

  checkForUpdatesOnStartup() {
    if (process.env.NODE_ENV !== "development") {
      setTimeout(() => {
        debugLogger.logEvent("updater", "startup-check");
        this.autoUpdater.checkForUpdates().catch((err) => {
          debugLogger.error("updater", "startup-check-failed", {
            error: err.message,
            stack: err.stack,
          });
        });
      }, 3000);
    }
  }

  cleanup() {
    this.clearInstallTimers();

    this.eventListeners.forEach(({ event, handler }) => {
      this.autoUpdater.removeListener(event, handler);
    });
    this.eventListeners = [];

    this.ipcHandlers.forEach(({ channel }) => {
      ipcMain.removeHandler(channel);
    });
    this.ipcHandlers = [];
  }
}

module.exports = UpdateManager;
