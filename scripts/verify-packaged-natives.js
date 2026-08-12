// electron-builder afterPack hook.
//
// The sherpa-onnx WS server links ONNX Runtime dynamically and resolves it from
// its own directory. If the runtime library is missing from resources/bin the
// packaged app still looks fine — the server binary is there — but every local
// Parakeet transcription fails at spawn time, in ways that depend on whatever
// stray copy of ONNX Runtime the OS happens to find first (a version mismatch,
// a wrong-arch image, or nothing at all). That shipped undetected for months,
// so fail the build instead.
const fs = require("fs");
const path = require("path");

const RUNTIME_LIB = {
  win32: "onnxruntime.dll",
  darwin: "libonnxruntime.dylib",
  linux: "libonnxruntime.so",
};

function resourcesBinDir(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  if (electronPlatformName === "darwin") {
    return path.join(
      appOutDir,
      `${packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
      "bin",
    );
  }
  return path.join(appOutDir, "resources", "bin");
}

module.exports = async function verifyPackagedNatives(context) {
  const platform = context.electronPlatformName;
  const binDir = resourcesBinDir(context);
  if (!fs.existsSync(binDir)) return;

  const serverBinary = fs
    .readdirSync(binDir)
    .find((name) => name.startsWith("sherpa-onnx-ws-"));
  // Not every build has the Parakeet binaries staged (a dev can package without
  // running the download script); only assert when the server actually shipped.
  if (!serverBinary) return;

  const runtimeLib = RUNTIME_LIB[platform];
  if (!runtimeLib) return;

  if (!fs.existsSync(path.join(binDir, runtimeLib))) {
    throw new Error(
      `Packaging check failed: ${binDir} contains ${serverBinary} but not ${runtimeLib}. ` +
        `Local Parakeet transcription would be broken in this build. Check the ` +
        `extraResources filter in electron-builder.json and run ` +
        `\`npm run download:sherpa-onnx\`.`,
    );
  }
};
