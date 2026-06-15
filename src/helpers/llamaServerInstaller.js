const { promises: fsPromises } = require("fs");
const path = require("path");
const { app } = require("electron");
const { downloadFile, createDownloadSignal, checkDiskSpace } = require("./downloadUtils");
const {
  extractArchive,
  findFileRecursive,
  findFilesMatching,
  matchesLibraryPattern,
  removeQuarantineRecursive,
} = require("./archiveUtils");
const { resolveBinaryPath } = require("../utils/serverUtils");
const debugLogger = require("./gemmaLogger");

// Pinned llama.cpp build. Bump when upgrading; version-file mismatch triggers reinstall.
const LLAMA_SERVER_BUILD = "b8902";
const GITHUB_RELEASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_SERVER_BUILD}`;

const BINARIES = {
  "darwin-arm64": {
    archiveName: `llama-${LLAMA_SERVER_BUILD}-bin-macos-arm64.tar.gz`,
    binaryName: "llama-server",
    outputName: "llama-server-darwin-arm64",
    libPattern: "*.dylib",
  },
  "win32-x64": {
    archiveName: `llama-${LLAMA_SERVER_BUILD}-bin-win-cpu-x64.zip`,
    binaryName: "llama-server.exe",
    outputName: "llama-server-win32-x64.exe",
    libPattern: "*.dll",
  },
  "linux-x64": {
    archiveName: `llama-${LLAMA_SERVER_BUILD}-bin-ubuntu-x64.tar.gz`,
    binaryName: "llama-server",
    outputName: "llama-server-linux-x64",
    libPattern: "*.so*",
  },
};

function getDownloadUrl(archiveName) {
  return `${GITHUB_RELEASE_URL}/${archiveName}`;
}

class LlamaServerInstaller {
  constructor() {
    this.currentDownload = null;
  }

  _getPlatformKey() {
    return `${process.platform}-${process.arch}`;
  }

  _getBinDir() {
    return path.join(app.getPath("userData"), "bin");
  }

  _getConfig() {
    return BINARIES[this._getPlatformKey()] || null;
  }

  _getOutputBinaryName() {
    const config = this._getConfig();
    return config ? config.outputName : null;
  }

  isSupported() {
    return this._getConfig() !== null;
  }

  isInstalled() {
    return this.getBinaryPath() !== null;
  }

  getBinaryPath() {
    const outputName = this._getOutputBinaryName();
    if (!outputName) return null;
    return resolveBinaryPath(outputName);
  }

  async install(progressCallback) {
    const config = this._getConfig();
    if (!config) {
      throw new Error(
        `Local Gemma is not supported on this platform: ${this._getPlatformKey()}`,
      );
    }

    if (this.isInstalled()) {
      return { success: true, path: this.getBinaryPath() };
    }

    const binDir = this._getBinDir();
    await fsPromises.mkdir(binDir, { recursive: true });

    // llama-server + libs is ~30-60 MB. Require 200 MB for download + extraction headroom.
    const spaceCheck = await checkDiskSpace(binDir, 200 * 1024 * 1024);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space. Need ~200 MB, only ${Math.round(
          spaceCheck.availableBytes / 1024 / 1024,
        )} MB available.`,
      );
    }

    const url = getDownloadUrl(config.archiveName);
    const archivePath = path.join(binDir, config.archiveName);
    const { signal, abort } = createDownloadSignal();
    this.currentDownload = { abort };

    try {
      debugLogger.info("Starting llama-server binary download", {
        platform: this._getPlatformKey(),
        url: url.substring(0, 120),
        binDir,
      });

      await downloadFile(url, archivePath, {
        timeout: 300_000,
        signal,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            progressCallback({
              type: "progress",
              downloaded_bytes: downloadedBytes,
              total_bytes: totalBytes,
              percentage:
                totalBytes > 0
                  ? Math.round((downloadedBytes / totalBytes) * 100)
                  : 0,
            });
          }
        },
      });

      if (progressCallback) {
        progressCallback({ type: "installing", percentage: 100 });
      }

      const extractDir = path.join(binDir, "temp-llama-extract");
      await fsPromises.mkdir(extractDir, { recursive: true });

      try {
        await extractArchive(archivePath, extractDir);
        await this._copyBinariesAndLibs(extractDir, binDir, config);
      } finally {
        await fsPromises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      }

      await fsPromises.unlink(archivePath).catch(() => {});

      await fsPromises.writeFile(
        path.join(binDir, "llama-server-version.txt"),
        LLAMA_SERVER_BUILD,
        "utf-8",
      );

      if (process.platform === "darwin") {
        await removeQuarantineRecursive(binDir);
      }

      const binaryPath = path.join(binDir, config.outputName);
      debugLogger.info("llama-server binary installed", { binaryPath });

      if (progressCallback) {
        progressCallback({ type: "complete", percentage: 100 });
      }

      return { success: true, path: binaryPath };
    } catch (error) {
      if (error.isAbort) {
        await fsPromises.unlink(archivePath).catch(() => {});
        throw new Error("Installation cancelled by user");
      }
      debugLogger.error("llama-server install failed", { error: error.message });
      throw error;
    } finally {
      this.currentDownload = null;
    }
  }

  cancelInstall() {
    if (this.currentDownload) {
      this.currentDownload.abort();
      this.currentDownload = null;
      return { success: true };
    }
    return { success: false, error: "No active installation" };
  }

  async _copyBinariesAndLibs(extractDir, binDir, config) {
    const binaryPath = await findFileRecursive(extractDir, config.binaryName);
    if (!binaryPath) {
      throw new Error(`Binary '${config.binaryName}' not found in extracted archive`);
    }

    const outputPath = path.join(binDir, config.outputName);
    await fsPromises.copyFile(binaryPath, outputPath);
    await fsPromises.chmod(outputPath, 0o755);
    debugLogger.info("Copied llama-server binary", { outputPath });

    if (!config.libPattern) return;

    const libraryPaths = await findFilesMatching(extractDir, (name) =>
      matchesLibraryPattern(name, config.libPattern),
    );

    // Copy libraries adjacent to the binary so the OS loader finds them
    // (combined with DYLD_LIBRARY_PATH / LD_LIBRARY_PATH / PATH at spawn time).
    for (const libPath of libraryPaths) {
      const libName = path.basename(libPath);
      const destPath = path.join(binDir, libName);
      await fsPromises.copyFile(libPath, destPath);
      await fsPromises.chmod(destPath, 0o755);
      debugLogger.debug("Copied library", { libName });
    }
  }
}

module.exports = LlamaServerInstaller;
module.exports.LLAMA_SERVER_BUILD = LLAMA_SERVER_BUILD;
