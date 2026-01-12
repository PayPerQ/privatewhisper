/**
 * Shared audio processing utilities for PCM conversion and manipulation.
 * Used by both real-time PCM capture and batch audio conversion.
 */

/**
 * Target sample rate for streaming transcription (16kHz)
 */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Simple linear resampling with interpolation.
 * Converts audio data from one sample rate to another.
 *
 * @param data - Input audio samples as Float32Array
 * @param fromSampleRate - Source sample rate in Hz
 * @param toSampleRate - Target sample rate in Hz
 * @returns Resampled audio data as Float32Array
 */
export function resample(
  data: Float32Array,
  fromSampleRate: number,
  toSampleRate: number,
): Float32Array {
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
    const t = srcIndex - srcIndexFloor;

    result[i] = data[srcIndexFloor] * (1 - t) + data[srcIndexCeil] * t;
  }

  return result;
}

/**
 * Convert Float32 audio samples to Int16 (linear16 PCM).
 * Clamps values to [-1, 1] range before conversion.
 *
 * @param float32Array - Input audio samples as Float32Array
 * @returns PCM audio data as ArrayBuffer (Int16)
 */
export function float32ToInt16(float32Array: Float32Array): ArrayBuffer {
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
 * Mix stereo or multi-channel audio down to mono.
 *
 * @param audioBuffer - Web Audio API AudioBuffer with one or more channels
 * @returns Mono audio data as Float32Array
 */
export function mixDownToMono(audioBuffer: AudioBuffer): Float32Array {
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
