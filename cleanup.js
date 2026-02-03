const path = require("path");
const fs = require("fs");
const os = require("os");

const DEBUG =
  process.env.PPQVOICE_DEBUG === "true" || process.argv.includes("--debug");

function log(message, ...args) {
  if (DEBUG) {
    console.log(message, ...args);
  }
}

function error(message, ...args) {
  console.error(message, ...args);
}

log("Cleaning build directories...");
const dirsToClean = ["dist/", "src/dist/", "node_modules/.cache/"];

dirsToClean.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    log(`Cleaned: ${dir}`);
  } else {
    log(`Directory not found: ${dir}`);
  }
});

log("Cleaning development database...");
try {
  const userDataPath =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "ppq-whisper")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA || os.homedir(), "ppq-whisper")
        : path.join(os.homedir(), ".config", "ppq-whisper");

  const devDbPath = path.join(userDataPath, "transcriptions-dev.db");

  if (fs.existsSync(devDbPath)) {
    fs.unlinkSync(devDbPath);
    log(`Development database cleaned: ${devDbPath}`);
  } else {
    log("No development database found to clean");
  }
} catch (err) {
  error("Error cleaning database files:", err.message);
}

log("Cleanup completed successfully!");
