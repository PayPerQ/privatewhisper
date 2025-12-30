type DebugLevel = "debug" | "info" | "warn" | "error";
type DebugDetails = Record<string, unknown>;

type DebugLogger = {
  isDebugMode: boolean | null;
  ensureDebugMode: () => Promise<boolean>;
  log: (event: string, details?: DebugDetails, level?: DebugLevel) => Promise<void>;
  logReasoning: (stage: string, details?: DebugDetails) => Promise<void>;
  clearCache: () => void;
};

const createDebugLogger = (channel = "renderer"): DebugLogger => ({
  isDebugMode: null,

  async ensureDebugMode() {
    if (this.isDebugMode === null) {
      if (typeof window !== "undefined" && window.electronAPI?.getDebugMode) {
        try {
          this.isDebugMode = await window.electronAPI.getDebugMode();
        } catch {
          this.isDebugMode = false;
        }
      } else {
        this.isDebugMode = false;
      }
    }
    return this.isDebugMode || false;
  },

  async log(event, details = {}, level = "debug") {
    const enabled = await this.ensureDebugMode();
    if (!enabled) return;

    if (
      typeof window !== "undefined" &&
      window.electronAPI?.logDebugEvent
    ) {
      try {
        await window.electronAPI.logDebugEvent(channel, event, details, level);
      } catch (error) {
        console.error("Failed to send debug log:", error);
      }
    } else {
      console.log(`[${channel}] ${event}`, details);
    }
  },

  async logReasoning(stage, details = {}) {
    await this.log(stage, details, "debug");
  },

  clearCache() {
    this.isDebugMode = null;
  },
});

export default createDebugLogger;
