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

// PPQ API base URL - used for both STT and reasoning
const DEFAULT_PPQ_BASE = computeBaseUrl(
  [
    env.PPQVOICE_PPQ_BASE_URL as string | undefined,
  ],
  'https://api.ppq.ai/api/v1'
);

export const API_ENDPOINTS = {
  PPQ_BASE: DEFAULT_PPQ_BASE,
  PPQ_CHAT: buildApiUrl(DEFAULT_PPQ_BASE, '/chat/completions'),
  PPQ_MODELS: buildApiUrl(DEFAULT_PPQ_BASE, '/models'),
  PPQ_TRANSCRIPTION: buildApiUrl(DEFAULT_PPQ_BASE, '/audio/transcriptions'),
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
