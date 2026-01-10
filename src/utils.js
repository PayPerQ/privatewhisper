const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, session } = require("electron");
const debugLogger = require("./helpers/debugLogger");
const DbPathManager = require("./utils/DbPathManager");

class AppUtils {
  static async cleanup({ mainWindow, databaseManager } = {}) {
    debugLogger.logEvent("cleanup", "process-start");

    try {
      if (databaseManager?.cleanup) {
        databaseManager.cleanup();
        debugLogger.logEvent("cleanup", "database-deleted", {
          path: DbPathManager.getDbPath(),
        });
      }
    } catch (error) {
      debugLogger.error("cleanup", "database-delete-error", {
        error: error.message,
        stack: error.stack,
      });
    }

    const windows = BrowserWindow.getAllWindows().filter(
      (windowInstance) => !windowInstance.isDestroyed(),
    );
    const sessions = new Set();
    if (mainWindow?.webContents?.session) {
      sessions.add(mainWindow.webContents.session);
    }
    windows.forEach((windowInstance) => {
      if (windowInstance?.webContents?.session) {
        sessions.add(windowInstance.webContents.session);
      }
    });
    if (sessions.size === 0 && session?.defaultSession) {
      sessions.add(session.defaultSession);
    }

    // clearStorageData() clears localStorage, sessionStorage, IndexedDB, cookies, etc.
    // No need for separate localStorage.clear() via executeJavaScript
    await Promise.all(
      Array.from(sessions).map(async (activeSession) => {
        try {
          await activeSession.clearStorageData();
          debugLogger.logEvent("cleanup", "session-storage-cleared");
        } catch (error) {
          debugLogger.error("cleanup", "session-storage-error", {
            error: error.message,
          });
        }

        try {
          await activeSession.clearCache();
          debugLogger.logEvent("cleanup", "session-cache-cleared");
        } catch (error) {
          debugLogger.error("cleanup", "session-cache-error", {
            error: error.message,
          });
        }
      }),
    );

    debugLogger.logEvent("cleanup", "permissions-reminder", {
      message:
        "Manually remove accessibility and microphone permissions if needed",
    });

    const userDataPath = app.getPath("userData");

    try {
      const envPath = path.join(userDataPath, ".env");
      if (fs.existsSync(envPath)) {
        fs.unlinkSync(envPath);
        debugLogger.logEvent("cleanup", "env-file-deleted", { path: envPath });
      }
    } catch (error) {
      debugLogger.error("cleanup", "env-file-delete-error", {
        error: error.message,
        stack: error.stack,
      });
    }

    try {
      const debugFlagPath = path.join(userDataPath, "ENABLE_DEBUG");
      if (fs.existsSync(debugFlagPath)) {
        fs.unlinkSync(debugFlagPath);
        debugLogger.logEvent("cleanup", "debug-flag-deleted", {
          path: debugFlagPath,
        });
      }
    } catch (error) {
      debugLogger.error("cleanup", "debug-flag-delete-error", {
        error: error.message,
        stack: error.stack,
      });
    }

    try {
      const logsDir = path.join(userDataPath, "logs");
      if (fs.existsSync(logsDir)) {
        debugLogger.close();
        fs.rmSync(logsDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Logger is closed at this point, so we can't log this error
      // The error will be silently swallowed, which is acceptable during cleanup
    }
  }
}

module.exports = AppUtils;
