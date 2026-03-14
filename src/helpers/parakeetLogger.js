/**
 * Thin logging adapter for Parakeet modules.
 * Provides the debug/info/warn/error API that the ported OpenWhisper code expects,
 * delegating to PPQ's main debugLogger under the "parakeet" channel.
 */
const debugLogger = require("./debugLogger");

module.exports = {
  debug(message, details = {}) {
    debugLogger.logEvent("parakeet", message, details, "debug");
  },
  info(message, details = {}) {
    debugLogger.logEvent("parakeet", message, details, "info");
  },
  warn(message, details = {}) {
    debugLogger.logEvent("parakeet", message, details, "warn");
  },
  error(message, details = {}) {
    debugLogger.logEvent("parakeet", message, details, "error");
  },
  logSTTPipeline(stage, details = {}) {
    debugLogger.logEvent("parakeet-stt", stage, details, "debug");
  },
};
