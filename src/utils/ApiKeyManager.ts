class ApiKeyManager {
  async getApiKey(): Promise<string> {
    const apiKey = await this.fetchFromSources();

    if (!this.isValidApiKey(apiKey)) {
      throw new Error(
        "PPQ API key not found. Please add your key in the Control Panel.",
      );
    }

    return apiKey;
  }

  private async fetchFromSources(): Promise<string | null> {
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
}

const apiKeyManager = new ApiKeyManager();

export default apiKeyManager;
