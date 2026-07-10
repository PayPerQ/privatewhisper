const fs = require("fs");
const net = require("net");
const path = require("path");
const { execFile } = require("child_process");
const { killProcess } = require("./process");

const GRACEFUL_STOP_TIMEOUT_MS = 5000;
const CONNECT_PROBE_TIMEOUT_MS = 500;

function canConnectTo(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(CONNECT_PROBE_TIMEOUT_MS, () => finish(false));
  });
}

function canBindTo(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    // Bind the wildcard address, like the servers we spawn do. Binding
    // 127.0.0.1 here false-positives on macOS: Node sets SO_REUSEADDR, which
    // on BSD lets a specific-address bind succeed while another process
    // (e.g. a stale sherpa-onnx server) holds the wildcard on the same port.
    server.listen(port);
  });
}

async function isPortAvailable(port) {
  if (await canConnectTo(port)) return false;
  return canBindTo(port);
}

function getPosixPidsMatching(binaryPath) {
  return new Promise((resolve) => {
    // pgrep -f matches the full command line as a regex; escape the path so
    // its metacharacters are matched literally.
    const pattern = binaryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    execFile("pgrep", ["-f", pattern], (err, stdout) => {
      if (err) return resolve([]); // no matches (or pgrep unavailable)
      resolve(
        stdout
          .split("\n")
          .map((line) => parseInt(line.trim(), 10))
          .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid),
      );
    });
  });
}

function getPosixProcessInfo(pid) {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "ppid=,comm=", "-p", String(pid)], (err, stdout) => {
      if (err) return resolve(null);
      const match = stdout.trim().match(/^(\d+)\s+(.*)$/);
      if (!match) return resolve(null);
      resolve({ ppid: parseInt(match[1], 10), command: match[2].trim() });
    });
  });
}

/**
 * Kill orphaned server processes left behind by a crashed or force-quit app
 * instance. Only true orphans are killed — a process whose parent is still
 * alive belongs to another running app instance and is left alone. Returns
 * the number of processes killed.
 */
async function killOrphanedProcesses(binaryPath) {
  if (!binaryPath) return 0;

  if (process.platform === "win32") {
    const escapedPath = binaryPath.replace(/'/g, "''");
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='${path.basename(binaryPath)}'" | ` +
      `Where-Object { $_.ExecutablePath -eq '${escapedPath}' -and ` +
      "-not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }";
    return new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true },
        (err, stdout) =>
          resolve(err ? 0 : stdout.split("\n").filter((line) => line.trim()).length),
      );
    });
  }

  const pids = await getPosixPidsMatching(binaryPath);
  let killed = 0;
  for (const pid of pids) {
    const info = await getPosixProcessInfo(pid);
    if (!info) continue;
    // pgrep -f matches anywhere in the command line, which also catches
    // unrelated processes that merely mention the path in their arguments
    // (shells, editors). Require the executable itself to be our binary.
    if (info.command !== binaryPath) continue;
    // Orphans get reparented to init/launchd (pid 1) when their parent dies.
    if (info.ppid !== 1) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed += 1;
    } catch {
      // Already gone
    }
  }
  return killed;
}

async function findAvailablePort(rangeStart, rangeEnd) {
  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available ports in range ${rangeStart}-${rangeEnd}`);
}

function resolveBinaryPath(binaryName) {
  const candidates = [];

  // 1. Packaged app resources (read-only in production)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bin", binaryName));
  }

  // 2. Dev mode project directory
  const projectBinDir = path.resolve(__dirname, "..", "..", "resources", "bin");
  candidates.push(path.join(projectBinDir, binaryName));

  // 3. Runtime-downloaded fallback (userData/bin/)
  try {
    const { app } = require("electron");
    if (app && app.getPath) {
      candidates.push(path.join(app.getPath("userData"), "bin", binaryName));
    }
  } catch {
    // Not in main process or app not ready
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.statSync(candidate);
        return candidate;
      } catch {
        // Can't access binary
      }
    }
  }

  return null;
}

async function gracefulStopProcess(proc) {
  killProcess(proc, "SIGTERM");

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (proc) killProcess(proc, "SIGKILL");
      resolve();
    }, GRACEFUL_STOP_TIMEOUT_MS);

    if (proc) {
      proc.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    } else {
      clearTimeout(timeout);
      resolve();
    }
  });
}

module.exports = {
  findAvailablePort,
  isPortAvailable,
  resolveBinaryPath,
  gracefulStopProcess,
  killOrphanedProcesses,
};
