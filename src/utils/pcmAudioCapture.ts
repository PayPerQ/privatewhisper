import createDebugLogger from "./debugLoggerRenderer";

const debugLogger = createDebugLogger("pcm-capture");

/**
 * Target sample rate for Deepgram streaming (16kHz)
 */
const TARGET_SAMPLE_RATE = 16000;

/**
 * Buffer size for audio processing (2048 samples at 16kHz = 128ms)
 */
const BUFFER_SIZE = 2048;

/**
 * Callback for receiving PCM audio chunks
 */
type OnAudioChunk = (pcmData: ArrayBuffer) => void;

/**
 * PCM Audio Capture - captures raw PCM audio from microphone
 * Uses ScriptProcessorNode (deprecated but widely supported) as fallback
 * for AudioWorklet which requires HTTPS/localhost
 */
class PCMAudioCapture {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private onAudioChunk: OnAudioChunk | null = null;
  private isCapturing = false;

  /**
   * Start capturing PCM audio from the given media stream
   */
  async start(stream: MediaStream, onAudioChunk: OnAudioChunk): Promise<void> {
    if (this.isCapturing) {
      void debugLogger.log("ALREADY_CAPTURING");
      return;
    }

    this.stream = stream;
    this.onAudioChunk = onAudioChunk;

    try {
      // Create AudioContext at target sample rate
      this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

      // If browser created context at different rate, we'll need to resample
      const actualSampleRate = this.audioContext.sampleRate;

      void debugLogger.log("AUDIO_CONTEXT_CREATED", {
        requestedSampleRate: TARGET_SAMPLE_RATE,
        actualSampleRate,
      });

      // Create source from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Create ScriptProcessorNode for audio processing
      // Note: ScriptProcessorNode is deprecated but AudioWorklet requires HTTPS
      this.processorNode = this.audioContext.createScriptProcessor(
        BUFFER_SIZE,
        1, // mono input
        1  // mono output
      );

      // Process audio data
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing || !this.onAudioChunk) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Resample if needed
        const outputData = actualSampleRate !== TARGET_SAMPLE_RATE
          ? this.resample(inputData, actualSampleRate, TARGET_SAMPLE_RATE)
          : inputData;

        // Convert Float32 to Int16 (linear16)
        const pcmBuffer = this.float32ToInt16(outputData);

        this.onAudioChunk(pcmBuffer);
      };

      // Connect: source -> processor -> destination (required for processor to work)
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isCapturing = true;

      void debugLogger.log("PCM_CAPTURE_STARTED", {
        sampleRate: actualSampleRate,
        bufferSize: BUFFER_SIZE,
      });
    } catch (error) {
      void debugLogger.log("PCM_CAPTURE_START_ERROR", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    this.isCapturing = false;
    this.cleanup();
    void debugLogger.log("PCM_CAPTURE_STOPPED");
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  private cleanup(): void {
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.stream = null;
    this.onAudioChunk = null;
  }

  /**
   * Simple linear resampling
   */
  private resample(
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
  private float32ToInt16(float32Array: Float32Array): ArrayBuffer {
    const int16Array = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] range
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to Int16 range
      int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return int16Array.buffer;
  }
}

export default PCMAudioCapture;
