const fs = require("fs");
const { promises: fsPromises } = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { pipeline } = require("stream");
const { promisify } = require("util");

const pipelineAsync = promisify(pipeline);

async function extractTarBz2(archivePath, extractDir) {
  try {
    await _runCommand("tar", ["-xjf", archivePath, "-C", extractDir]);
    return;
  } catch {
    // fall through to JS fallback
  }
  const unbzip2 = require("unbzip2-stream");
  const tar = require("tar");
  await pipelineAsync(
    fs.createReadStream(archivePath),
    unbzip2(),
    tar.x({ cwd: extractDir }),
  );
}

async function extractTarGz(archivePath, extractDir) {
  try {
    await _runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
    return;
  } catch {
    // fall through to JS fallback
  }
  const tar = require("tar");
  await tar.x({ file: archivePath, cwd: extractDir });
}

async function extractZip(archivePath, extractDir) {
  if (process.platform !== "win32") {
    // macOS/Linux usually have `unzip` installed; try that first
    try {
      await _runCommand("unzip", ["-qq", "-o", archivePath, "-d", extractDir]);
      return;
    } catch {
      // fall through to JS fallback
    }
  }
  const unzipper = require("unzipper");
  await pipelineAsync(
    fs.createReadStream(archivePath),
    unzipper.Extract({ path: extractDir }),
  );
}

async function extractArchive(archivePath, extractDir) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) {
    return extractTarBz2(archivePath, extractDir);
  }
  if (
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz")
  ) {
    return extractTarGz(archivePath, extractDir);
  }
  if (lower.endsWith(".zip")) {
    return extractZip(archivePath, extractDir);
  }
  throw new Error(`Unsupported archive format: ${archivePath}`);
}

function _runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed with code ${code}: ${stderr}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

async function findFileRecursive(dir, name, maxDepth = 6, depth = 0) {
  if (depth >= maxDepth) return null;
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === name && entry.isFile()) return full;
      if (entry.isDirectory()) {
        const found = await findFileRecursive(full, name, maxDepth, depth + 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

async function findFilesMatching(dir, predicate, maxDepth = 6, depth = 0) {
  if (depth >= maxDepth) return [];
  const results = [];
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await findFilesMatching(full, predicate, maxDepth, depth + 1)));
      } else if (predicate(entry.name)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

function matchesLibraryPattern(filename, pattern) {
  if (pattern === "*.dylib") return filename.endsWith(".dylib");
  if (pattern === "*.dll") return filename.endsWith(".dll");
  if (pattern === "*.so*") return /\.so(\.\d+)*$/.test(filename) || filename.endsWith(".so");
  return false;
}

async function removeQuarantineRecursive(dir) {
  if (process.platform !== "darwin") return;
  try {
    const entries = await fsPromises.readdir(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        await new Promise((resolve) => {
          execFile("xattr", ["-d", "com.apple.quarantine", full], () => resolve());
        });
      } catch {}
    }
  } catch {}
}

module.exports = {
  extractArchive,
  extractTarBz2,
  extractTarGz,
  extractZip,
  findFileRecursive,
  findFilesMatching,
  matchesLibraryPattern,
  removeQuarantineRecursive,
};
