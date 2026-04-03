const { app, screen, BrowserWindow, session } = require("electron");
const HotkeyManager = require("./hotkeyManager");
const DragManager = require("./dragManager");
const MenuManager = require("./menuManager");
const DevServerManager = require("./devServerManager");
const debugLogger = require("./debugLogger");
const {
  MAIN_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  WindowPositionUtil,
} = require("./windowConfig");

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.tray = null;
    this.hotkeyManager = new HotkeyManager();
    this.dragManager = new DragManager();
    this.isQuitting = false;
    this.isMainWindowInteractive = false;
    this._dictationPanelHidden = true;

    app.on("before-quit", () => {
      this.isQuitting = true;
    });
  }

  async createMainWindow() {
    const display = screen.getPrimaryDisplay();
    const position = WindowPositionUtil.getMainWindowPosition(display);

    this.mainWindow = new BrowserWindow({
      ...MAIN_WINDOW_CONFIG,
      ...position,
    });

    if (process.platform === "darwin") {
      this.mainWindow.setSkipTaskbar(false);
    } else if (process.platform === "win32") {
      this.mainWindow.setSkipTaskbar(true);
    }

    this.setMainWindowInteractivity(false);
    this.registerMainWindowEvents();

    await this.loadMainWindow();
    await this.initializeHotkey();
    this.dragManager.setTargetWindow(this.mainWindow);
    MenuManager.setupMainMenu();

    this.mainWindow.webContents.on(
      "did-fail-load",
      async (_event, errorCode, errorDescription, validatedURL) => {
        debugLogger.error("window", "main-window-load-failed", {
          errorCode,
          errorDescription,
          validatedURL,
        });
        if (
          process.env.NODE_ENV === "development" &&
          validatedURL.includes("localhost:5174")
        ) {
          // Retry connection to dev server
          setTimeout(async () => {
            const isReady = await DevServerManager.waitForDevServer();
            if (isReady) {
              debugLogger.logEvent("window", "dev-server-ready", {
                window: "main",
                action: "reload",
              });
              this.mainWindow.reload();
            }
          }, 2000);
        }
      },
    );

    this.mainWindow.webContents.on("did-finish-load", () => {
      this.enforceMainWindowOnTop();
    });
  }

  setMainWindowInteractivity(shouldCapture) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    if (shouldCapture) {
      this.mainWindow.setIgnoreMouseEvents(false);
    } else {
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    this.isMainWindowInteractive = shouldCapture;
  }

  resizeMainWindow(width, height) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    // Anchor resize to the bottom-right corner so the button stays in place.
    const [oldW, oldH] = this.mainWindow.getSize();
    if (oldW === width && oldH === height) return;
    const [x, y] = this.mainWindow.getPosition();
    this.mainWindow.setBounds({
      x: x + oldW - width,
      y: y + oldH - height,
      width,
      height,
    });
  }

  async loadMainWindow() {
    const appUrl = DevServerManager.getAppUrl(false);
    if (process.env.NODE_ENV === "development") {
      const isReady = await DevServerManager.waitForDevServer();
      if (!isReady) {
        // Dev server not ready, continue anyway
      }
    }
    this.mainWindow.loadURL(appUrl);
  }

  async initializeHotkey() {
    const callback = () => {
      if (this.textEditMonitor) this.textEditMonitor.captureTargetPid();
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      this.mainWindow.webContents.send("toggle-dictation");
    };

    await this.hotkeyManager.initializeHotkey(this.mainWindow, callback);
  }

  async updateHotkey(hotkey) {
    const callback = () => {
      if (this.textEditMonitor) this.textEditMonitor.captureTargetPid();
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      this.mainWindow.webContents.send("toggle-dictation");
    };

    return await this.hotkeyManager.updateHotkey(hotkey, callback);
  }

  async startWindowDrag() {
    return await this.dragManager.startWindowDrag();
  }

  async stopWindowDrag() {
    return await this.dragManager.stopWindowDrag();
  }

  minimizeControlPanel() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      this.controlPanelWindow.minimize();
    }
  }

  maximizeControlPanel() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      if (this.controlPanelWindow.isMaximized()) {
        this.controlPanelWindow.unmaximize();
      } else {
        this.controlPanelWindow.maximize();
      }
    }
  }

  closeControlPanel() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      this.controlPanelWindow.close();
    }
  }

  isControlPanelMaximized() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      return this.controlPanelWindow.isMaximized();
    }
    return false;
  }

  isMainWindowValid() {
    return this.mainWindow && !this.mainWindow.isDestroyed();
  }

  isControlPanelValid() {
    return this.controlPanelWindow && !this.controlPanelWindow.isDestroyed();
  }

  async createControlPanelWindow() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      if (this.controlPanelWindow.isMinimized()) {
        this.controlPanelWindow.restore();
      }
      if (!this.controlPanelWindow.isVisible()) {
        this.controlPanelWindow.show();
      }
      this.controlPanelWindow.focus();
      return;
    }

    this.controlPanelWindow = new BrowserWindow(CONTROL_PANEL_CONFIG);

    // Allow Chatwoot widget to load by removing blocking headers from all chatwoot requests
    // Use the default session to ensure it applies to iframes as well
    session.defaultSession.webRequest.onHeadersReceived(
      {
        urls: [
          "*://app.chatwoot.com/*",
          "*://*.chatwoot.com/*",
          "https://app.chatwoot.com/*",
        ],
      },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        // Remove headers that block iframe embedding (check all case variants)
        Object.keys(responseHeaders).forEach((key) => {
          const lowerKey = key.toLowerCase();
          if (
            lowerKey === "x-frame-options" ||
            lowerKey === "content-security-policy" ||
            lowerKey === "x-content-security-policy"
          ) {
            delete responseHeaders[key];
          }
        });
        callback({ responseHeaders });
      },
    );

    this.controlPanelWindow.once("ready-to-show", () => {
      if (process.platform === "win32") {
        this.controlPanelWindow.setSkipTaskbar(false);
      }
      this.controlPanelWindow.show();
      this.controlPanelWindow.focus();
    });

    this.controlPanelWindow.on("show", () => {
      if (process.platform === "win32") {
        this.controlPanelWindow.setSkipTaskbar(false);
      }
    });

    this.controlPanelWindow.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.hideControlPanelToTray();
      }
    });

    this.controlPanelWindow.on("closed", () => {
      this.controlPanelWindow = null;
    });

    // Set up menu for control panel to ensure text input works
    MenuManager.setupControlPanelMenu(this.controlPanelWindow);

    debugLogger.logEvent("window", "load-control-panel");
    await this.loadControlPanel();
  }

  async loadControlPanel() {
    const appUrl = DevServerManager.getAppUrl(true);
    if (process.env.NODE_ENV === "development") {
      const isReady = await DevServerManager.waitForDevServer();
      if (!isReady) {
        debugLogger.error("window", "dev-server-missing-control-panel");
      }
    }
    this.controlPanelWindow.loadURL(appUrl);
  }

  showDictationPanel(options = {}) {
    const { focus = false } = options;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (!this.mainWindow.isVisible()) {
        if (typeof this.mainWindow.showInactive === "function") {
          this.mainWindow.showInactive();
        } else {
          this.mainWindow.show();
        }
      }
      if (this._dictationPanelHidden) {
        this.mainWindow.setOpacity(1);
        this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
        this._dictationPanelHidden = false;
      }
      if (focus) {
        this.mainWindow.focus();
      }
    }
  }

  hideControlPanelToTray() {
    if (!this.controlPanelWindow || this.controlPanelWindow.isDestroyed()) {
      return;
    }

    if (process.platform === "win32") {
      this.controlPanelWindow.setSkipTaskbar(true);
    }

    this.controlPanelWindow.hide();
  }

  hideDictationPanel() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setOpacity(0);
      this.mainWindow.setIgnoreMouseEvents(true, { forward: false });
      this._dictationPanelHidden = true;
    }
  }

  isDictationPanelVisible() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    if (this.mainWindow.isMinimized && this.mainWindow.isMinimized()) {
      return false;
    }

    return this.mainWindow.isVisible() && !this._dictationPanelHidden;
  }

  registerMainWindowEvents() {
    if (!this.mainWindow) {
      return;
    }

    this.mainWindow.once("ready-to-show", () => {
      this.enforceMainWindowOnTop();
      if (!this.mainWindow.isVisible()) {
        if (typeof this.mainWindow.showInactive === "function") {
          this.mainWindow.showInactive();
        } else {
          this.mainWindow.show();
        }
      }
    });

    this.mainWindow.on("show", () => {
      this.enforceMainWindowOnTop();
    });

    this.mainWindow.on("focus", () => {
      this.enforceMainWindowOnTop();
    });

    this.mainWindow.on("blur", () => {
      setTimeout(() => {
        this.enforceMainWindowOnTop();
      }, 100);
    });

    this.mainWindow.on("closed", () => {
      this.dragManager.cleanup();
      this.mainWindow = null;
      this.isMainWindowInteractive = false;
    });
  }

  enforceMainWindowOnTop() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      WindowPositionUtil.setupAlwaysOnTop(this.mainWindow);
    }
  }
}

module.exports = WindowManager;
