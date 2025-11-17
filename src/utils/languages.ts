export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "af", label: "Afrikaans" },
  { value: "ar", label: "Arabic" },
  { value: "hy", label: "Armenian" },
  { value: "az", label: "Azerbaijani" },
  { value: "be", label: "Belarusian" },
  { value: "bs", label: "Bosnian" },
  { value: "bg", label: "Bulgarian" },
  { value: "ca", label: "Catalan" },
  { value: "zh", label: "Chinese" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "et", label: "Estonian" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "gl", label: "Galician" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "is", label: "Icelandic" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "kn", label: "Kannada" },
  { value: "kk", label: "Kazakh" },
  { value: "ko", label: "Korean" },
  { value: "lv", label: "Latvian" },
  { value: "lt", label: "Lithuanian" },
  { value: "mk", label: "Macedonian" },
  { value: "ms", label: "Malay" },
  { value: "mr", label: "Marathi" },
  { value: "mi", label: "Maori" },
  { value: "ne", label: "Nepali" },
  { value: "no", label: "Norwegian" },
  { value: "fa", label: "Persian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sr", label: "Serbian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "es", label: "Spanish" },
  { value: "sw", label: "Swahili" },
  { value: "sv", label: "Swedish" },
  { value: "tl", label: "Tagalog" },
  { value: "ta", label: "Tamil" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "vi", label: "Vietnamese" },
  { value: "cy", label: "Welsh" },
];

export const getLanguageLabel = (code: string): string => {
  const option = LANGUAGE_OPTIONS.find((lang) => lang.value === code);
  return option?.label || code;
};

// Reasoning model configuration (Groq-only)
export const REASONING_PROVIDERS = {
  groq: {
    name: "Groq",
    models: [
      {
        value: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B Instant",
        description: "Fast clean-up with low latency",
      },
      {
        value: "llama-3.1-70b-versatile",
        label: "Llama 3.1 70B Versatile",
        description: "High quality edits and rewrites",
      },
      {
        value: "mixtral-8x7b-32768",
        label: "Mixtral 8x7B",
        description: "Great for structured summaries and lists",
      },
      {
        value: "qwen/qwen3-32b",
        label: "Qwen3 32B",
        description: "High capacity reasoning with 128K context",
      },
    ],
  },
};

export const getAllReasoningModels = () => {
  return Object.entries(REASONING_PROVIDERS).flatMap(([providerId, provider]) =>
    provider.models.map((model) => ({
      ...model,
      provider: providerId,
      fullLabel: `${provider.name} ${model.label}`,
    }))
  );
};

export const getReasoningModelLabel = (modelId: string): string => {
  const allModels = getAllReasoningModels();
  const model = allModels.find((m) => m.value === modelId);
  return model?.fullLabel || modelId;
};

export const getModelProvider = (modelId: string): string => {
  const allModels = getAllReasoningModels();
  const model = allModels.find((m) => m.value === modelId);

  // If model not found, assume Groq since that's the only provider
  if (!model) {
    return "groq";
  }

  return model.provider;
};
