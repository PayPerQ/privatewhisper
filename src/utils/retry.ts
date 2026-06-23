import { RETRY_CONFIG } from "../config/constants";

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.MAX_RETRIES,
    initialDelay = RETRY_CONFIG.INITIAL_DELAY,
    maxDelay = RETRY_CONFIG.MAX_DELAY,
    backoffMultiplier = RETRY_CONFIG.BACKOFF_MULTIPLIER,
    shouldRetry = () => true,
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

// Specific retry strategy for API calls
export function createApiRetryStrategy() {
  return {
    shouldRetry: (error: any) => {
      // Retry on network errors or 5xx status codes
      if (!error.response) return true; // Network error

      const status = error.response?.status || error.status;
      return status >= 500 && status < 600;
    },
  };
}

// Retry strategy for the local Gemma (llama-server) reasoning call. The server
// is spawned on demand and can briefly refuse connections while it warms up,
// surfacing as a "Failed to fetch" TypeError (no `.response`). We retry those
// and 5xx more patiently than the cloud strategy — snappier early backoff plus
// a couple extra attempts — so a cold-start blip recovers instead of falling
// back to plain cleanup, while still capping the total wait (~7s) since the
// cleanup blocks the paste.
export function createLocalLlmRetryStrategy() {
  return {
    shouldRetry: (error: any) => {
      if (!error.response) return true; // network error (e.g. server warming up)
      const status = error.response?.status || error.status;
      return status >= 500 && status < 600;
    },
    maxRetries: 5,
    initialDelay: 400,
    maxDelay: 2000,
  };
}

// Specific retry strategy for file operations
export function createFileRetryStrategy() {
  return {
    shouldRetry: (error: any) => {
      // Retry on temporary file system errors
      const retriableErrors = ["EBUSY", "ENOENT", "EPERM", "EAGAIN"];
      return retriableErrors.includes(error.code);
    },
    maxRetries: 2,
    initialDelay: 500,
  };
}
