// API Configuration helpers
export const normalizeBaseUrl = (value?: string | null): string => {
  if (!value) return "";

  let normalized = value.trim();
  if (!normalized) return "";

  // Remove common API endpoint suffixes to get the base URL
  const suffixReplacements: Array<[RegExp, string]> = [
    [/\/v1\/chat\/completions$/i, '/v1'],
    [/\/chat\/completions$/i, ''],
    [/\/v1\/responses$/i, '/v1'],
    [/\/responses$/i, ''],
    [/\/v1\/models$/i, '/v1'],
    [/\/models$/i, ''],
    [/\/v1\/audio\/transcriptions$/i, '/v1'],
    [/\/audio\/transcriptions$/i, ''],
    [/\/v1\/audio\/translations$/i, '/v1'],
    [/\/audio\/translations$/i, ''],
  ];

  for (const [pattern, replacement] of suffixReplacements) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement).replace(/\/+$/, "");
    }
  }

  return normalized.replace(/\/+$/, "");
};

export const buildApiUrl = (base: string, path: string): string => {
  const normalizedBase = normalizeBaseUrl(base) || "https://dev.ppq.ai/api/v1";
  if (!path) {
    return normalizedBase;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const env = (typeof import.meta !== "undefined" && (import.meta as any).env) || {};

const computeBaseUrl = (candidates: Array<string | undefined>, fallback: string): string => {
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
};

// STT endpoint - uses PPQ by default
const DEFAULT_STT_BASE = computeBaseUrl(
  [
    env.PPQVOICE_STT_BASE_URL as string | undefined,
    env.PPQVOICE_OPENAI_BASE_URL as string | undefined, // legacy override
    env.OPENAI_BASE_URL as string | undefined, // legacy fallback
  ],
  'https://dev.ppq.ai/api/v1'
);

// Reasoning endpoint - uses Groq by default
const DEFAULT_REASONING_BASE = computeBaseUrl(
  [
    env.PPQVOICE_REASONING_BASE_URL as string | undefined,
    env.PPQVOICE_GROQ_BASE_URL as string | undefined,
  ],
  'https://api.groq.com/openai/v1'
);

export const API_ENDPOINTS = {
  GROQ_BASE: DEFAULT_STT_BASE, // Legacy name, now points to STT
  GROQ_CHAT: buildApiUrl(DEFAULT_REASONING_BASE, '/chat/completions'),
  GROQ_MODELS: buildApiUrl(DEFAULT_REASONING_BASE, '/models'),
  GROQ_TRANSCRIPTION: buildApiUrl(DEFAULT_STT_BASE, '/audio/transcriptions'),
} as const;

// Model Configuration
export const MODEL_CONSTRAINTS = {
  MIN_FILE_SIZE: 1_000_000, // 1MB minimum for valid model files
  MODEL_TEST_TIMEOUT: 5000, // 5 seconds for model validation
  INFERENCE_TIMEOUT: 30000, // 30 seconds default (configurable)
} as const;

// Token Limits
export const TOKEN_LIMITS = {
  MIN_TOKENS: 100,
  MAX_TOKENS: 2048,
  TOKEN_MULTIPLIER: 2, // text.length * multiplier
  REASONING_CONTEXT_SIZE: 4096,
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  API_KEY_TTL: 3600000, // 1 hour in milliseconds
  MODEL_CACHE_SIZE: 3, // Maximum models to keep in memory
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 10000, // 10 seconds
  BACKOFF_MULTIPLIER: 2,
} as const;
