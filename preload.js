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
  onToggleDictation: (callback) => ipcRenderer.on("toggle-dictation", callback),

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
});
