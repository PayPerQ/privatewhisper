import createDebugLogger from "./debugLoggerRenderer";

const debugLogger = createDebugLogger("audio-conversion");

/**
 * Target sample rate for Deepgram streaming (16kHz)
 */
const TARGET_SAMPLE_RATE = 16000;

/**
 * Converts audio data to linear16 PCM format suitable for Deepgram streaming.
 * Takes WebM/Opus audio chunks from MediaRecorder and converts to 16kHz mono PCM.
 *
 * @param webmData - ArrayBuffer containing WebM/Opus audio data
 * @returns Promise<ArrayBuffer> - Linear16 PCM audio data
 */
export async function convertToPCM(webmData: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

    // Decode the compressed audio
    const audioBuffer = await audioContext.decodeAudioData(webmData.slice(0));

    // Get mono channel (use first channel or mix down)
    const channelData =
      audioBuffer.numberOfChannels > 1
        ? mixDownToMono(audioBuffer)
        : audioBuffer.getChannelData(0);

    // Resample if needed
    const resampledData =
      audioBuffer.sampleRate !== TARGET_SAMPLE_RATE
        ? resample(channelData, audioBuffer.sampleRate, TARGET_SAMPLE_RATE)
        : channelData;

    // Convert Float32 to Int16 (linear16)
    const pcmData = float32ToInt16(resampledData);

    await audioContext.close();

    void debugLogger.log("PCM_CONVERSION_SUCCESS", {
      inputSize: webmData.byteLength,
      outputSize: pcmData.byteLength,
      inputSampleRate: audioBuffer.sampleRate,
      outputSampleRate: TARGET_SAMPLE_RATE,
    });

    return pcmData;
  } catch (error) {
    void debugLogger.log(
      "PCM_CONVERSION_ERROR",
      { error: error instanceof Error ? error.message : String(error) },
      "error"
    );
    throw error;
  }
}

/**
 * Mix stereo or multi-channel audio down to mono
 */
function mixDownToMono(audioBuffer: AudioBuffer): Float32Array {
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mixed = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let channel = 0; channel < numChannels; channel++) {
      sum += audioBuffer.getChannelData(channel)[i];
    }
    mixed[i] = sum / numChannels;
  }

  return mixed;
}

/**
 * Simple linear resampling
 */
function resample(
  data: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
): Float32Array {
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
    const t = srcIndex - srcIndexFloor;

    // Linear interpolation
    result[i] = data[srcIndexFloor] * (1 - t) + data[srcIndexCeil] * t;
  }

  return result;
}

/**
 * Convert Float32 audio samples to Int16 (linear16 PCM)
 */
function float32ToInt16(float32Array: Float32Array): ArrayBuffer {
  const int16Array = new Int16Array(float32Array.length);

  for (let i = 0; i < float32Array.length; i++) {
    // Clamp to [-1, 1] range
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    // Convert to Int16 range
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return int16Array.buffer;
}

/**
 * Creates a WAV header for PCM data (useful for debugging/playback)
 */
export function createWavHeader(
  pcmDataLength: number,
  sampleRate: number = TARGET_SAMPLE_RATE,
  numChannels: number = 1,
  bitsPerSample: number = 16
): ArrayBuffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmDataLength;
  const fileSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // "RIFF" chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize, true);
  writeString(view, 8, "WAVE");

  // "fmt " sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Combine WAV header with PCM data to create a playable WAV file
 */
export function createWavBlob(pcmData: ArrayBuffer): Blob {
  const header = createWavHeader(pcmData.byteLength);
  return new Blob([header, pcmData], { type: "audio/wav" });
}
