import createDebugLogger from "./debugLoggerRenderer";
import {
  TARGET_SAMPLE_RATE,
  resample,
  float32ToInt16,
  mixDownToMono,
} from "./audioUtils";

const debugLogger = createDebugLogger("audio-conversion");

/**
 * Converts audio data to linear16 PCM format suitable for streaming transcription.
 * Takes WebM/Opus audio chunks from MediaRecorder and converts to 16kHz mono PCM.
 *
 * @param webmData - ArrayBuffer containing WebM/Opus audio data
 * @returns Promise<ArrayBuffer> - Linear16 PCM audio data
 */
export async function convertToPCM(
  webmData: ArrayBuffer,
): Promise<ArrayBuffer> {
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
      "error",
    );
    throw error;
  }
}

/**
 * Helper to write a string into a DataView at a given offset.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Creates a WAV header for PCM data (useful for debugging/playback).
 *
 * @param pcmDataLength - Length of PCM data in bytes
 * @param sampleRate - Sample rate (default: 16000)
 * @param numChannels - Number of channels (default: 1)
 * @param bitsPerSample - Bits per sample (default: 16)
 * @returns WAV header as ArrayBuffer
 */
export function createWavHeader(
  pcmDataLength: number,
  sampleRate: number = TARGET_SAMPLE_RATE,
  numChannels: number = 1,
  bitsPerSample: number = 16,
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

/**
 * Combine WAV header with PCM data to create a playable WAV file.
 *
 * @param pcmData - Raw PCM audio data
 * @returns Blob containing a complete WAV file
 */
export function createWavBlob(pcmData: ArrayBuffer): Blob {
  const header = createWavHeader(pcmData.byteLength);
  return new Blob([header, pcmData], { type: "audio/wav" });
}
