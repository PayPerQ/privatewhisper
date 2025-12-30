import { SecureCache } from "./SecureCache";

class ApiKeyManager {
  private cache: SecureCache;

  constructor() {
    this.cache = new SecureCache();
  }

  async getApiKey(forceRefresh: boolean = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.cache.get("ppq");
      if (cached) {
        return cached;
      }
    }

    const apiKey = await this.fetchFromSources("ppq");

    if (!this.isValidApiKey(apiKey)) {
      throw new Error(
        "PPQ API key not found. Please add your key in the Control Panel.",
      );
    }

    this.cache.set("ppq", apiKey);
    return apiKey;
  }

  private async fetchFromSources(keyType: "ppq"): Promise<string | null> {
    if (typeof window !== "undefined" && window.electronAPI?.getPPQKey) {
      const key = await window.electronAPI.getPPQKey();
      if (this.isValidApiKey(key)) {
        return key;
      }
    }

    if (typeof window !== "undefined" && window.localStorage) {
      const key = window.localStorage.getItem("ppqApiKey");
      if (this.isValidApiKey(key)) {
        return key;
      }
    }

    return null;
  }

  private isValidApiKey(key: string | null): key is string {
    return (
      key !== null &&
      typeof key === "string" &&
      key.trim() !== "" &&
      key !== "your_ppq_api_key_here"
    );
  }

  clearCache(): void {
    this.cache.delete("ppq");
  }
}

const apiKeyManager = new ApiKeyManager();

export default apiKeyManager;
