const debugLogger = require("./debugLogger");

const DEFAULT_FUNCTION_NAME = "voice-logs";
const REQUEST_TIMEOUT_MS = 10000;

class EdgeFunctionLogger {
  constructor(environmentManager, appVersion = "") {
    this.environmentManager = environmentManager;
    this.appVersion = appVersion;
  }

  setAppVersion(version) {
    this.appVersion = version;
  }

  getConfig() {
    if (!this.environmentManager?.getSupabaseConfig) {
      return null;
    }
    const config = this.environmentManager.getSupabaseConfig();
    if (!config?.publishableKey) {
      return null;
    }

    const functionsBaseUrl =
      config.functionsBaseUrl || this.deriveFunctionsBaseUrl(config.url);

    if (!functionsBaseUrl) {
      return null;
    }

    return {
      publishableKey: config.publishableKey,
      functionsBaseUrl,
      logFunctionName: config.logFunctionName || DEFAULT_FUNCTION_NAME,
    };
  }

  deriveFunctionsBaseUrl(supabaseUrl = "") {
    try {
      const url = new URL(supabaseUrl);
      if (!url.hostname.endsWith(".supabase.co")) {
        return "";
      }
      const host = url.hostname.replace(
        ".supabase.co",
        ".functions.supabase.co",
      );
      return `${url.protocol}//${host}`;
    } catch {
      return "";
    }
  }

  buildEndpoint(config) {
    const base = config?.functionsBaseUrl;
    if (!base) return null;
    const trimmed = base.replace(/\/+$/g, "");
    return `${trimmed}/${config.logFunctionName}`;
  }

  async logPipelineMetrics(payload = {}) {
    const config = this.getConfig();
    if (!config) {
      return { skipped: true, reason: "missing_supabase_config" };
    }

    if (!payload.request_started_at || !payload.response_received_at) {
      return { skipped: true, reason: "missing_required_timestamps" };
    }

    const endpoint = this.buildEndpoint(config);
    if (!endpoint) {
      return { skipped: true, reason: "missing_endpoint" };
    }

    const identity = this.environmentManager?.getUserIdentity
      ? this.environmentManager.getUserIdentity()
      : null;

    const enrichedPayload = {
      ...payload,
      app_version: this.appVersion || undefined,
      user_uuid: identity?.userUuid || undefined,
      user_label: identity?.userLabel || undefined,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.publishableKey}`,
          apikey: config.publishableKey,
        },
        body: JSON.stringify(enrichedPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        debugLogger.error("edge-function", "log-insert-failed", {
          status: response.status,
          error: errorText || response.statusText,
        });
        return { success: false, status: response.status };
      }

      return { success: true };
    } catch (error) {
      debugLogger.error("edge-function", "log-insert-error", {
        error: error.message,
      });
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = EdgeFunctionLogger;
