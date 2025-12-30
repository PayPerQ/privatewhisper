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
}

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

  // Hotkey
  const [dictationKey, setDictationKey] = useLocalStorage("dictationKey", "", {
    serialize: String,
    deserialize: String,
  });
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
      if (keys.ppqApiKey !== undefined) setPpqApiKey(keys.ppqApiKey);
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
    },
    [setAudioCuesEnabled],
  );

  return {
    preferredLanguage,
    ppqApiKey,
    dictationKey,
    hotkeyMode,
    audioCuesEnabled,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    updateTranscriptionSettings,
    updateApiKeys,
    updateHotkeySettings,
    updateAudioSettings,
  };
}
