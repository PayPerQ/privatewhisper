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
const moduleCacheBaseDir = path.join(outputDir, ".swift-module-cache");
const requiredArchitectures = ["arm64", "x86_64"];
const requireUniversal =
  process.env.PPQ_GLOBE_LISTENER_REQUIRE_UNIVERSAL === "true" ||
  process.env.CI === "true";

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
ensureDir(moduleCacheBaseDir);

function getBinaryArchitectures(binaryPath) {
  const lipoCommands = [
    ["xcrun", ["lipo", "-info", binaryPath]],
    ["lipo", ["-info", binaryPath]],
  ];

  for (const [command, args] of lipoCommands) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status === 0) {
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      const fatMatch = output.match(/are:\s*(.+)$/);
      if (fatMatch) {
        return fatMatch[1].trim().split(/\s+/);
      }
      const thinMatch = output.match(/architecture:\s*(\S+)/);
      if (thinMatch) {
        return [thinMatch[1]];
      }
      return [];
    }
  }

  return null;
}

let needsBuild = true;
if (fs.existsSync(outputBinary)) {
  try {
    const binaryStat = fs.statSync(outputBinary);
    const sourceStat = fs.statSync(swiftSource);
    if (binaryStat.mtimeMs >= sourceStat.mtimeMs) {
      const archs = getBinaryArchitectures(outputBinary);
      if (
        archs &&
        requiredArchitectures.every((arch) => archs.includes(arch))
      ) {
        needsBuild = false;
      }
    }
  } catch {
    needsBuild = true;
  }
}

if (!needsBuild) {
  process.exit(0);
}

function attemptCompile(command, args, envOverrides = {}) {
  log(`Compiling with ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
}

const buildTargets = [
  { arch: "arm64", target: "arm64-apple-macosx11.0" },
  { arch: "x86_64", target: "x86_64-apple-macosx10.13" },
];

const builtBinaries = [];
const builtArchitectures = new Set();

for (const target of buildTargets) {
  const moduleCacheDir = `${moduleCacheBaseDir}-${target.arch}`;
  ensureDir(moduleCacheDir);

  const archOutputBinary = path.join(
    outputDir,
    `macos-globe-listener-${target.arch}`,
  );
  const compileArgs = [
    swiftSource,
    "-O",
    "-target",
    target.target,
    "-module-cache-path",
    moduleCacheDir,
    "-o",
    archOutputBinary,
  ];

  let result = attemptCompile("xcrun", ["swiftc", ...compileArgs], {
    SWIFT_MODULE_CACHE_PATH: moduleCacheDir,
  });

  if (result.status !== 0) {
    result = attemptCompile("swiftc", compileArgs, {
      SWIFT_MODULE_CACHE_PATH: moduleCacheDir,
    });
  }

  if (result.status !== 0) {
    console.error(`[globe-listener] Failed to compile ${target.arch} binary.`);
    continue;
  }

  builtBinaries.push(archOutputBinary);
  builtArchitectures.add(target.arch);
}

if (builtBinaries.length === 0) {
  console.error(
    "[globe-listener] Failed to compile macOS Globe listener binary.",
  );
  process.exit(1);
}

if (
  requireUniversal &&
  requiredArchitectures.some((arch) => !builtArchitectures.has(arch))
) {
  const missing = requiredArchitectures.filter(
    (arch) => !builtArchitectures.has(arch),
  );
  console.error(
    `[globe-listener] Missing required architectures: ${missing.join(", ")}`,
  );
  process.exit(1);
}

if (builtBinaries.length === 1) {
  fs.copyFileSync(builtBinaries[0], outputBinary);
} else {
  const lipoCommands = [
    ["xcrun", ["lipo", "-create", "-output", outputBinary, ...builtBinaries]],
    ["lipo", ["-create", "-output", outputBinary, ...builtBinaries]],
  ];
  let lipoSuccess = false;
  for (const [command, args] of lipoCommands) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.status === 0) {
      lipoSuccess = true;
      break;
    }
  }

  if (!lipoSuccess) {
    console.error(
      "[globe-listener] Failed to create a universal binary with lipo.",
    );
    process.exit(1);
  }
}

try {
  fs.chmodSync(outputBinary, 0o755);
} catch (error) {
  console.warn(
    `[globe-listener] Unable to set executable permissions: ${error.message}`,
  );
}

log("Successfully built macOS Globe listener binary.");
