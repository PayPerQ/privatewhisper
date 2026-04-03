const { contextBridge, ipcRenderer } = require("electron");

const exposeListener = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("electronAPI", {
  pasteText: (text) => ipcRenderer.invoke("paste-text", text),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  onToggleDictation: (callback) => {
    ipcRenderer.on("toggle-dictation", callback);
    return () => ipcRenderer.removeListener("toggle-dictation", callback);
  },
  onDictationHotkeyUp: (callback) => {
    ipcRenderer.on("dictation-hotkey-up", callback);
    return () => ipcRenderer.removeListener("dictation-hotkey-up", callback);
  },

  // Database functions
  saveTranscription: (text) =>
    ipcRenderer.invoke("db-save-transcription", text),
  getTranscriptions: (limit) =>
    ipcRenderer.invoke("db-get-transcriptions", limit),
  clearTranscriptions: () => ipcRenderer.invoke("db-clear-transcriptions"),
  deleteTranscription: (id) =>
    ipcRenderer.invoke("db-delete-transcription", id),

  // Environment variables
  getPPQKey: () => ipcRenderer.invoke("get-ppq-key"),
  savePPQKey: (key) => ipcRenderer.invoke("save-ppq-key", key),
  createProductionEnvFile: (key) =>
    ipcRenderer.invoke("create-production-env-file", key),

  // Settings management
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // Clipboard functions
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),

  // Window control functions
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  getPlatform: () => process.platform,

  // Cleanup function
  cleanupApp: () => ipcRenderer.invoke("cleanup-app"),
  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  startWindowDrag: () => ipcRenderer.invoke("start-window-drag"),
  stopWindowDrag: () => ipcRenderer.invoke("stop-window-drag"),
  setMainWindowInteractivity: (interactive) =>
    ipcRenderer.invoke("set-main-window-interactivity", interactive),
  resizeMainWindow: (width, height) =>
    ipcRenderer.invoke("resize-main-window", width, height),

  // Update functions
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),

  // Update event listeners
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", callback),
  onUpdateNotAvailable: (callback) =>
    ipcRenderer.on("update-not-available", callback),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update-downloaded", callback),
  onUpdateDownloadProgress: (callback) =>
    ipcRenderer.on("update-download-progress", callback),
  onUpdateError: (callback) => ipcRenderer.on("update-error", callback),
  onUpdateInstallTimeout: (callback) =>
    ipcRenderer.on("update-install-timeout", callback),

  // External link opener
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Debug logging for reasoning pipeline
  logReasoning: (stage, details) =>
    ipcRenderer.invoke("log-reasoning", stage, details),
  logDebugEvent: (channel, event, details, level) =>
    ipcRenderer.invoke("debug-log", {
      channel,
      event,
      details,
      level,
    }),
  getDebugMode: async () => {
    const result = await ipcRenderer.invoke("get-debug-mode");
    return Boolean(result?.enabled);
  },
  logPipelineMetrics: (payload) =>
    ipcRenderer.invoke("log-pipeline-metrics", payload),

  // Log viewer
  getLogFiles: () => ipcRenderer.invoke("get-log-files"),
  readLogFile: (filePath) => ipcRenderer.invoke("read-log-file", filePath),
  collectDiagnosticLogs: () => ipcRenderer.invoke("collect-diagnostic-logs"),

  // Remove all listeners for a channel
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Transcription change listeners
  onTranscriptionAdded: (callback) =>
    exposeListener("transcription-added", callback),
  onTranscriptionDeleted: (callback) =>
    exposeListener("transcription-deleted", callback),
  onTranscriptionsCleared: (callback) =>
    exposeListener("transcriptions-cleared", callback),

  // Dictionary functions
  getDictionary: () => ipcRenderer.invoke("db-get-dictionary"),
  addDictionaryTerm: (term) =>
    ipcRenderer.invoke("db-add-dictionary-term", term),
  removeDictionaryTerm: (id) =>
    ipcRenderer.invoke("db-remove-dictionary-term", id),
  clearDictionary: () => ipcRenderer.invoke("db-clear-dictionary"),

  // Dictionary change listeners
  onDictionaryTermAdded: (callback) =>
    exposeListener("dictionary-term-added", callback),
  onDictionaryTermRemoved: (callback) =>
    exposeListener("dictionary-term-removed", callback),
  onDictionaryCleared: (callback) =>
    exposeListener("dictionary-cleared", callback),

  // Auto-learn controls
  setAutoLearnEnabled: (enabled) =>
    ipcRenderer.send("auto-learn-changed", enabled),
  onCorrectionsLearned: (callback) =>
    exposeListener("corrections-learned", callback),
  undoLearnedCorrections: (words) =>
    ipcRenderer.invoke("undo-learned-corrections", words),
  onDictionaryUpdated: (callback) =>
    exposeListener("dictionary-updated", callback),

  // Settings sync - broadcast to all windows
  updateHotkeyMode: (mode) => ipcRenderer.invoke("update-hotkey-mode", mode),
  onHotkeyModeChanged: (callback) =>
    exposeListener("hotkey-mode-changed", callback),

  // Update globe key listener mode based on current hotkey and mode settings
  // Returns { success: boolean, globeOnly: boolean }
  updateGlobeListenerMode: (hotkey, hotkeyMode) =>
    ipcRenderer.invoke("update-globe-listener-mode", { hotkey, hotkeyMode }),

  // Globe key detection for hotkey picker (macOS only)
  onGlobeKeyDetected: (callback) =>
    exposeListener("globe-key-detected", callback),
  onGlobeKeyReleased: (callback) =>
    exposeListener("globe-key-released", callback),

  // Open macOS accessibility settings (macOS only)
  openAccessibilitySettings: () =>
    ipcRenderer.invoke("open-accessibility-settings"),

  // Check if accessibility permissions are granted (macOS only)
  // Returns { granted: boolean, error?: string }
  checkAccessibilityPermissions: () =>
    ipcRenderer.invoke("check-accessibility-permissions"),

  // Set hotkey listening mode - suppresses dictation trigger during hotkey selection
  setHotkeyListeningMode: (isListening) =>
    ipcRenderer.invoke("set-hotkey-listening-mode", isListening),

  // Check macOS F-key mode (macOS only)
  // Returns { standardFunctionKeys: boolean }
  // true = F-keys work as standard function keys (no Fn needed)
  // false = F-keys trigger special features (Fn needed for actual F-key)
  getFnKeyMode: () => ipcRenderer.invoke("get-fn-key-mode"),

  // App lifecycle - notifies renderer to clean up audio resources before quit
  onAppQuitting: (callback) => exposeListener("app-quitting", callback),

  // Private proxy controls
  startPrivateProxy: () => ipcRenderer.invoke("private-proxy-start"),
  stopPrivateProxy: () => ipcRenderer.invoke("private-proxy-stop"),
  getPrivateProxyStatus: () => ipcRenderer.invoke("private-proxy-status"),
  onPrivateProxyStatusChanged: (callback) =>
    exposeListener("private-proxy-status-changed", callback),

  // Parakeet local transcription
  transcribeLocalParakeet: (audioData, options) =>
    ipcRenderer.invoke("transcribe-local-parakeet", audioData, options),
  checkParakeetInstallation: () =>
    ipcRenderer.invoke("check-parakeet-installation"),
  downloadParakeetModel: (modelName) =>
    ipcRenderer.invoke("download-parakeet-model", modelName),
  onParakeetDownloadProgress: (callback) =>
    exposeListener("parakeet-download-progress", callback),
  cancelParakeetDownload: () =>
    ipcRenderer.invoke("cancel-parakeet-download"),
  checkParakeetModelStatus: (modelName) =>
    ipcRenderer.invoke("check-parakeet-model-status", modelName),
  listParakeetModels: () => ipcRenderer.invoke("list-parakeet-models"),
  deleteParakeetModel: (modelName) =>
    ipcRenderer.invoke("delete-parakeet-model", modelName),
  parakeetServerStart: (modelName) =>
    ipcRenderer.invoke("parakeet-server-start", modelName),
  parakeetServerStop: () => ipcRenderer.invoke("parakeet-server-stop"),
  parakeetServerStatus: () => ipcRenderer.invoke("parakeet-server-status"),
  onParakeetServerStatusChanged: (callback) =>
    exposeListener("parakeet-server-status-changed", callback),

  // Sherpa-onnx binary runtime installer
  installSherpaOnnx: () => ipcRenderer.invoke("install-sherpa-onnx"),
  cancelSherpaOnnxInstall: () => ipcRenderer.invoke("cancel-sherpa-onnx-install"),
  checkSherpaOnnxStatus: () => ipcRenderer.invoke("check-sherpa-onnx-status"),
  onSherpaOnnxInstallProgress: (callback) =>
    exposeListener("sherpa-onnx-install-progress", callback),
});
