import createDebugLogger from "./debugLoggerRenderer";
import { TARGET_SAMPLE_RATE, resample, float32ToInt16 } from "./audioUtils";

const debugLogger = createDebugLogger("pcm-capture");

/**
 * Buffer size for audio processing (2048 samples at 16kHz = 128ms)
 */
const BUFFER_SIZE = 2048;

/**
 * Maximum duration of audio to buffer before WebSocket is ready (5 seconds)
 */
const MAX_BUFFER_DURATION_MS = 5000;

/**
 * Callback for receiving PCM audio chunks
 */
type OnAudioChunk = (pcmData: ArrayBuffer) => void;

/**
 * PCM Audio Capture - captures raw PCM audio from microphone.
 * Uses ScriptProcessorNode (deprecated but widely supported) as fallback
 * for AudioWorklet which requires HTTPS/localhost.
 */
class PCMAudioCapture {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private onAudioChunk: OnAudioChunk | null = null;
  private isCapturing = false;

  // Buffering support for capturing audio before WebSocket is ready
  private audioBuffer: ArrayBuffer[] = [];
  private isBuffering = false;
  private bufferStartTime: number | null = null;

  /**
   * Start capturing PCM audio from the given media stream.
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

      // Create source from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Create ScriptProcessorNode for audio processing
      // Note: ScriptProcessorNode is deprecated but AudioWorklet requires HTTPS
      this.processorNode = this.audioContext.createScriptProcessor(
        BUFFER_SIZE,
        1, // mono input
        1, // mono output
      );

      // Process audio data
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Resample if needed
        const outputData =
          actualSampleRate !== TARGET_SAMPLE_RATE
            ? resample(inputData, actualSampleRate, TARGET_SAMPLE_RATE)
            : inputData;

        // Convert Float32 to Int16 (linear16)
        const pcmBuffer = float32ToInt16(outputData);

        // If buffering, store in buffer; otherwise send to callback
        if (this.isBuffering) {
          const elapsed = Date.now() - (this.bufferStartTime || Date.now());
          if (elapsed < MAX_BUFFER_DURATION_MS) {
            // Clone the buffer since it may be reused
            this.audioBuffer.push(pcmBuffer.slice(0));
          }
        } else if (this.onAudioChunk) {
          this.onAudioChunk(pcmBuffer);
        }
      };

      // Connect: source -> processor -> destination (required for processor to work)
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isCapturing = true;
    } catch (error) {
      void debugLogger.log("PCM_CAPTURE_START_ERROR", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop capturing audio.
   */
  stop(): void {
    this.isCapturing = false;
    this.cleanup();
  }

  /**
   * Check if currently capturing.
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Start capturing audio into internal buffer (before WebSocket ready).
   * Audio will be stored until transitionToStreaming() is called.
   */
  async startBuffering(stream: MediaStream): Promise<void> {
    this.audioBuffer = [];
    this.isBuffering = true;
    this.bufferStartTime = Date.now();

    // Start capture without a callback - audio goes to buffer
    await this.start(stream, () => {
      // This callback won't be used while buffering
    });

    void debugLogger.log("PCM_BUFFERING_STARTED");
  }

  /**
   * Transition from buffering to streaming mode.
   * Returns buffered audio and switches to direct streaming.
   */
  transitionToStreaming(onAudioChunk: OnAudioChunk): ArrayBuffer[] {
    const bufferedAudio = [...this.audioBuffer];
    this.audioBuffer = [];
    this.isBuffering = false;
    this.onAudioChunk = onAudioChunk;

    void debugLogger.log("PCM_BUFFER_TRANSITION", {
      bufferedChunks: bufferedAudio.length,
      bufferDurationMs: this.bufferStartTime
        ? Date.now() - this.bufferStartTime
        : 0,
    });

    this.bufferStartTime = null;
    return bufferedAudio;
  }

  /**
   * Get current buffer contents without transitioning.
   */
  getBufferedAudio(): ArrayBuffer[] {
    return [...this.audioBuffer];
  }

  /**
   * Clear the buffer and reset buffering state.
   */
  clearBuffer(): void {
    this.audioBuffer = [];
    this.isBuffering = false;
    this.bufferStartTime = null;
  }

  /**
   * Check if currently in buffering mode.
   */
  isBufferingMode(): boolean {
    return this.isBuffering;
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
    this.clearBuffer();
  }
}

export default PCMAudioCapture;
