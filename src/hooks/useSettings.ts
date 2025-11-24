import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { getModelProvider } from "../utils/languages";

export interface TranscriptionSettings {
  preferredLanguage: string;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
}

export interface HotkeySettings {
  dictationKey: string;
}

export interface ApiKeySettings {
  ppqApiKey: string;
  groqApiKey: string;
}

export function useSettings() {
  const [preferredLanguage, setPreferredLanguage] = useLocalStorage(
    "preferredLanguage",
    "en",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Reasoning settings
  const [useReasoningModel, setUseReasoningModel] = useLocalStorage(
    "useReasoningModel",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false", // Default true
    }
  );

  const [reasoningModel, setReasoningModel] = useLocalStorage(
    "reasoningModel",
    "qwen/qwen3-32b",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // API keys
  const [ppqApiKey, setPpqApiKey] = useLocalStorage("ppqApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [groqApiKey, setGroqApiKey] = useLocalStorage("groqApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  // Hotkey
  const [dictationKey, setDictationKey] = useLocalStorage("dictationKey", "", {
    serialize: String,
    deserialize: String,
  });

  // Computed values
  const reasoningProvider = getModelProvider(reasoningModel);

  // Batch operations
  const updateTranscriptionSettings = useCallback(
    (settings: Partial<TranscriptionSettings>) => {
      if (settings.preferredLanguage !== undefined) {
        setPreferredLanguage(settings.preferredLanguage);
      }
    },
    [setPreferredLanguage]
  );

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      if (settings.useReasoningModel !== undefined)
        setUseReasoningModel(settings.useReasoningModel);
      if (settings.reasoningModel !== undefined)
        setReasoningModel(settings.reasoningModel);
    },
    [setUseReasoningModel, setReasoningModel]
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.ppqApiKey !== undefined) setPpqApiKey(keys.ppqApiKey);
      if (keys.groqApiKey !== undefined) setGroqApiKey(keys.groqApiKey);
    },
    [setPpqApiKey, setGroqApiKey]
  );

  return {
    preferredLanguage,
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    ppqApiKey,
    groqApiKey,
    dictationKey,
    setPreferredLanguage,
    setUseReasoningModel,
    setReasoningModel,
    setPpqApiKey,
    setGroqApiKey,
    setDictationKey,
    updateTranscriptionSettings,
    updateReasoningSettings,
    updateApiKeys,
  };
}
