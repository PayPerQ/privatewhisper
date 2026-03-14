import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
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
  privateModeEnabled: boolean; // Route reasoning through encrypted private proxy
  privateModel: string; // Which private model to use for reasoning
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

  // Privacy settings - MIP opt-out (default: true = opted out, data stays private)
  const [mipOptOut, setMipOptOut] = useLocalStorage(
    "mipOptOut",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    },
  );

  // Private mode - route reasoning through encrypted proxy
  const [privateModeEnabled, setPrivateModeEnabled] = useLocalStorage(
    "privateModeEnabled",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    },
  );

  const [privateModel, setPrivateModel] = useLocalStorage(
    "privateModel",
    "private/gpt-oss-120b",
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
        setPrivateModeEnabled(settings.privateModeEnabled);
      }
      if (settings.privateModel !== undefined) {
        setPrivateModel(settings.privateModel);
      }
    },
    [setMipOptOut, setPrivateModeEnabled, setPrivateModel],
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
    mipOptOut,
    privateModeEnabled,
    privateModel,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    setAlwaysUseBuiltInMic,
    setPreferredMicrophoneId,
    setShowIconOnlyWhenActive,
    setMipOptOut,
    setPrivateModeEnabled,
    setPrivateModel,
    updateTranscriptionSettings,
    updateApiKeys,
    updateHotkeySettings,
    updateAudioSettings,
    updateAppearanceSettings,
    updatePrivacySettings,
  };
}
