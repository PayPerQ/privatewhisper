const { app, globalShortcut, BrowserWindow, dialog } = require("electron");

// Ensure macOS menus use the proper casing for the app name
if (process.platform === "darwin" && app && app.getName() !== "PPQ Whisper") {
  app.setName("PPQ Whisper");
}

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
const { exec, execSync } = require("child_process");

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
let currentHotkeyMode = "toggle"; // Updated via IPC when settings change
const FN_KEY_CODE = 63;
let shutdownRequested = false;

/**
 * macOS Globe key function values (AppleFnUsageType):
 * 0 = Do Nothing
 * 1 = Change Input Source
 * 2 = Show Emoji & Symbols (default)
 * 3 = Start Dictation
 */
let originalGlobeKeyFunction = null;
let globeKeyFunctionDisabled = false;

/**
 * Disable the Globe key's emoji picker by changing the system setting.
 * This is the only reliable way to prevent the emoji picker from appearing.
 *
 * Uses synchronous execution to ensure the setting is applied immediately,
 * and restarts cfprefsd to force the preference daemon to reload.
 */
function disableGlobeKeyEmojiPicker() {
  if (process.platform !== "darwin" || globeKeyFunctionDisabled) return;

  try {
    // Save original setting (synchronous)
    try {
      const stdout = execSync(
        "defaults read com.apple.HIToolbox AppleFnUsageType 2>/dev/null || echo 2",
        { encoding: "utf8", timeout: 5000 },
      );
      originalGlobeKeyFunction = parseInt(stdout.trim(), 10);
      if (isNaN(originalGlobeKeyFunction)) originalGlobeKeyFunction = 2;
    } catch {
      originalGlobeKeyFunction = 2;
    }

    // Set to "Do Nothing" (0) - synchronous to ensure it completes before proceeding
    execSync("defaults write com.apple.HIToolbox AppleFnUsageType -int 0", {
      encoding: "utf8",
      timeout: 5000,
    });

    // Force cfprefsd to reload preferences immediately
    // This ensures the new setting takes effect without requiring logout
    // Kill user-level cfprefsd (doesn't require sudo)
    try {
      execSync("killall -u $(whoami) cfprefsd 2>/dev/null || true", {
        encoding: "utf8",
        timeout: 5000,
        shell: "/bin/bash",
      });
    } catch {
      // Ignore errors - cfprefsd will auto-restart
    }

    globeKeyFunctionDisabled = true;
  } catch (error) {
    console.error("Failed to disable Globe key emoji picker:", error.message);
    // Fall back to async method if sync fails
    exec("defaults write com.apple.HIToolbox AppleFnUsageType -int 0", () => {
      globeKeyFunctionDisabled = true;
    });
  }
}

/**
 * Restore the original Globe key function when app quits or hotkey changes.
 * Uses synchronous execution to ensure restoration completes before app exits.
 */
function restoreGlobeKeyFunction() {
  if (process.platform !== "darwin" || !globeKeyFunctionDisabled) return;

  const valueToRestore =
    originalGlobeKeyFunction !== null ? originalGlobeKeyFunction : 2;
  try {
    execSync(
      `defaults write com.apple.HIToolbox AppleFnUsageType -int ${valueToRestore}`,
      { encoding: "utf8", timeout: 5000 },
    );
    // Force cfprefsd to reload
    try {
      execSync("killall -u $(whoami) cfprefsd 2>/dev/null || true", {
        encoding: "utf8",
        timeout: 5000,
        shell: "/bin/bash",
      });
    } catch {
      // Ignore errors
    }
    globeKeyFunctionDisabled = false;
  } catch (error) {
    console.error("Failed to restore Globe key function:", error.message);
    // Fall back to async if sync fails
    exec(
      `defaults write com.apple.HIToolbox AppleFnUsageType -int ${valueToRestore}`,
      () => {
        globeKeyFunctionDisabled = false;
      },
    );
  }
}

function cleanupGlobeListener() {
  try {
    if (globeKeyManager) globeKeyManager.stop();
  } catch {
    // best-effort cleanup
  }
  try {
    GlobeKeyManager.killAll();
  } catch {
    // ignore if pkill is unavailable
  }
}

function requestShutdown(reason, exitCode = 0) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.warn(`Shutting down due to ${reason}`);

  cleanupGlobeListener();

  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }
  try {
    if (updateManager) updateManager.cleanup();
  } catch {
    // ignore
  }
  try {
    restoreGlobeKeyFunction();
  } catch {
    // ignore
  }

  if (app && typeof app.isReady === "function" && app.isReady()) {
    try {
      app.quit();
    } catch {
      // ignore
    }
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 500);
}

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    return;
  }
  console.error("Error stack:", error.stack);
  requestShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  requestShutdown("unhandledRejection", 1);
});

["SIGTERM", "SIGINT", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => requestShutdown(signal, 0));
});

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
  // On macOS, default hotkey is GLOBE - disable emoji picker function immediately
  if (process.platform === "darwin") {
    disableGlobeKeyEmojiPicker();
  }
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
            "2. Add PPQ Whisper to the list\n" +
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
    globeKeyManager,
  });

  // Set up callback for hotkey listening mode changes
  ipcHandlers.onHotkeyListeningModeChange = (isListening) => {
    hotkeyListeningMode = isListening;
  };

  // Track hotkey changes (used for emoji picker suppression)
  ipcHandlers.onHotkeySettingsChange = ({ hotkey, hotkeyMode }) => {
    currentHotkeyMode = hotkeyMode;
    // Disable Globe key's emoji picker function when using Globe as hotkey
    if (hotkey === "GLOBE") {
      disableGlobeKeyEmojiPicker();
    } else {
      restoreGlobeKeyFunction();
    }
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

      // Broadcast globe-key-released for hotkey picker (allows key-up detection)
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("globe-key-released");
        }
      });

      // Only send hotkey-up if not in hotkey listening mode
      if (
        !hotkeyListeningMode &&
        hotkeyManager.getCurrentHotkey &&
        hotkeyManager.getCurrentHotkey() === "GLOBE" &&
        windowManager.mainWindow &&
        !windowManager.mainWindow.isDestroyed()
      ) {
        windowManager.mainWindow.webContents.send("dictation-hotkey-up");

        // Kill CharacterPalette immediately as backup (in case Swift-level kill didn't work)
        // This ensures the emoji picker never stays visible
        if (process.platform === "darwin") {
          exec("killall -9 CharacterPalette 2>/dev/null || true");
          // Kill again after short delays to catch late-spawning popover
          setTimeout(() => {
            exec("killall -9 CharacterPalette 2>/dev/null || true");
          }, 50);
          setTimeout(() => {
            exec("killall -9 CharacterPalette 2>/dev/null || true");
          }, 100);
        }
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

    // Handle modifier release for compound hotkeys in hold mode
    globeKeyManager.on("modifier-up", (modifierFlags) => {
      if (currentHotkeyMode !== "hold" || hotkeyListeningMode) return;

      const activeHotkey =
        typeof hotkeyManager.getCurrentHotkey === "function"
          ? hotkeyManager.getCurrentHotkey()
          : null;

      // Only relevant for compound hotkeys (contain "+")
      if (!activeHotkey || !activeHotkey.includes("+")) return;

      // Check if the released modifier was part of the compound hotkey
      // macOS CGEventFlags: Control=0x40000, Alt=0x80000, Shift=0x20000, Command=0x100000
      const modifierMap = {
        Control: 0x40000,
        Alt: 0x80000,
        Shift: 0x20000,
        Command: 0x100000,
      };

      const hotkeyModifiers = activeHotkey
        .split("+")
        .filter((part) =>
          ["Control", "Alt", "Shift", "Command"].includes(part),
        );

      const releasedRelevantModifier = hotkeyModifiers.some(
        (mod) => (modifierFlags & modifierMap[mod]) !== 0,
      );

      if (
        releasedRelevantModifier &&
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

  // Notify all renderer windows to clean up audio resources before the app quits.
  // This fires before window close events, giving the renderer a chance to stop
  // the microphone, close WebSocket connections, and release cached streams.
  app.on("before-quit", () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send("app-quitting");
      }
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (globeKeyManager) globeKeyManager.stop();
    if (updateManager) updateManager.cleanup();
    // Restore the user's original Globe key function
    restoreGlobeKeyFunction();
  });
}

// Start the app setup process
setupApp();
