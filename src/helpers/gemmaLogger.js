const debugLogger = require("./debugLogger");

module.exports = {
  debug(message, details = {}) {
    debugLogger.logEvent("gemma", message, details, "debug");
  },
  info(message, details = {}) {
    debugLogger.logEvent("gemma", message, details, "info");
  },
  warn(message, details = {}) {
    debugLogger.logEvent("gemma", message, details, "warn");
  },
  error(message, details = {}) {
    debugLogger.logEvent("gemma", message, details, "error");
  },
};
