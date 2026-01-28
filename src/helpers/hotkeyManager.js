const { globalShortcut } = require("electron");

class HotkeyManager {
  constructor() {
    this.currentHotkey = "`";
    this.isInitialized = false;
  }

  setupShortcuts(hotkey = "`", callback) {
    if (!callback) {
      throw new Error("Callback function is required for hotkey setup");
    }

    try {
      if (hotkey === "GLOBE") {
        if (process.platform !== "darwin") {
          return {
            success: false,
            error: "The Globe key is only available on macOS.",
          };
        }
        // Unregister old non-GLOBE hotkey before switching to GLOBE
        if (this.currentHotkey && this.currentHotkey !== "GLOBE") {
          globalShortcut.unregister(this.currentHotkey);
        }
        this.currentHotkey = hotkey;
        return { success: true, hotkey };
      }

      // If re-registering the same key (e.g., to refresh the callback),
      // unregister first — globalShortcut.register fails for already-registered keys.
      if (this.currentHotkey === hotkey) {
        globalShortcut.unregister(hotkey);
      }

      // Register the new hotkey BEFORE unregistering the old one.
      // This prevents a state where no hotkey is active if registration fails.
      const success = globalShortcut.register(hotkey, callback);

      if (success) {
        // New hotkey registered — now safe to unregister the old one
        if (
          this.currentHotkey &&
          this.currentHotkey !== "GLOBE" &&
          this.currentHotkey !== hotkey
        ) {
          globalShortcut.unregister(this.currentHotkey);
        }
        this.currentHotkey = hotkey;
        return { success: true, hotkey };
      } else {
        console.error(`Failed to register hotkey: ${hotkey}`);
        return {
          success: false,
          error: `Failed to register hotkey "${hotkey}". It may be reserved by the system or in use by another application.`,
        };
      }
    } catch (error) {
      console.error("Error setting up shortcuts:", error);
      return { success: false, error: error.message };
    }
  }

  async initializeHotkey(mainWindow, callback) {
    if (!mainWindow || !callback) {
      throw new Error("mainWindow and callback are required");
    }

    // Set up default hotkey first
    this.setupShortcuts("`", callback);

    // Listen for window to be ready, then get saved hotkey
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        this.loadSavedHotkey(mainWindow, callback);
      }, 1000);
    });

    this.isInitialized = true;
  }

  async loadSavedHotkey(mainWindow, callback) {
    try {
      // Get the saved hotkey from localStorage, or use platform-appropriate default
      // On macOS, default to GLOBE; on other platforms, default to backtick
      const savedHotkey = await mainWindow.webContents.executeJavaScript(`
        (function() {
          const saved = localStorage.getItem("dictationKey");
          if (saved) return saved;
          // Match the renderer's default: GLOBE on macOS, backtick elsewhere
          return window.electronAPI?.getPlatform?.() === "darwin" ? "GLOBE" : "\`";
        })()
      `);

      if (savedHotkey && savedHotkey !== "`") {
        const result = this.setupShortcuts(savedHotkey, callback);
        if (!result.success) {
          console.warn(
            `Failed to restore saved hotkey "${savedHotkey}": ${result.error}. Default hotkey remains active.`,
          );
        }
      }
    } catch (err) {
      console.error("Failed to get saved hotkey:", err);
    }
  }

  async updateHotkey(hotkey, callback) {
    if (!callback) {
      throw new Error("Callback function is required for hotkey update");
    }

    try {
      const result = this.setupShortcuts(hotkey, callback);
      if (result.success) {
        return { success: true, message: `Hotkey updated to: ${hotkey}` };
      } else {
        return { success: false, message: result.error };
      }
    } catch (error) {
      console.error("Failed to update hotkey:", error);
      return {
        success: false,
        message: `Failed to update hotkey: ${error.message}`,
      };
    }
  }

  getCurrentHotkey() {
    return this.currentHotkey;
  }

  unregisterAll() {
    globalShortcut.unregisterAll();
  }

  isHotkeyRegistered(hotkey) {
    return globalShortcut.isRegistered(hotkey);
  }
}

module.exports = HotkeyManager;
