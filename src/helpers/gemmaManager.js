const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const {
  downloadFile,
  createDownloadSignal,
  cleanupStaleDownloads,
  checkDiskSpace,
} = require("./downloadUtils");
const GemmaServerManager = require("./gemmaServer");
const { getModelsDirForService } = require("./modelDirUtils");
const debugLogger = require("./gemmaLogger");

const modelRegistryData = require("../models/gemmaModels.json");

function getGemmaModelConfig(modelName) {
  return modelRegistryData.gemmaModels[modelName] || null;
}

function getValidModelNames() {
  return Object.keys(modelRegistryData.gemmaModels);
}

class GemmaManager {
  constructor() {
    this.currentDownload = null;
    this.isInitialized = false;
    this.serverManager = new GemmaServerManager();
  }

  getModelsDir() {
    return getModelsDirForService("gemma");
  }

  validateModelName(modelName) {
    const valid = getValidModelNames();
    if (!valid.includes(modelName)) {
      throw new Error(
        `Invalid Gemma model: ${modelName}. Valid models: ${valid.join(", ")}`,
      );
    }
    return true;
  }

  getModelDir(modelName) {
    this.validateModelName(modelName);
    return path.join(this.getModelsDir(), modelName);
  }

  getModelFilePath(modelName) {
    return this.serverManager.getModelFilePath(modelName);
  }

  async initializeAtStartup(settings = {}) {
    const startTime = Date.now();

    try {
      this.isInitialized = true;
      await cleanupStaleDownloads(this.getModelsDir());

      const { reasoningProvider, gemmaModel, gemmaIdleShutdownMs } = settings;

      if (typeof gemmaIdleShutdownMs === "number") {
        this.serverManager.setIdleShutdown(gemmaIdleShutdownMs);
      }

      if (
        reasoningProvider === "local-gemma" &&
        gemmaModel &&
        this.serverManager.isAvailable() &&
        this.serverManager.isModelDownloaded(gemmaModel)
      ) {
        debugLogger.info("Pre-warming Gemma llama-server", { model: gemmaModel });
        try {
          await this.serverManager.startServer(gemmaModel);
          debugLogger.info("Gemma server pre-warmed successfully", {
            model: gemmaModel,
            startupTimeMs: Date.now() - startTime,
          });
        } catch (err) {
          debugLogger.warn("Gemma server pre-warm failed (will start on demand)", {
            error: err.message,
            model: gemmaModel,
          });
        }
      } else {
        debugLogger.debug("Skipping Gemma server pre-warm", {
          reasoningProvider,
          gemmaModel: gemmaModel || null,
          binaryAvailable: this.serverManager.isAvailable(),
          modelDownloaded: gemmaModel
            ? this.serverManager.isModelDownloaded(gemmaModel)
            : false,
        });
      }
    } catch (error) {
      debugLogger.warn("Gemma initialization error", { error: error.message });
      this.isInitialized = true;
    }

    debugLogger.info("Gemma initialization complete", {
      totalTimeMs: Date.now() - startTime,
      binaryAvailable: this.serverManager.isAvailable(),
    });
  }

  async checkInstallation() {
    const binaryPath = this.serverManager.getBinaryPath();
    if (!binaryPath) {
      return { installed: false };
    }
    return { installed: true, path: binaryPath };
  }

  async startServer(modelName) {
    this.validateModelName(modelName);
    return this.serverManager.startServer(modelName);
  }

  async stopServer() {
    return this.serverManager.stopServer();
  }

  getServerStatus() {
    return this.serverManager.getServerStatus();
  }

  setIdleShutdown(ms) {
    this.serverManager.setIdleShutdown(ms);
  }

  notifyActivity() {
    this.serverManager.notifyActivity();
  }

  async downloadGemmaModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const modelInfo = getGemmaModelConfig(modelName);

    const modelDir = this.getModelDir(modelName);
    const modelsDir = this.getModelsDir();
    const destPath = this.getModelFilePath(modelName);

    await fsPromises.mkdir(modelDir, { recursive: true });

    if (this.serverManager.isModelDownloaded(modelName)) {
      return { model: modelName, downloaded: true, path: destPath, success: true };
    }

    // Need ~1.2× expected size for headroom during download
    const headroomBytes = Math.max(
      500 * 1024 * 1024,
      Math.floor(modelInfo.sizeBytes * 1.2),
    );
    const spaceCheck = await checkDiskSpace(modelsDir, headroomBytes);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space to download Gemma model. Need ~${Math.round(
          headroomBytes / 1_000_000,
        )} MB, only ${Math.round(
          spaceCheck.availableBytes / 1_000_000,
        )} MB available.`,
      );
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownload = { abort };

    try {
      await downloadFile(modelInfo.downloadUrl, destPath, {
        timeout: 600_000,
        signal,
        expectedSize: modelInfo.sizeBytes,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            progressCallback({
              type: "progress",
              model: modelName,
              downloaded_bytes: downloadedBytes,
              total_bytes: totalBytes || modelInfo.sizeBytes,
              percentage: (totalBytes || modelInfo.sizeBytes) > 0
                ? Math.round((downloadedBytes / (totalBytes || modelInfo.sizeBytes)) * 100)
                : 0,
            });
          }
        },
      });

      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }

      // Post-download pre-warm (non-fatal)
      if (this.serverManager.isAvailable()) {
        this.serverManager.startServer(modelName).catch((err) => {
          debugLogger.warn("Post-download Gemma pre-warm failed (non-fatal)", {
            error: err.message,
            model: modelName,
          });
        });
      }

      return { model: modelName, downloaded: true, path: destPath, success: true };
    } catch (error) {
      if (error.isAbort) {
        throw new Error("Download interrupted by user");
      }
      throw error;
    } finally {
      this.currentDownload = null;
    }
  }

  async cancelDownload() {
    if (this.currentDownload) {
      this.currentDownload.abort();
      this.currentDownload = null;
      return { success: true, message: "Download cancelled" };
    }
    return { success: false, error: "No active download to cancel" };
  }

  async checkModelStatus(modelName) {
    const info = getGemmaModelConfig(modelName);
    const file = this.getModelFilePath(modelName);

    if (file && this.serverManager.isModelDownloaded(modelName)) {
      try {
        const stats = fs.statSync(file);
        return {
          model: modelName,
          downloaded: true,
          path: file,
          size_bytes: stats.size,
          size_mb: Math.round(stats.size / (1024 * 1024)),
          expected_bytes: info?.sizeBytes || null,
          success: true,
        };
      } catch {
        return { model: modelName, downloaded: false, success: true };
      }
    }

    return { model: modelName, downloaded: false, success: true };
  }

  async listGemmaModels() {
    const models = getValidModelNames();
    const out = [];
    for (const name of models) {
      const status = await this.checkModelStatus(name);
      const info = getGemmaModelConfig(name);
      out.push({ ...status, info });
    }
    return { models: out, cache_dir: this.getModelsDir(), success: true };
  }

  async deleteGemmaModel(modelName) {
    this.validateModelName(modelName);
    const modelDir = this.getModelDir(modelName);
    const status = this.getServerStatus();

    // If the currently-running model is the one we're deleting, stop first
    if (status.running && status.modelName === modelName) {
      try {
        await this.stopServer();
      } catch (err) {
        debugLogger.warn("Failed to stop Gemma server before delete", {
          error: err.message,
        });
      }
    }

    if (fs.existsSync(modelDir)) {
      try {
        let freedBytes = 0;
        const file = this.getModelFilePath(modelName);
        if (file && fs.existsSync(file)) {
          freedBytes = fs.statSync(file).size;
        }
        fs.rmSync(modelDir, { recursive: true, force: true });
        return {
          model: modelName,
          deleted: true,
          freed_bytes: freedBytes,
          freed_mb: Math.round(freedBytes / (1024 * 1024)),
          success: true,
        };
      } catch (error) {
        return {
          model: modelName,
          deleted: false,
          error: error.message,
          success: false,
        };
      }
    }

    return { model: modelName, deleted: false, error: "Model not found", success: false };
  }
}

module.exports = GemmaManager;
