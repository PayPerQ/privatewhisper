const fs = require("fs");
const { promises: fsPromises } = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { app } = require("electron");
const { downloadFile, createDownloadSignal, checkDiskSpace } = require("./downloadUtils");
const debugLogger = require("./parakeetLogger");

const SHERPA_ONNX_VERSION = "1.12.23";
const GITHUB_RELEASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_ONNX_VERSION}`;

const BINARIES = {
  "darwin-arm64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-osx-universal2-shared.tar.bz2`,
    binaryPath: "sherpa-onnx-offline-websocket-server",
    outputName: "sherpa-onnx-ws-darwin-arm64",
    libPattern: "*.dylib",
  },
  "darwin-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-osx-universal2-shared.tar.bz2`,
    binaryPath: "sherpa-onnx-offline-websocket-server",
    outputName: "sherpa-onnx-ws-darwin-x64",
    libPattern: "*.dylib",
  },
  "win32-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-win-x64-shared.tar.bz2`,
    binaryPath: "sherpa-onnx-offline-websocket-server.exe",
    outputName: "sherpa-onnx-ws-win32-x64.exe",
    libPattern: "*.dll",
  },
  "linux-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-linux-x64-shared.tar.bz2`,
    binaryPath: "sherpa-onnx-offline-websocket-server",
    outputName: "sherpa-onnx-ws-linux-x64",
    libPattern: "*.so*",
  },
};

function getDownloadUrl(archiveName) {
  return `${GITHUB_RELEASE_URL}/${archiveName}`;
}
const { resolveBinaryPath } = require("../utils/serverUtils");

class SherpaOnnxInstaller {
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
    const key = this._getPlatformKey();
    return BINARIES[key] || null;
  }

  _getBinaryName() {
    const key = this._getPlatformKey();
    return process.platform === "win32"
      ? `sherpa-onnx-ws-${key}.exe`
      : `sherpa-onnx-ws-${key}`;
  }

  isInstalled() {
    return this.getBinaryPath() !== null;
  }

  getBinaryPath() {
    return resolveBinaryPath(this._getBinaryName());
  }

  async install(progressCallback) {
    const config = this._getConfig();
    if (!config) {
      throw new Error(`Unsupported platform: ${this._getPlatformKey()}`);
    }

    // Already installed?
    if (this.isInstalled()) {
      return { success: true, path: this.getBinaryPath() };
    }

    const binDir = this._getBinDir();
    await fsPromises.mkdir(binDir, { recursive: true });

    // Check disk space (~250MB for download + extraction)
    const spaceCheck = await checkDiskSpace(binDir, 250 * 1024 * 1024);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space. Need ~250 MB, only ${Math.round(spaceCheck.availableBytes / 1024 / 1024)} MB available.`
      );
    }

    const url = getDownloadUrl(config.archiveName);
    const archivePath = path.join(binDir, config.archiveName);
    const { signal, abort } = createDownloadSignal();
    this.currentDownload = { abort };

    try {
      debugLogger.info("Starting sherpa-onnx binary download", {
        platform: this._getPlatformKey(),
        url: url.substring(0, 80),
        binDir,
      });

      // Download the archive
      await downloadFile(url, archivePath, {
        timeout: 300000,
        signal,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            progressCallback({
              type: "progress",
              downloaded_bytes: downloadedBytes,
              total_bytes: totalBytes,
              percentage: totalBytes > 0
                ? Math.round((downloadedBytes / totalBytes) * 100)
                : 0,
            });
          }
        },
      });

      if (progressCallback) {
        progressCallback({ type: "installing", percentage: 100 });
      }

      // Extract
      const extractDir = path.join(binDir, `temp-sherpa-extract`);
      await fsPromises.mkdir(extractDir, { recursive: true });

      try {
        await this._extractArchive(archivePath, extractDir);
        await this._copyBinariesAndLibs(extractDir, binDir, config);
      } finally {
        await fsPromises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
      }

      // Clean up archive
      await fsPromises.unlink(archivePath).catch(() => {});

      // Write version file
      await fsPromises.writeFile(
        path.join(binDir, "sherpa-onnx-version.txt"),
        SHERPA_ONNX_VERSION,
        "utf-8"
      );

      // Remove macOS quarantine attribute
      if (process.platform === "darwin") {
        await this._removeQuarantine(binDir);
      }

      const binaryPath = path.join(binDir, config.outputName);
      debugLogger.info("sherpa-onnx binary installed", { binaryPath });

      if (progressCallback) {
        progressCallback({ type: "complete", percentage: 100 });
      }

      return { success: true, path: binaryPath };
    } catch (error) {
      if (error.isAbort) {
        await fsPromises.unlink(archivePath).catch(() => {});
        throw new Error("Installation cancelled by user");
      }
      debugLogger.error("sherpa-onnx install failed", { error: error.message });
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

  async _extractArchive(archivePath, extractDir) {
    // Try system tar first
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn("tar", ["-xjf", archivePath, "-C", extractDir], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr.on("data", (data) => { stderr += data.toString(); });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`tar failed with code ${code}: ${stderr}`));
        });
        proc.on("error", (err) => reject(err));
      });
      return;
    } catch (err) {
      debugLogger.debug("System tar failed, falling back to JS extraction", {
        error: err.message,
      });
    }

    // Fallback to JS extraction
    const unbzip2 = require("unbzip2-stream");
    const tar = require("tar");
    const { pipeline } = require("stream");
    const { promisify } = require("util");
    const pipelineAsync = promisify(pipeline);
    await pipelineAsync(
      fs.createReadStream(archivePath),
      unbzip2(),
      tar.x({ cwd: extractDir })
    );
  }

  async _copyBinariesAndLibs(extractDir, binDir, config) {
    // Find the binary
    const binaryName = path.basename(config.binaryPath);
    const binaryPath = await this._findFileRecursive(extractDir, binaryName);

    if (!binaryPath) {
      throw new Error(`Binary '${binaryName}' not found in extracted archive`);
    }

    // Copy binary with the correct output name
    const outputPath = path.join(binDir, config.outputName);
    await fsPromises.copyFile(binaryPath, outputPath);
    await fsPromises.chmod(outputPath, 0o755);
    debugLogger.info("Copied sherpa-onnx binary", { outputPath });

    // Copy libraries
    if (config.libPattern) {
      const libraries = await this._findLibraries(extractDir, config.libPattern);
      const versionedLibs = new Map();

      for (const libPath of libraries) {
        const libName = path.basename(libPath);
        const destPath = path.join(binDir, libName);
        await fsPromises.copyFile(libPath, destPath);
        await fsPromises.chmod(destPath, 0o755);
        debugLogger.info("Copied library", { libName });

        // Track versioned libs for symlinking
        const versionMatch = libName.match(/^(lib.+?)\.(\d+\.\d+\.\d+)\.(dylib|so|dll)$/);
        if (versionMatch) {
          const baseName = `${versionMatch[1]}.${versionMatch[3]}`;
          versionedLibs.set(baseName, libName);
        }
      }

      // Create symlinks for versioned libraries (macOS/Linux)
      if (process.platform !== "win32") {
        for (const [baseName, versionedName] of versionedLibs) {
          const basePath = path.join(binDir, baseName);
          try {
            // Remove existing file/symlink if present
            await fsPromises.unlink(basePath).catch(() => {});
            await fsPromises.symlink(versionedName, basePath);
            debugLogger.info("Symlinked library", { baseName, versionedName });
          } catch (err) {
            debugLogger.warn("Failed to create symlink", {
              baseName,
              versionedName,
              error: err.message,
            });
          }
        }
      }
    }
  }

  async _findFileRecursive(dir, name, maxDepth = 5, depth = 0) {
    if (depth >= maxDepth) return null;
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === name && entry.isFile()) return fullPath;
        if (entry.isDirectory()) {
          const found = await this._findFileRecursive(fullPath, name, maxDepth, depth + 1);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }

  async _findLibraries(dir, pattern, maxDepth = 5, depth = 0) {
    if (depth >= maxDepth) return [];
    const results = [];
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...await this._findLibraries(fullPath, pattern, maxDepth, depth + 1));
        } else if (this._matchesPattern(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    } catch {}
    return results;
  }

  _matchesPattern(filename, pattern) {
    if (pattern === "*.dylib") return filename.endsWith(".dylib");
    if (pattern === "*.dll") return filename.endsWith(".dll");
    if (pattern === "*.so*") return /\.so(\.\d+)*$/.test(filename) || filename.endsWith(".so");
    return false;
  }

  async _removeQuarantine(dir) {
    try {
      const entries = await fsPromises.readdir(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          await new Promise((resolve) => {
            execFile("xattr", ["-d", "com.apple.quarantine", fullPath], (err) => {
              resolve(); // Ignore errors — file may not have the attribute
            });
          });
        } catch {}
      }
    } catch {}
  }
}

module.exports = SherpaOnnxInstaller;
