const fs = require("fs");
const path = require("path");
const debugLogger = require("./parakeetLogger");
const { getModelsDirForService } = require("./modelDirUtils");
const {
  isWavFormat,
  wavToFloat32Samples,
  computeFloat32RMS,
} = require("./ffmpegUtils");
const ParakeetWsServer = require("./parakeetWsServer");

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 4; // float32
const MAX_SEGMENT_SECONDS = 15;
const MAX_SEGMENT_BYTES = MAX_SEGMENT_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE;
// Consecutive segments overlap so a word straddling a cut point is never lost.
// The duplicated words in the overlap region are stitched back out when joining.
const OVERLAP_SECONDS = 2;
const OVERLAP_BYTES = OVERLAP_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE;
const SEGMENT_STEP_BYTES = MAX_SEGMENT_BYTES - OVERLAP_BYTES;
// Upper bound on how many words the overlap region can contain (fast speech ~4 w/s).
const MAX_OVERLAP_WORDS = OVERLAP_SECONDS * 5;
const SILENCE_RMS_THRESHOLD = 0.0005;

// Normalize a word for overlap comparison: lowercase, strip surrounding punctuation.
function normalizeWord(word) {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Append `nextText` to `prevText`, removing words duplicated by the audio overlap.
// Finds the longest suffix of prevText that matches a prefix of nextText (word-level,
// punctuation-insensitive) and drops that prefix from nextText before joining.
function mergeOverlappingText(prevText, nextText) {
  const next = nextText.trim();
  if (!prevText) return next;
  if (!next) return prevText;

  const prevWords = prevText.split(/\s+/).filter(Boolean);
  const nextWords = next.split(/\s+/).filter(Boolean);
  const maxK = Math.min(prevWords.length, nextWords.length, MAX_OVERLAP_WORDS);

  let overlap = 0;
  for (let k = maxK; k > 0; k--) {
    const prevTail = prevWords
      .slice(prevWords.length - k)
      .map(normalizeWord)
      .join(" ");
    const nextHead = nextWords.slice(0, k).map(normalizeWord).join(" ");
    if (prevTail && prevTail === nextHead) {
      overlap = k;
      break;
    }
  }

  const remainder = nextWords.slice(overlap).join(" ");
  return remainder ? `${prevText} ${remainder}` : prevText;
}

class ParakeetServerManager {
  constructor() {
    this.wsServer = new ParakeetWsServer();
  }

  getBinaryPath() {
    return this.wsServer.getWsBinaryPath();
  }

  isAvailable() {
    return this.wsServer.isAvailable();
  }

  getModelsDir() {
    return getModelsDirForService("parakeet");
  }

  isModelDownloaded(modelName) {
    const modelDir = path.join(this.getModelsDir(), modelName);
    const requiredFiles = [
      "encoder.int8.onnx",
      "decoder.int8.onnx",
      "joiner.int8.onnx",
      "tokens.txt",
    ];

    if (!fs.existsSync(modelDir)) return false;

    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(modelDir, file))) {
        return false;
      }
    }

    return true;
  }

  async transcribe(audioBuffer, options = {}) {
    const { modelName = "parakeet-tdt-0.6b-v3", language = "auto" } = options;

    const modelDir = path.join(this.getModelsDir(), modelName);
    if (!this.isModelDownloaded(modelName)) {
      throw new Error(`Parakeet model "${modelName}" not downloaded`);
    }

    debugLogger.debug("Parakeet transcription request", {
      modelName,
      language,
      audioSize: audioBuffer?.length || 0,
      isWavFormat: isWavFormat(audioBuffer),
    });

    // Audio must be WAV format (PPQ's pipeline produces 16kHz mono WAV)
    if (!isWavFormat(audioBuffer)) {
      throw new Error(
        "Audio must be in WAV format. Ensure audio is optimized before sending to Parakeet."
      );
    }

    if (!this.wsServer.ready || this.wsServer.modelName !== modelName) {
      await this.wsServer.start(modelName, modelDir);
    }

    const samples = wavToFloat32Samples(audioBuffer);
    const durationSeconds = samples.length / BYTES_PER_SAMPLE / SAMPLE_RATE;

    const rms = computeFloat32RMS(samples);
    debugLogger.debug("Parakeet audio analysis", { durationSeconds, rms });
    if (rms < SILENCE_RMS_THRESHOLD) {
      return { text: "", elapsed: 0, language };
    }

    if (samples.length <= MAX_SEGMENT_BYTES) {
      const result = await this.wsServer.transcribe(samples, SAMPLE_RATE);
      if (!result.text?.trim()) {
        debugLogger.warn("Parakeet returned empty text for non-silent audio", {
          durationSeconds,
          rms,
          samplesBytes: samples.length,
        });
      }
      return { ...result, language };
    }

    debugLogger.debug("Parakeet segmenting long audio", {
      durationSeconds,
      segmentCount: Math.ceil(
        (samples.length - OVERLAP_BYTES) / SEGMENT_STEP_BYTES
      ),
      overlapSeconds: OVERLAP_SECONDS,
    });

    let mergedText = "";
    let totalElapsed = 0;
    let segmentIndex = 0;

    for (
      let offset = 0;
      offset < samples.length;
      offset += SEGMENT_STEP_BYTES
    ) {
      const end = Math.min(offset + MAX_SEGMENT_BYTES, samples.length);
      const segment = samples.subarray(offset, end);
      const result = await this.wsServer.transcribe(segment, SAMPLE_RATE);
      totalElapsed += result.elapsed || 0;
      if (result.text) {
        mergedText = mergeOverlappingText(mergedText, result.text);
      } else {
        debugLogger.warn("Parakeet segment returned empty text", {
          segmentIndex,
          segmentDuration: segment.length / BYTES_PER_SAMPLE / SAMPLE_RATE,
        });
      }
      segmentIndex += 1;
      // The window already reached the end of the audio; stepping further would
      // only re-transcribe audio that is fully covered by this segment.
      if (end >= samples.length) break;
    }

    return { text: mergedText, elapsed: totalElapsed, language };
  }

  async startServer(modelName) {
    if (!this.wsServer.isAvailable()) {
      return { success: false, reason: "parakeet WS server binary not found" };
    }

    const modelDir = path.join(this.getModelsDir(), modelName);
    if (!this.isModelDownloaded(modelName)) {
      return { success: false, reason: `Model "${modelName}" not downloaded` };
    }

    try {
      await this.wsServer.start(modelName, modelDir);
      return { success: true, port: this.wsServer.port };
    } catch (error) {
      debugLogger.error("Failed to start parakeet WS server", { error: error.message });
      return { success: false, reason: error.message };
    }
  }

  async stopServer() {
    await this.wsServer.stop();
  }

  killServerNow() {
    this.wsServer.killNow();
  }

  getServerStatus() {
    return this.wsServer.getStatus();
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      binaryPath: this.getBinaryPath(),
      modelsDir: this.getModelsDir(),
    };
  }
}

module.exports = ParakeetServerManager;
