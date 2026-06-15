import { useCallback, useEffect, useRef } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type ReasoningProvider = "ppq" | "tinfoil" | "local-gemma";

const DEFAULT_GEMMA_MODEL = "gemma-4-e2b-it-q4_k_m";

// Runs once at module load, BEFORE any `useLocalStorage` read, so the first
// render already sees migrated values. Keeps `privateModeEnabled` and
// `privateModel` in storage as rollback insurance — we just stop reading them.
function migrateReasoningProvider(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem("reasoningProvider") !== null) return;
    const legacyFlag = localStorage.getItem("privateModeEnabled");
    const provider: ReasoningProvider = legacyFlag === "true" ? "tinfoil" : "ppq";
    localStorage.setItem("reasoningProvider", provider);
    const legacyModel = localStorage.getItem("privateModel");
    if (legacyModel && localStorage.getItem("tinfoilModel") === null) {
      localStorage.setItem("tinfoilModel", legacyModel);
    }
  } catch {
    // localStorage may be unavailable or full — skip silently
  }
}
migrateReasoningProvider();

export interface TranscriptionSettings {
  preferredLanguage: string;
}

export type HotkeyMode = "toggle" | "hold";

export interface HotkeySettings {
  dictationKey: string;
  hotkeyMode: HotkeyMode;
}

export interface ApiKeySettings {
  ppqApiKey: string;
}

export interface AudioSettings {
  audioCuesEnabled: boolean;
  alwaysUseBuiltInMic: boolean;
  preferredMicrophoneId: string;
}

export interface PrivacySettings {
  mipOptOut: boolean; // Opt out of Deepgram Model Improvement Partnership (default: true = opted out)
  privateModeEnabled: boolean; // Route reasoning through encrypted private proxy (derived from reasoningProvider)
  privateModel: string; // Alias for tinfoilModel (kept for deprecation window)
}

export interface ReasoningSettings {
  reasoningProvider: ReasoningProvider;
  tinfoilModel: string;
  gemmaModel: string;
  gemmaIdleShutdownEnabled: boolean;
}

export type TranscriptionProvider = "cloud" | "local";

export interface LocalTranscriptionSettings {
  transcriptionProvider: TranscriptionProvider;
  parakeetModel: string;
}

export interface CleanupSettings {
  llmCleanupEnabled: boolean;
}

export interface AppearanceSettings {
  showIconOnlyWhenActive: boolean;
}

function getDefaultHotkey(): string {
  if (typeof window === "undefined") return "Shift+F9";
  const platform = window.electronAPI?.getPlatform?.();
  switch (platform) {
    case "darwin":
      return "GLOBE";
    case "win32":
      return "Shift+F9";
    case "linux":
      return "Shift+F9";
    default:
      return "Shift+F9";
  }
}
const DEFAULT_HOTKEY = getDefaultHotkey();

export function useSettings() {
  const [preferredLanguage, setPreferredLanguage] = useLocalStorage(
    "preferredLanguage",
    "en",
    {
      serialize: String,
      deserialize: String,
    },
  );

  // API keys
  const [ppqApiKey, setPpqApiKey] = useLocalStorage("ppqApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  // Hotkey - defaults to Globe on Mac, backtick elsewhere
  const [dictationKey, setDictationKey] = useLocalStorage(
    "dictationKey",
    DEFAULT_HOTKEY,
    {
      serialize: String,
      deserialize: String,
    },
  );
  const [hotkeyMode, setHotkeyMode] = useLocalStorage<HotkeyMode>(
    "hotkeyMode",
    "hold",
    {
      serialize: String,
      deserialize: (value) => (value === "toggle" ? "toggle" : "hold"),
    },
  );

  const [audioCuesEnabled, setAudioCuesEnabled] = useLocalStorage(
    "audioCuesEnabled",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  const [alwaysUseBuiltInMic, setAlwaysUseBuiltInMic] = useLocalStorage(
    "alwaysUseBuiltInMic",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  const [preferredMicrophoneId, setPreferredMicrophoneId] = useLocalStorage(
    "preferredMicrophoneId",
    "",
    {
      serialize: String,
      deserialize: String,
    },
  );

  const [showIconOnlyWhenActive, setShowIconOnlyWhenActive] = useLocalStorage(
    "showIconOnlyWhenActive",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    },
  );

  // LLM cleanup toggle (default: true = enabled, transcriptions are cleaned up by AI)
  const [llmCleanupEnabled, setLlmCleanupEnabled] = useLocalStorage(
    "llmCleanupEnabled",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  // Privacy settings - MIP opt-out (default: true = opted out, data stays private)
  const [mipOptOut, setMipOptOut] = useLocalStorage(
    "mipOptOut",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  // Reasoning provider (three-way: ppq / tinfoil / local-gemma)
  const [reasoningProvider, setReasoningProvider] =
    useLocalStorage<ReasoningProvider>("reasoningProvider", "ppq", {
      serialize: String,
      deserialize: (value) =>
        value === "tinfoil" || value === "local-gemma" ? value : "ppq",
    });

  // Tinfoil private-proxy model (renamed from legacy privateModel)
  const [tinfoilModel, setTinfoilModel] = useLocalStorage(
    "tinfoilModel",
    "private/gpt-oss-120b",
    {
      serialize: String,
      deserialize: String,
    },
  );

  const [gemmaModel, setGemmaModel] = useLocalStorage(
    "gemmaModel",
    DEFAULT_GEMMA_MODEL,
    {
      serialize: String,
      deserialize: String,
    },
  );

  const [gemmaIdleShutdownEnabled, setGemmaIdleShutdownEnabled] = useLocalStorage(
    "gemmaIdleShutdownEnabled",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  // Derived getters for back-compat with the old boolean API
  const privateModeEnabled = reasoningProvider === "tinfoil";
  const privateModel = tinfoilModel;
  const setPrivateModeEnabled = (enabled: boolean) => {
    setReasoningProvider(enabled ? "tinfoil" : "ppq");
  };
  const setPrivateModel = setTinfoilModel;

  // Local transcription settings
  const [transcriptionProvider, setTranscriptionProvider] =
    useLocalStorage<TranscriptionProvider>("transcriptionProvider", "cloud", {
      serialize: String,
      deserialize: (value) =>
        value === "local" ? "local" : "cloud",
    });

  const [parakeetModel, setParakeetModel] = useLocalStorage(
    "parakeetModel",
    "parakeet-tdt-0.6b-v3",
    {
      serialize: String,
      deserialize: String,
    },
  );

  // Batch operations
  const updateTranscriptionSettings = useCallback(
    (settings: Partial<TranscriptionSettings>) => {
      if (settings.preferredLanguage !== undefined) {
        setPreferredLanguage(settings.preferredLanguage);
      }
    },
    [setPreferredLanguage],
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.ppqApiKey !== undefined) {
        setPpqApiKey(keys.ppqApiKey);
      }
    },
    [setPpqApiKey],
  );

  const updateHotkeySettings = useCallback(
    (settings: Partial<HotkeySettings>) => {
      if (settings.dictationKey !== undefined) {
        setDictationKey(settings.dictationKey);
      }
      if (settings.hotkeyMode !== undefined) {
        setHotkeyMode(settings.hotkeyMode);
      }
    },
    [setDictationKey, setHotkeyMode],
  );

  const updateAudioSettings = useCallback(
    (settings: Partial<AudioSettings>) => {
      if (settings.audioCuesEnabled !== undefined) {
        setAudioCuesEnabled(settings.audioCuesEnabled);
      }
      if (settings.alwaysUseBuiltInMic !== undefined) {
        setAlwaysUseBuiltInMic(settings.alwaysUseBuiltInMic);
      }
      if (settings.preferredMicrophoneId !== undefined) {
        setPreferredMicrophoneId(settings.preferredMicrophoneId);
      }
    },
    [setAudioCuesEnabled, setAlwaysUseBuiltInMic, setPreferredMicrophoneId],
  );

  const updateAppearanceSettings = useCallback(
    (settings: Partial<AppearanceSettings>) => {
      if (settings.showIconOnlyWhenActive !== undefined) {
        setShowIconOnlyWhenActive(settings.showIconOnlyWhenActive);
      }
    },
    [setShowIconOnlyWhenActive],
  );

  const updatePrivacySettings = useCallback(
    (settings: Partial<PrivacySettings>) => {
      if (settings.mipOptOut !== undefined) {
        setMipOptOut(settings.mipOptOut);
      }
      if (settings.privateModeEnabled !== undefined) {
        setReasoningProvider(settings.privateModeEnabled ? "tinfoil" : "ppq");
      }
      if (settings.privateModel !== undefined) {
        setTinfoilModel(settings.privateModel);
      }
    },
    [setMipOptOut, setReasoningProvider, setTinfoilModel],
  );

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      const toPersist: Record<string, string | boolean> = {};
      if (settings.reasoningProvider !== undefined) {
        setReasoningProvider(settings.reasoningProvider);
        toPersist.reasoningProvider = settings.reasoningProvider;
      }
      if (settings.tinfoilModel !== undefined) {
        setTinfoilModel(settings.tinfoilModel);
      }
      if (settings.gemmaModel !== undefined) {
        setGemmaModel(settings.gemmaModel);
        toPersist.gemmaModel = settings.gemmaModel;
      }
      if (settings.gemmaIdleShutdownEnabled !== undefined) {
        setGemmaIdleShutdownEnabled(settings.gemmaIdleShutdownEnabled);
        toPersist.gemmaIdleShutdownEnabled = settings.gemmaIdleShutdownEnabled;
      }
      if (Object.keys(toPersist).length > 0) {
        window.electronAPI.saveSettings(toPersist);
      }
    },
    [
      setReasoningProvider,
      setTinfoilModel,
      setGemmaModel,
      setGemmaIdleShutdownEnabled,
    ],
  );

  // Bootstrap: persist current transcription settings to disk on first render
  // so the main process can read them at next startup for parakeet pre-warming.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      window.electronAPI.saveSettings({
        transcriptionProvider,
        parakeetModel,
      });
    }
  }, [transcriptionProvider, parakeetModel]);

  const updateLocalTranscriptionSettings = useCallback(
    (settings: Partial<LocalTranscriptionSettings>) => {
      if (settings.transcriptionProvider !== undefined) {
        setTranscriptionProvider(settings.transcriptionProvider);
      }
      if (settings.parakeetModel !== undefined) {
        setParakeetModel(settings.parakeetModel);
      }
      // Persist to disk so the main process can read these at next startup
      // (before the renderer loads) for parakeet pre-warming.
      const toPersist: Record<string, string> = {};
      if (settings.transcriptionProvider !== undefined) {
        toPersist.transcriptionProvider = settings.transcriptionProvider;
      }
      if (settings.parakeetModel !== undefined) {
        toPersist.parakeetModel = settings.parakeetModel;
      }
      if (Object.keys(toPersist).length > 0) {
        window.electronAPI.saveSettings(toPersist);
      }
    },
    [setTranscriptionProvider, setParakeetModel],
  );

  return {
    preferredLanguage,
    ppqApiKey,
    dictationKey,
    hotkeyMode,
    audioCuesEnabled,
    alwaysUseBuiltInMic,
    preferredMicrophoneId,
    showIconOnlyWhenActive,
    llmCleanupEnabled,
    mipOptOut,
    privateModeEnabled,
    privateModel,
    reasoningProvider,
    tinfoilModel,
    gemmaModel,
    gemmaIdleShutdownEnabled,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    setAlwaysUseBuiltInMic,
    setPreferredMicrophoneId,
    setShowIconOnlyWhenActive,
    setLlmCleanupEnabled,
    setMipOptOut,
    setPrivateModeEnabled,
    setPrivateModel,
    setReasoningProvider,
    setTinfoilModel,
    setGemmaModel,
    setGemmaIdleShutdownEnabled,
    updateTranscriptionSettings,
    updateApiKeys,
    updateHotkeySettings,
    updateAudioSettings,
    updateAppearanceSettings,
    updatePrivacySettings,
    updateReasoningSettings,
    transcriptionProvider,
    parakeetModel,
    setTranscriptionProvider,
    setParakeetModel,
    updateLocalTranscriptionSettings,
  };
}
