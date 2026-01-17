const { app, globalShortcut, BrowserWindow, dialog } = require("electron");

// Ensure macOS menus use the proper casing for the app name
if (process.platform === "darwin" && app && app.getName() !== "PPQ Voice") {
  app.setName("PPQ Voice");
}

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    return;
  }
  // For other errors, log and continue
  console.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Import helper modules (but don't instantiate yet)
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const TrayManager = require("./src/helpers/tray");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const EdgeFunctionLogger = require("./src/helpers/edgeFunctionLogger");
const UpdateManager = require("./src/updater");
const GlobeKeyManager = require("./src/helpers/globeKeyManager");
const { matchesMacKeyCode } = require("./src/helpers/hotkeyKeycodes");

// Manager instances (will be initialized after app is ready)
let environmentManager;
let windowManager;
let hotkeyManager;
let databaseManager;
let clipboardManager;
let trayManager;
let updateManager;
let globeKeyManager;
let edgeFunctionLogger;
let ipcHandlers;
let globeKeyAlertShown = false;
let hotkeyListeningMode = false; // Suppresses dictation trigger when user is selecting a hotkey
let globeKeyIsDown = false;
const FN_KEY_CODE = 63;

// Bypass certificate verification in development
if (process.env.NODE_ENV === "development") {
  app.commandLine.appendSwitch("ignore-certificate-errors");
}

// Main application startup
async function startApp() {
  // Initialize all managers after app is ready
  environmentManager = new EnvironmentManager();
  windowManager = new WindowManager();
  hotkeyManager = windowManager.hotkeyManager;
  databaseManager = new DatabaseManager();
  clipboardManager = new ClipboardManager();
  trayManager = new TrayManager();
  updateManager = new UpdateManager();
  globeKeyManager = new GlobeKeyManager();
  edgeFunctionLogger = new EdgeFunctionLogger(
    environmentManager,
    app.getVersion(),
  );

  // Set up Globe key error handler (macOS only)
  if (process.platform === "darwin") {
    globeKeyManager.on("error", (error) => {
      if (!globeKeyAlertShown) {
        globeKeyAlertShown = true;
        dialog.showMessageBox({
          type: "warning",
          title: "Globe Key Support",
          message: "Globe Key Detection Unavailable",
          detail:
            "The Globe key (🌐) detection feature requires system accessibility permissions. " +
            "You can still use keyboard shortcuts like the backtick (`) or Cmd+Shift+Space. " +
            "\n\nTo enable Globe key support:\n" +
            "1. Open System Settings → Privacy & Security → Accessibility\n" +
            "2. Add PPQ Voice to the list\n" +
            "3. Restart the app\n\n" +
            `Technical details: ${error.message}`,
          buttons: ["OK"],
        });
      }
    });
  }

  // Initialize IPC handlers with all managers
  ipcHandlers = new IPCHandlers({
    environmentManager,
    databaseManager,
    clipboardManager,
    windowManager,
    edgeFunctionLogger,
  });

  // Set up callback for hotkey listening mode changes
  ipcHandlers.onHotkeyListeningModeChange = (isListening) => {
    hotkeyListeningMode = isListening;
  };

  // In development, add a small delay to let Vite start properly
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Ensure dock is visible on macOS and stays visible
  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
    // Prevent dock from hiding when windows use setVisibleOnAllWorkspaces
    app.setActivationPolicy("regular");
  }

  // Create main window
  try {
    await windowManager.createMainWindow();
  } catch (error) {
    console.error("Error creating main window:", error);
  }

  // Create control panel window
  try {
    await windowManager.createControlPanelWindow();
  } catch (error) {
    console.error("Error creating control panel window:", error);
  }

  // Set up tray
  trayManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow,
  );
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() =>
    windowManager.createControlPanelWindow(),
  );
  await trayManager.createTray();

  // Set windows for update manager and check for updates
  updateManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow,
  );
  updateManager.checkForUpdatesOnStartup();

  if (process.platform === "darwin") {
    const handleGlobeDown = () => {
      if (globeKeyIsDown) return;
      globeKeyIsDown = true;

      // Always broadcast globe-key-detected for hotkey picker
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("globe-key-detected");
        }
      });

      // Only trigger dictation if not in hotkey listening mode
      if (
        !hotkeyListeningMode &&
        hotkeyManager.getCurrentHotkey &&
        hotkeyManager.getCurrentHotkey() === "GLOBE"
      ) {
        if (
          windowManager.mainWindow &&
          !windowManager.mainWindow.isDestroyed()
        ) {
          windowManager.showDictationPanel();
          windowManager.mainWindow.webContents.send("toggle-dictation");
        }
      }
    };

    const handleGlobeUp = () => {
      if (!globeKeyIsDown) return;
      globeKeyIsDown = false;

      // Only send hotkey-up if not in hotkey listening mode
      if (
        !hotkeyListeningMode &&
        hotkeyManager.getCurrentHotkey &&
        hotkeyManager.getCurrentHotkey() === "GLOBE" &&
        windowManager.mainWindow &&
        !windowManager.mainWindow.isDestroyed()
      ) {
        windowManager.mainWindow.webContents.send("dictation-hotkey-up");
      }
    };

    globeKeyManager.on("globe-down", handleGlobeDown);
    globeKeyManager.on("globe-up", handleGlobeUp);

    globeKeyManager.on("key-down", (keyCode) => {
      if (Number(keyCode) === FN_KEY_CODE) {
        handleGlobeDown();
      }
    });

    globeKeyManager.on("key-up", (keyCode) => {
      if (Number(keyCode) === FN_KEY_CODE) {
        handleGlobeUp();
        return;
      }

      const activeHotkey =
        typeof hotkeyManager.getCurrentHotkey === "function"
          ? hotkeyManager.getCurrentHotkey()
          : null;

      if (
        activeHotkey &&
        matchesMacKeyCode(activeHotkey, keyCode) &&
        windowManager.mainWindow &&
        !windowManager.mainWindow.isDestroyed()
      ) {
        windowManager.mainWindow.webContents.send("dictation-hotkey-up");
      }
    });

    globeKeyManager.start();
  }
}

// App event handlers
// Wait for app to be ready with retry logic
function setupApp() {
  if (!app || !app.whenReady) {
    // App not ready yet, try again on next tick
    setImmediate(setupApp);
    return;
  }

  app.whenReady().then(() => {
    // Hide dock icon on macOS for a cleaner experience
    // The app will still show in the menu bar and command bar
    if (process.platform === "darwin" && app.dock) {
      // Keep dock visible for now to maintain command bar access
      // We can hide it later if needed: app.dock.hide()
    }

    startApp();
  });

  app.on("window-all-closed", () => {
    // Don't quit on macOS when all windows are closed
    // The app should stay in the dock/menu bar
    if (process.platform !== "darwin") {
      app.quit();
    }
    // On macOS, keep the app running even without windows
  });

  // Re-apply always-on-top when app becomes active
  app.on("browser-window-focus", (event, window) => {
    // Only apply always-on-top to the dictation window, not the control panel
    if (
      windowManager &&
      windowManager.mainWindow &&
      !windowManager.mainWindow.isDestroyed()
    ) {
      // Check if the focused window is the dictation window
      if (window === windowManager.mainWindow) {
        windowManager.enforceMainWindowOnTop();
      }
    }

    // Control panel doesn't need any special handling on focus
    // It should behave like a normal window
  });

  app.on("activate", () => {
    // On macOS, re-create windows when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      if (windowManager) {
        windowManager.createMainWindow();
        windowManager.createControlPanelWindow();
      }
    } else {
      // Show control panel when dock icon is clicked (most common user action)
      if (
        windowManager &&
        windowManager.controlPanelWindow &&
        !windowManager.controlPanelWindow.isDestroyed()
      ) {
        windowManager.controlPanelWindow.show();
        windowManager.controlPanelWindow.focus();
      } else if (windowManager) {
        // If control panel doesn't exist, create it
        windowManager.createControlPanelWindow();
      }

      // Ensure dictation panel maintains its always-on-top status
      if (
        windowManager &&
        windowManager.mainWindow &&
        !windowManager.mainWindow.isDestroyed()
      ) {
        windowManager.enforceMainWindowOnTop();
      }
    }
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (globeKeyManager) globeKeyManager.stop();
    if (updateManager) updateManager.cleanup();
  });
}

// Start the app setup process
setupApp();
