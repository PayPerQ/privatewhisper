const fs = require("fs");
const path = require("path");
const debugLogger = require("./parakeetLogger");

/**
 * Check if a buffer starts with the WAV header (RIFF...WAVE)
 */
function isWavFormat(buffer) {
  if (!buffer || buffer.length < 12) return false;

  return (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x41 && // A
    buffer[10] === 0x56 && // V
    buffer[11] === 0x45 // E
  );
}

/**
 * Parse a WAV buffer and extract float32 PCM samples.
 * The resulting buffer contains float32LE values suitable for sherpa-onnx.
 */
function wavToFloat32Samples(wavBuffer) {
  if (!isWavFormat(wavBuffer)) {
    throw new Error("Buffer is not a valid WAV file");
  }

  // Parse WAV header to find data chunk
  let offset = 12; // Skip RIFF header (4) + size (4) + WAVE (4)
  let dataOffset = -1;
  let dataSize = 0;
  let bitsPerSample = 16;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset < 0) {
    throw new Error("WAV data chunk not found");
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / bytesPerSample);
  const float32 = Buffer.alloc(numSamples * 4);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataOffset + i * bytesPerSample;
    const intVal =
      bitsPerSample === 16 ? wavBuffer.readInt16LE(sampleOffset) : wavBuffer.readInt8(sampleOffset);
    const maxVal = bitsPerSample === 16 ? 32768 : 128;
    float32.writeFloatLE(intVal / maxVal, i * 4);
  }

  return float32;
}

/**
 * Compute the RMS of a float32 PCM buffer.
 */
function computeFloat32RMS(float32Buffer) {
  const numSamples = float32Buffer.length / 4;
  if (numSamples === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    const val = float32Buffer.readFloatLE(i * 4);
    sumSquares += val * val;
  }

  return Math.sqrt(sumSquares / numSamples);
}

module.exports = {
  isWavFormat,
  wavToFloat32Samples,
  computeFloat32RMS,
};
