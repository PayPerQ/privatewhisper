import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import apiKeyManager from "../utils/ApiKeyManager";
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

// Default hotkey: Globe key on Mac, backtick on other platforms
const DEFAULT_HOTKEY =
  typeof window !== "undefined" &&
  window.electronAPI?.getPlatform?.() === "darwin"
    ? "GLOBE"
    : "`";

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
    "toggle",
    {
      serialize: String,
      deserialize: (value) => (value === "hold" ? "hold" : "toggle"),
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
        apiKeyManager.clearCache();
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

  return {
    preferredLanguage,
    ppqApiKey,
    dictationKey,
    hotkeyMode,
    audioCuesEnabled,
    alwaysUseBuiltInMic,
    preferredMicrophoneId,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    setAlwaysUseBuiltInMic,
    setPreferredMicrophoneId,
    updateTranscriptionSettings,
    updateApiKeys,
    updateHotkeySettings,
    updateAudioSettings,
  };
}
