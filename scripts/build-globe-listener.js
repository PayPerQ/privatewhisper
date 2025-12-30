#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const isMac = process.platform === "darwin";
if (!isMac) {
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, "..");
const swiftSource = path.join(
  projectRoot,
  "resources",
  "macos-globe-listener.swift",
);
const outputDir = path.join(projectRoot, "resources", "bin");
const outputBinary = path.join(outputDir, "macos-globe-listener");
const moduleCacheDir = path.join(outputDir, ".swift-module-cache");

function log(message) {
  console.log(`[globe-listener] ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

if (!fs.existsSync(swiftSource)) {
  console.error(`[globe-listener] Swift source not found at ${swiftSource}`);
  process.exit(1);
}

ensureDir(outputDir);
ensureDir(moduleCacheDir);

let needsBuild = true;
if (fs.existsSync(outputBinary)) {
  try {
    const binaryStat = fs.statSync(outputBinary);
    const sourceStat = fs.statSync(swiftSource);
    if (binaryStat.mtimeMs >= sourceStat.mtimeMs) {
      needsBuild = false;
    }
  } catch {
    needsBuild = true;
  }
}

if (!needsBuild) {
  process.exit(0);
}

function attemptCompile(command, args) {
  log(`Compiling with ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SWIFT_MODULE_CACHE_PATH: moduleCacheDir,
    },
  });
}

const compileArgs = [
  swiftSource,
  "-O",
  "-module-cache-path",
  moduleCacheDir,
  "-o",
  outputBinary,
];

let result = attemptCompile("xcrun", ["swiftc", ...compileArgs]);

if (result.status !== 0) {
  result = attemptCompile("swiftc", compileArgs);
}

if (result.status !== 0) {
  console.error(
    "[globe-listener] Failed to compile macOS Globe listener binary.",
  );
  process.exit(result.status ?? 1);
}

try {
  fs.chmodSync(outputBinary, 0o755);
} catch (error) {
  console.warn(
    `[globe-listener] Unable to set executable permissions: ${error.message}`,
  );
}

log("Successfully built macOS Globe listener binary.");
