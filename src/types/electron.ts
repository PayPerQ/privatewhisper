export interface TranscriptionItem {
  id: number;
  text: string;
  timestamp: string;
  created_at: string;
}

export interface DictionaryTerm {
  id: number;
  term: string;
  created_at: string;
}

export interface HotkeyUpdateResult {
  success: boolean;
  message?: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: any[];
  releaseNotes?: string;
  message?: string;
}

export interface UpdateStatusResult {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
}

export interface UpdateInfoResult {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: any[];
}

export interface UpdateResult {
  success: boolean;
  message: string;
}

export interface AppVersionResult {
  version: string;
}

// Additional interface missing from preload.js
export interface SaveSettings {
  apiKey: string;
  hotkey: string;
}

declare global {
  interface Window {
    electronAPI: {
      // Basic window operations
      pasteText: (text: string) => Promise<void>;
      hideWindow: () => Promise<void>;
      showDictationPanel: () => Promise<void>;
      onToggleDictation: (callback: () => void) => (() => void) | void;
      onDictationHotkeyUp?: (callback: () => void) => (() => void) | void;

      // Database operations
      saveTranscription: (text: string) => Promise<{
        id: number;
        success: boolean;
        transcription: TranscriptionItem;
      }>;
      getTranscriptions: (limit?: number) => Promise<TranscriptionItem[]>;
      clearTranscriptions: () => Promise<{ cleared: number; success: boolean }>;
      deleteTranscription: (
        id: number,
      ) => Promise<{ success: boolean; id: number }>;

      // API key management
      getPPQKey: () => Promise<string>;
      savePPQKey: (key: string) => Promise<{ success: boolean }>;
      createProductionEnvFile: (key: string) => Promise<void>;

      // Clipboard operations
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<{ success: boolean }>;
      pasteFromClipboard: () => Promise<{ success: boolean; error?: string }>;
      pasteFromClipboardWithFallback: () => Promise<{
        success: boolean;
        error?: string;
      }>;

      // Settings
      getSettings: () => Promise<any>;
      updateSettings: (settings: any) => Promise<void>;

      // Audio
      getAudioDevices: () => Promise<MediaDeviceInfo[]>;
      transcribeAudio: (audioData: ArrayBuffer) => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;

      // Window control operations
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      getPlatform: () => string;
      startWindowDrag: () => Promise<void>;
      stopWindowDrag: () => Promise<void>;
      setMainWindowInteractivity: (interactive: boolean) => Promise<void>;

      // App management
      cleanupApp: () => Promise<{
        success: boolean;
        message: string;
        relaunch?: boolean;
      }>;
      getTranscriptionHistory: () => Promise<any[]>;
      clearTranscriptionHistory: () => Promise<void>;

      // Update operations
      checkForUpdates: () => Promise<UpdateCheckResult>;
      downloadUpdate: () => Promise<UpdateResult>;
      installUpdate: () => Promise<UpdateResult>;
      getAppVersion: () => Promise<AppVersionResult>;
      getUpdateStatus: () => Promise<UpdateStatusResult>;
      getUpdateInfo: () => Promise<UpdateInfoResult | null>;

      // Update event listeners
      onUpdateAvailable: (callback: (event: any, info: any) => void) => void;
      onUpdateNotAvailable: (callback: (event: any, info: any) => void) => void;
      onUpdateDownloaded: (callback: (event: any, info: any) => void) => void;
      onUpdateDownloadProgress: (
        callback: (event: any, progressObj: any) => void,
      ) => void;
      onUpdateError: (callback: (event: any, error: any) => void) => void;
      onUpdateInstallTimeout?: (
        callback: (event: any, info: { message?: string }) => void,
      ) => void;

      // Settings management (used by OnboardingFlow but not in preload.js)
      saveSettings?: (settings: SaveSettings) => Promise<void>;

      // External URL operations
      openExternal: (
        url: string,
      ) => Promise<{ success: boolean; error?: string }>;

      // Event listener cleanup
      removeAllListeners: (channel: string) => void;

      // Hotkey management
      updateHotkey: (key: string) => Promise<HotkeyUpdateResult>;
      updateHotkeyMode?: (
        mode: "toggle" | "hold",
      ) => Promise<{ success: boolean }>;
      onHotkeyModeChanged?: (
        callback: (mode: "toggle" | "hold") => void,
      ) => () => void;

      // Transcription event listeners
      onTranscriptionAdded?: (
        callback: (item: TranscriptionItem) => void,
      ) => () => void;
      onTranscriptionDeleted?: (callback: (id: number) => void) => () => void;
      onTranscriptionsCleared?: (
        callback: (payload: { cleared: number }) => void,
      ) => () => void;

      // Dictionary operations
      getDictionary?: () => Promise<DictionaryTerm[]>;
      addDictionaryTerm?: (term: string) => Promise<{
        success: boolean;
        term?: DictionaryTerm;
        duplicate?: boolean;
        error?: string;
      }>;
      removeDictionaryTerm?: (
        id: number,
      ) => Promise<{ success: boolean; id: number }>;
      clearDictionary?: () => Promise<{ cleared: number; success: boolean }>;

      // Dictionary event listeners
      onDictionaryTermAdded?: (
        callback: (term: DictionaryTerm) => void,
      ) => () => void;
      onDictionaryTermRemoved?: (callback: (id: number) => void) => () => void;
      onDictionaryCleared?: (
        callback: (payload: { cleared: number }) => void,
      ) => () => void;

      // Debug logging
      logReasoning?: (stage: string, details: any) => Promise<void>;
      logDebugEvent?: (
        channel: string,
        event: string,
        details?: Record<string, any>,
        level?: "debug" | "info" | "warn" | "error",
      ) => Promise<void>;
      getDebugMode?: () => Promise<boolean>;
      logPipelineMetrics?: (
        payload: Record<string, any>,
      ) => Promise<{ queued: boolean }>;

      // FFmpeg availability
      checkFFmpegAvailability: () => Promise<boolean>;

      // Globe key detection for hotkey picker (macOS only)
      onGlobeKeyDetected?: (callback: () => void) => () => void;
      onGlobeKeyReleased?: (callback: () => void) => () => void;

      // Open macOS accessibility settings (macOS only)
      openAccessibilitySettings?: () => Promise<{
        success: boolean;
        error?: string;
      }>;

      // Check if accessibility permissions are granted (macOS only)
      checkAccessibilityPermissions?: () => Promise<{
        granted: boolean;
        error?: string;
      }>;

      // Set hotkey listening mode - suppresses dictation trigger during hotkey selection
      setHotkeyListeningMode?: (isListening: boolean) => Promise<{
        success: boolean;
      }>;

      // Check macOS F-key mode (macOS only)
      // standardFunctionKeys: true = F-keys work as standard (no Fn needed)
      // standardFunctionKeys: false = F-keys trigger special features (Fn needed)
      getFnKeyMode?: () => Promise<{
        standardFunctionKeys: boolean;
      }>;

      // Update globe key listener mode based on current hotkey and mode settings (macOS only)
      // This configures the native listener to suppress the hotkey's default system action
      updateGlobeListenerMode?: (
        hotkey: string,
        hotkeyMode: "toggle" | "hold",
      ) => Promise<{
        success: boolean;
        globeOnly: boolean;
        suppressKey?: string | null;
      }>;
    };

    api?: {
      sendDebugLog: (message: string) => void;
    };
  }
}
