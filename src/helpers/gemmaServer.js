const fs = require("fs");
const path = require("path");
const { getModelsDirForService } = require("./modelDirUtils");
const GemmaServerProcess = require("./gemmaServerProcess");

const modelRegistryData = require("../models/gemmaModels.json");

class GemmaServerManager {
  constructor() {
    this.process = new GemmaServerProcess();
  }

  getBinaryPath() {
    return this.process.getBinaryPath();
  }

  isAvailable() {
    return this.process.isAvailable();
  }

  getModelsDir() {
    return getModelsDirForService("gemma");
  }

  getModelFilePath(modelName) {
    const info = modelRegistryData.gemmaModels[modelName];
    if (!info) return null;
    return path.join(this.getModelsDir(), modelName, info.ggufFileName);
  }

  isModelDownloaded(modelName) {
    const file = this.getModelFilePath(modelName);
    if (!file) return false;
    try {
      const stats = fs.statSync(file);
      // File must be non-empty. Rough lower bound: 100 MB (real file is ~3.5 GB).
      return stats.size >= 100 * 1024 * 1024;
    } catch {
      return false;
    }
  }

  async startServer(modelName) {
    if (!this.isAvailable()) {
      return { success: false, reason: "llama-server binary not installed" };
    }
    const file = this.getModelFilePath(modelName);
    if (!file || !this.isModelDownloaded(modelName)) {
      return { success: false, reason: `Gemma model "${modelName}" not downloaded` };
    }
    try {
      const result = await this.process.start(modelName, file);
      return result;
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  async stopServer() {
    await this.process.stop();
    return { success: true };
  }

  getServerStatus() {
    return this.process.getStatus();
  }

  setIdleShutdown(enabledMs) {
    this.process.setIdleShutdown(enabledMs);
  }

  notifyActivity() {
    this.process.notifyActivity();
  }
}

module.exports = GemmaServerManager;
