// API Configuration helpers
export const normalizeBaseUrl = (value?: string | null): string => {
  if (!value) return "";

  let normalized = value.trim();
  if (!normalized) return "";

  // Remove common API endpoint suffixes to get the base URL
  const suffixReplacements: Array<[RegExp, string]> = [
    [/\/v1\/chat\/completions$/i, "/v1"],
    [/\/chat\/completions$/i, ""],
    [/\/v1\/responses$/i, "/v1"],
    [/\/responses$/i, ""],
    [/\/v1\/models$/i, "/v1"],
    [/\/models$/i, ""],
    [/\/v1\/audio\/transcriptions$/i, "/v1"],
    [/\/audio\/transcriptions$/i, ""],
    [/\/v1\/audio\/translations$/i, "/v1"],
    [/\/audio\/translations$/i, ""],
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
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const env =
  (typeof import.meta !== "undefined" && (import.meta as any).env) || {};

const computeBaseUrl = (
  candidates: Array<string | undefined>,
  fallback: string,
): string => {
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
};

// PPQ API base URLs - different endpoints for transcription vs reasoning
const DEFAULT_PPQ_TRANSCRIPTION_BASE = computeBaseUrl(
  [
    env.PPQVOICE_PPQ_TRANSCRIPTION_BASE_URL as string | undefined,
    env.PPQVOICE_PPQ_BASE_URL as string | undefined,
  ],
  "https://ppq.ai/api/v1",
);

const DEFAULT_PPQ_CHAT_BASE = computeBaseUrl(
  [
    env.PPQVOICE_PPQ_CHAT_BASE_URL as string | undefined,
    env.PPQVOICE_PPQ_BASE_URL as string | undefined,
  ],
  "https://api.ppq.ai",
);

// WebSocket base URL for streaming services
const DEFAULT_PPQ_WS_BASE = computeBaseUrl(
  [env.PPQVOICE_PPQ_WS_BASE_URL as string | undefined],
  "",
);

if (!DEFAULT_PPQ_WS_BASE) {
  throw new Error(
    "PPQVOICE_PPQ_WS_BASE_URL environment variable is required but not set",
  );
}

export const API_ENDPOINTS = {
  PPQ_BASE: DEFAULT_PPQ_CHAT_BASE,
  PPQ_CHAT: buildApiUrl(DEFAULT_PPQ_CHAT_BASE, "/chat/completions"),
  PPQ_MODELS: buildApiUrl(DEFAULT_PPQ_CHAT_BASE, "/models"),
  PPQ_TRANSCRIPTION: buildApiUrl(
    DEFAULT_PPQ_TRANSCRIPTION_BASE,
    "/audio/transcriptions",
  ),
  PPQ_STREAMING_TRANSCRIPTION_WS: `${DEFAULT_PPQ_WS_BASE}/ws/transcribe`,
} as const;

// tool_id values sent to horse-power so PPQ Whisper usage earns a creator
// payout. Each must map to an active `AIToolCreator` record (with a
// lightning_address + payout_sats) seeded in horse-power, or the payout
// silently no-ops.
//   STT     — Deepgram speech-to-text, sent in the WebSocket auth message;
//             horse-power pays out in transcription.ws.controller.ts.
//   CLEANUP — the optional Groq/Cerebras LLM "cleanup" pass, sent on the
//             /chat/completions body; horse-power pays out in chat.controller.ts.
// Private-mode (Tinfoil) cleanup intentionally omits the tool_id since it
// bypasses horse-power entirely.
export const CREATOR_TOOL_IDS = {
  // Matches the seeded `stt:ppq-voice` AIToolCreator (PPQ Voice STT, Deepgram).
  STT: "stt:ppq-voice",
  CLEANUP: "llm:ppq-whisper-cleanup",
} as const;

// Model Configuration
export const MODEL_CONSTRAINTS = {
  MIN_FILE_SIZE: 1_000_000, // 1MB minimum for valid model files
  MODEL_TEST_TIMEOUT: 5000, // 5 seconds for model validation
  INFERENCE_TIMEOUT: 30000, // 30 seconds default (configurable)
} as const;

// Token Limits
export const TOKEN_LIMITS = {
  MIN_TOKENS: 512, // Reasoning models need more tokens for thinking + output
  MAX_TOKENS: 4096,
  TOKEN_MULTIPLIER: 4, // text.length * multiplier (higher for reasoning overhead)
  REASONING_CONTEXT_SIZE: 4096,
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 10000, // 10 seconds
  BACKOFF_MULTIPLIER: 2,
} as const;

// WebSocket Connection Configuration (for Bluetooth resilience)
export const CONNECTION_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5,
  INITIAL_BACKOFF_MS: 500,
  MAX_BACKOFF_MS: 8000,
  BACKOFF_MULTIPLIER: 1.5,
  KEEPALIVE_INTERVAL_MS: 15000, // Send ping every 15 seconds
  KEEPALIVE_TIMEOUT_MS: 5000, // Consider stale if no pong within 5 seconds
  CONNECTION_TIMEOUT_MS: 20000, // 20 seconds for initial connection (Bluetooth needs longer)
} as const;

// PPQ Website URL (for external links like onboarding, API docs)
export const PPQ_WEBSITE_URL = computeBaseUrl(
  [env.VITE_PPQ_WEBSITE_URL as string | undefined],
  "https://ppq.ai",
);

// Private Mode Proxy Configuration
export const PRIVATE_PROXY_CONFIG = {
  PORT: 8787,
  HOST: "127.0.0.1",
  HEALTH_CHECK_INTERVAL_MS: 30_000,
  STARTUP_TIMEOUT_MS: 30_000,
  MAX_RESTART_ATTEMPTS: 3,
} as const;

export const PRIVATE_MODELS = [
  { id: "private/gpt-oss-120b", label: "GPT-OSS 120B (Private)" },
  { id: "private/kimi-k2-5", label: "Kimi K2.5 (Private)" },
  { id: "private/deepseek-r1-0528", label: "DeepSeek R1 (Private)" },
  { id: "private/llama3-3-70b", label: "Llama 3.3 70B (Private)" },
  { id: "private/qwen3-vl-30b", label: "Qwen3-VL 30B (Private)" },
] as const;

export const PRIVATE_PROXY_CHAT = `http://${PRIVATE_PROXY_CONFIG.HOST}:${PRIVATE_PROXY_CONFIG.PORT}/v1/chat/completions`;
export const PRIVATE_PROXY_HEALTH = `http://${PRIVATE_PROXY_CONFIG.HOST}:${PRIVATE_PROXY_CONFIG.PORT}/health`;

// Audio Device Recovery Configuration
export const DEVICE_RECOVERY_CONFIG = {
  MAX_RECOVERY_ATTEMPTS: 3,
  RECOVERY_INTERVAL_MS: 1000, // Wait 1 second between recovery attempts
  DEVICE_RECONNECT_GRACE_PERIOD_MS: 5000, // Wait for device to reappear
} as const;

// Warm Connection Pool Configuration
export const WARM_CONNECTION_CONFIG = {
  MAX_POOL_SIZE: 1, // Keep one warm connection ready
  CONNECTION_TTL_MS: 30000, // Recycle connections after 30 seconds (server may timeout at ~45-60s)
  REFRESH_BUFFER_MS: 5000, // Start refresh 5 seconds before TTL expires
} as const;

// PCM Audio Buffer Configuration (extended for Bluetooth)
export const AUDIO_BUFFER_CONFIG = {
  MAX_BUFFER_DURATION_MS: 300000, // 5 minutes
  MAX_BUFFER_SIZE_BYTES: 60 * 1024 * 1024, // 60MB
  BUFFER_SIZE_SAMPLES: 2048, // Samples per chunk at 16kHz = ~128ms
} as const;
