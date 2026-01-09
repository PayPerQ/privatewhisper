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

    if (this.currentHotkey && this.currentHotkey !== "GLOBE") {
      globalShortcut.unregister(this.currentHotkey);
    }

    try {
      if (hotkey === "GLOBE") {
        if (process.platform !== "darwin") {
          return {
            success: false,
            error: "The Globe key is only available on macOS.",
          };
        }
        this.currentHotkey = hotkey;
        return { success: true, hotkey };
      }

      const isAlreadyRegistered = globalShortcut.isRegistered(hotkey);
      if (isAlreadyRegistered) {
        console.error(`Hotkey already in use: ${hotkey}`);
        return {
          success: false,
          error: `The hotkey "${hotkey}" is already in use by another application. Please choose a different key.`,
        };
      }

      // Register the new hotkey
      const success = globalShortcut.register(hotkey, callback);

      if (success) {
        this.currentHotkey = hotkey;
        return { success: true, hotkey };
      } else {
        console.error(`Failed to register hotkey: ${hotkey}`);
        return {
          success: false,
          error: `Failed to register hotkey "${hotkey}". It may be reserved by the system or another application.`,
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
      const savedHotkey = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem("dictationKey") || "\`"
      `);

      if (savedHotkey && savedHotkey !== "`") {
        const result = this.setupShortcuts(savedHotkey, callback);
        if (result.success) {
          // Hotkey initialized from localStorage
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
