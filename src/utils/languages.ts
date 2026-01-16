// Language codes supported by Deepgram Nova-2/Nova-3 models
// See: https://developers.deepgram.com/docs/models-languages-overview
export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "bg", label: "Bulgarian" },
  { value: "ca", label: "Catalan" },
  { value: "zh", label: "Chinese (Mandarin)" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "et", label: "Estonian" },
  { value: "fi", label: "Finnish" },
  { value: "nl-BE", label: "Flemish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "de-CH", label: "German (Swiss)" },
  { value: "el", label: "Greek" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "lv", label: "Latvian" },
  { value: "lt", label: "Lithuanian" },
  { value: "ms", label: "Malay" },
  { value: "no", label: "Norwegian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sk", label: "Slovak" },
  { value: "es", label: "Spanish" },
  { value: "es-419", label: "Spanish (Latin America)" },
  { value: "sv", label: "Swedish" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "vi", label: "Vietnamese" },
];

export const getLanguageLabel = (code: string): string => {
  const option = LANGUAGE_OPTIONS.find((lang) => lang.value === code);
  return option?.label || code;
};
