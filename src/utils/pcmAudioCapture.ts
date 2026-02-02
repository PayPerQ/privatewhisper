import createDebugLogger from "./debugLoggerRenderer";
import { TARGET_SAMPLE_RATE, resample, float32ToInt16 } from "./audioUtils";
import { AUDIO_BUFFER_CONFIG } from "../config/constants";
import { acquireSharedAudioContext } from "./sharedAudioContext";

const debugLogger = createDebugLogger("pcm-capture");

/**
 * Callback for receiving PCM audio chunks
 */
type OnAudioChunk = (pcmData: ArrayBuffer) => void;

/**
 * PCM Audio Capture - captures raw PCM audio from microphone.
 * Uses ScriptProcessorNode (deprecated but widely supported) as fallback
 * for AudioWorklet which requires HTTPS/localhost.
 *
 * Features:
 * - Buffering mode for capturing audio before WebSocket is ready
 * - Pause/resume for graceful reconnection handling
 * - Stream replacement for device recovery
 * - Extended buffer limits for Bluetooth devices
 */
class PCMAudioCapture {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private outputNode: AudioNode | null = null;
  private outputElement: HTMLAudioElement | null = null;
  private stream: MediaStream | null = null;
  private onAudioChunk: OnAudioChunk | null = null;
  private isCapturing = false;
  private onTrackEnded: (() => void) | null = null;
  private usingSharedContext = false;
  private releaseSharedContext: (() => void) | null = null;

  // Buffering support for capturing audio before WebSocket is ready
  private audioBuffer: ArrayBuffer[] = [];
  private audioBufferSize = 0; // Track total buffer size for backpressure
  private isBuffering = false;
  private bufferStartTime: number | null = null;

  // Pause/resume support for reconnection handling
  private isPaused = false;
  private pauseStartTime: number | null = null;

  // Graceful stop support - wait for final buffer to flush
  private isStopping = false;
  private onStopComplete: (() => void) | null = null;
  private flushSource: AudioBufferSourceNode | null = null;
  private flushCallbacksRemaining = 0;

  // Track handlers for device recovery
  private trackEndedHandlers: Map<MediaStreamTrack, () => void> = new Map();

  /**
   * Set callback for when audio track ends (device disconnected, e.g., AirPods)
   */
  setOnTrackEnded(callback: () => void): void {
    this.onTrackEnded = callback;
  }

  /**
   * Register track ended handlers for all audio tracks in a stream.
   */
  private registerTrackEndedHandlers(stream: MediaStream): void {
    const tracks = stream.getAudioTracks();
    tracks.forEach((track) => {
      const handler = () => {
        void debugLogger.log("AUDIO_TRACK_ENDED", {
          trackId: track.id,
          label: track.label,
        });
        if (this.onTrackEnded) {
          this.onTrackEnded();
        }
      };
      track.addEventListener("ended", handler);
      this.trackEndedHandlers.set(track, handler);
    });
  }

  /**
   * Remove track ended handlers from previous stream.
   */
  private unregisterTrackEndedHandlers(): void {
    this.trackEndedHandlers.forEach((handler, track) => {
      track.removeEventListener("ended", handler);
    });
    this.trackEndedHandlers.clear();
  }

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
    this.isPaused = false;
    this.pauseStartTime = null;

    // Monitor for device disconnection (important for Bluetooth devices like AirPods)
    this.registerTrackEndedHandlers(stream);

    try {
      // Create AudioContext at target sample rate
      const shared = await acquireSharedAudioContext();
      this.audioContext = shared.context;
      this.releaseSharedContext = shared.release;
      this.usingSharedContext = true;

      // Verify AudioContext is actually running - critical for subsequent recordings
      // where the context may have been suspended between uses
      if (this.audioContext.state !== "running") {
        void debugLogger.log("PCM_CONTEXT_NOT_RUNNING_AT_START", {
          state: this.audioContext.state,
        });
        throw new Error(`AudioContext not running: ${this.audioContext.state}`);
      }

      // If browser created context at different rate, we'll need to resample
      const actualSampleRate = this.audioContext.sampleRate;

      // Create source from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Create ScriptProcessorNode for audio processing
      // Note: ScriptProcessorNode is deprecated but AudioWorklet requires HTTPS
      this.processorNode = this.audioContext.createScriptProcessor(
        AUDIO_BUFFER_CONFIG.BUFFER_SIZE_SAMPLES,
        1, // mono input
        1, // mono output
      );

      // Track first audio callback for debugging
      let audioCallbackCount = 0;

      // Process audio data
      this.processorNode.onaudioprocess = (event) => {
        // Continue processing during graceful stop to flush final buffer
        if (!this.isCapturing && !this.isStopping) return;

        // Log first few callbacks for debugging
        audioCallbackCount++;
        if (audioCallbackCount <= 3) {
          void debugLogger.log("PCM_ONAUDIOPROCESS", {
            callbackNumber: audioCallbackCount,
            isBuffering: this.isBuffering,
            isPaused: this.isPaused,
            hasCallback: !!this.onAudioChunk,
            inputLength: event.inputBuffer.getChannelData(0).length,
          });
        }

        const inputData = event.inputBuffer.getChannelData(0);

        // Resample if needed
        const outputData =
          actualSampleRate !== TARGET_SAMPLE_RATE
            ? resample(inputData, actualSampleRate, TARGET_SAMPLE_RATE)
            : inputData;

        // Convert Float32 to Int16 (linear16)
        const pcmBuffer = float32ToInt16(outputData);

        // If paused or buffering, store in buffer
        if (this.isPaused || this.isBuffering) {
          const elapsed = Date.now() - (this.bufferStartTime || Date.now());
          // Drop new audio if buffer limits exceeded (prevents memory issues)
          if (
            elapsed < AUDIO_BUFFER_CONFIG.MAX_BUFFER_DURATION_MS &&
            this.audioBufferSize < AUDIO_BUFFER_CONFIG.MAX_BUFFER_SIZE_BYTES
          ) {
            // Clone the buffer since it may be reused
            const clonedBuffer = pcmBuffer.slice(0);
            this.audioBuffer.push(clonedBuffer);
            this.audioBufferSize += clonedBuffer.byteLength;
          } else if (
            this.audioBufferSize >= AUDIO_BUFFER_CONFIG.MAX_BUFFER_SIZE_BYTES
          ) {
            void debugLogger.log("PCM_BUFFER_SIZE_LIMIT_REACHED", {
              bufferSize: this.audioBufferSize,
              maxSize: AUDIO_BUFFER_CONFIG.MAX_BUFFER_SIZE_BYTES,
              isPaused: this.isPaused,
              isBuffering: this.isBuffering,
            });
          } else {
            void debugLogger.log("PCM_BUFFER_DURATION_LIMIT_REACHED", {
              elapsed,
              maxDuration: AUDIO_BUFFER_CONFIG.MAX_BUFFER_DURATION_MS,
              isPaused: this.isPaused,
              isBuffering: this.isBuffering,
              hasOnAudioChunk: !!this.onAudioChunk,
            });
          }
        } else if (this.onAudioChunk) {
          // Log first callback invocation
          if (audioCallbackCount === 1) {
            void debugLogger.log("PCM_SENDING_TO_CALLBACK", {
              bufferSize: pcmBuffer.byteLength,
            });
          }
          this.onAudioChunk(pcmBuffer);
        } else if (audioCallbackCount === 1) {
          // Log if audio is being dropped (no buffer, no callback)
          void debugLogger.log("PCM_AUDIO_DROPPED_NO_HANDLER", {
            isPaused: this.isPaused,
            isBuffering: this.isBuffering,
            hasCallback: !!this.onAudioChunk,
          });
        }

        // If stopping, signal completion after processing this final chunk
        if (this.isStopping) {
          this.isStopping = false;
          this.isCapturing = false;
          if (this.onStopComplete) {
            this.onStopComplete();
            this.onStopComplete = null;
          }
        }
      };

      // Connect: source -> processor -> output (required for processor to work)
      this.sourceNode.connect(this.processorNode);
      // Use a MediaStreamDestination + muted Audio element to keep the graph pulled
      // without routing to hardware output (avoids Bluetooth interruptions).
      try {
        const streamDestination =
          this.audioContext.createMediaStreamDestination();
        this.outputNode = streamDestination;
        this.processorNode.connect(streamDestination);

        this.outputElement = new Audio();
        this.outputElement.muted = true;
        this.outputElement.autoplay = true;
        this.outputElement.playsInline = true;
        this.outputElement.srcObject = streamDestination.stream;
        this.outputElement.play().catch((error) => {
          void debugLogger.log("PCM_OUTPUT_ELEMENT_PLAY_FAILED", {
            error: error instanceof Error ? error.message : String(error),
          });

          // Fallback to silent destination connection so the graph remains active.
          const silentGain = this.audioContext?.createGain();
          if (!silentGain) return;
          silentGain.gain.value = 0;
          this.outputNode = silentGain;
          try {
            this.processorNode?.disconnect();
          } catch {
            /* already disconnected */
          }
          this.processorNode?.connect(silentGain);
          silentGain.connect(this.audioContext!.destination);
        });
      } catch (error) {
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0;
        this.outputNode = silentGain;
        this.processorNode.connect(silentGain);
        silentGain.connect(this.audioContext.destination);
        void debugLogger.log("PCM_OUTPUT_FALLBACK_TO_DESTINATION", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

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
   * Stop capturing audio immediately.
   */
  stop(): void {
    this.isCapturing = false;
    this.isStopping = false;
    this.onStopComplete = null;
    this.cleanup();
  }

  /**
   * Stop capturing audio gracefully, waiting for the current buffer to flush.
   * This ensures no audio is lost in the ScriptProcessorNode pipeline.
   *
   * Uses silence injection to force an event-driven flush:
   * 1. Disconnect real audio source
   * 2. Inject silence to push any remaining audio through the processor
   * 3. Wait for the onaudioprocess callback that contains the final audio
   *
   * Returns a promise that resolves when the final chunk has been processed.
   */
  async stopAndFlush(): Promise<void> {
    if (!this.isCapturing) {
      this.cleanup();
      return;
    }

    // Signal that we're stopping - onaudioprocess will process remaining chunks
    this.isStopping = true;

    // Inject silence to force-flush any remaining audio in the processor's buffer.
    // The ScriptProcessorNode only fires onaudioprocess when its buffer is full.
    // By injecting silence, we push any partial real audio through immediately.
    if (this.audioContext && this.processorNode && this.sourceNode) {
      try {
        // Disconnect the real audio source first
        this.sourceNode.disconnect();

        // Create a silent buffer (2x buffer size to ensure full flush)
        const silentBuffer = this.audioContext.createBuffer(
          1, // mono
          AUDIO_BUFFER_CONFIG.BUFFER_SIZE_SAMPLES * 2,
          this.audioContext.sampleRate,
        );
        // Buffer is already filled with zeros by default

        // Create and connect silent source to push the remaining audio through
        this.flushSource = this.audioContext.createBufferSource();
        this.flushSource.buffer = silentBuffer;
        this.flushSource.connect(this.processorNode);
        this.flushSource.start();

        void debugLogger.log("PCM_FLUSH_SILENCE_INJECTED");
      } catch (error) {
        void debugLogger.log("PCM_FLUSH_SILENCE_ERROR", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Wait for the onaudioprocess callback to fire with the flushed audio
    await new Promise<void>((resolve) => {
      this.onStopComplete = resolve;

      // Safety timeout in case onaudioprocess doesn't fire (e.g., audio context suspended)
      setTimeout(() => {
        if (this.isStopping) {
          void debugLogger.log("PCM_FLUSH_TIMEOUT");
          this.isStopping = false;
          this.isCapturing = false;
          this.onStopComplete = null;
          resolve();
        }
      }, 500); // Allow ~4 buffer cycles for audio pipeline flush
    });

    this.cleanup();
  }

  /**
   * Check if currently capturing.
   */
  isActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Pause audio streaming (continues buffering).
   * Use during WebSocket reconnection to prevent audio loss.
   */
  pause(): void {
    if (!this.isCapturing || this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.pauseStartTime = Date.now();

    // Start buffering if not already
    if (!this.isBuffering && !this.bufferStartTime) {
      this.bufferStartTime = Date.now();
    }

    void debugLogger.log("PCM_CAPTURE_PAUSED", {
      bufferSize: this.audioBufferSize,
      bufferedChunks: this.audioBuffer.length,
      isBuffering: this.isBuffering,
      bufferStartTime: this.bufferStartTime,
      caller: new Error().stack?.split("\n")[2]?.trim(),
    });
  }

  /**
   * Resume audio streaming after pause.
   * Returns buffered audio accumulated during pause for flushing.
   */
  resume(): ArrayBuffer[] {
    if (!this.isPaused) {
      return [];
    }

    const pauseDuration = this.pauseStartTime
      ? Date.now() - this.pauseStartTime
      : 0;

    const bufferedAudio = [...this.audioBuffer];
    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.isPaused = false;
    this.pauseStartTime = null;
    this.bufferStartTime = null;

    void debugLogger.log("PCM_CAPTURE_RESUMED", {
      pauseDurationMs: pauseDuration,
      bufferedChunks: bufferedAudio.length,
      isBufferingAfter: this.isBuffering,
      isPausedAfter: this.isPaused,
    });

    return bufferedAudio;
  }

  /**
   * Check if currently paused.
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Replace the audio stream with a new one (for device recovery).
   * Maintains the current AudioContext and processor, just swaps the source.
   */
  async replaceStream(newStream: MediaStream): Promise<void> {
    if (!this.isCapturing || !this.audioContext || !this.processorNode) {
      void debugLogger.log("REPLACE_STREAM_SKIPPED_NOT_CAPTURING");
      throw new Error("Cannot replace stream when not capturing");
    }

    void debugLogger.log("REPLACING_STREAM", {
      oldStreamId: this.stream?.id,
      newStreamId: newStream.id,
    });

    // Remove old track handlers
    this.unregisterTrackEndedHandlers();

    // Disconnect old source
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Create new source from new stream
    this.sourceNode = this.audioContext.createMediaStreamSource(newStream);
    this.sourceNode.connect(this.processorNode);

    // Update stream reference
    this.stream = newStream;

    // Register track handlers for new stream
    this.registerTrackEndedHandlers(newStream);

    void debugLogger.log("STREAM_REPLACED", {
      newStreamId: newStream.id,
      trackLabel: newStream.getAudioTracks()[0]?.label,
    });
  }

  /**
   * Start capturing audio into internal buffer (before WebSocket ready).
   * Audio will be stored until transitionToStreaming() is called.
   */
  async startBuffering(stream: MediaStream): Promise<void> {
    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.isBuffering = true;
    this.bufferStartTime = Date.now();

    // Start capture without a callback - audio goes to buffer
    await this.start(stream, () => {});

    void debugLogger.log("PCM_BUFFERING_STARTED", {
      bufferStartTime: this.bufferStartTime,
      isBuffering: this.isBuffering,
      isPaused: this.isPaused,
    });
  }

  /**
   * Transition from buffering to streaming mode.
   * Returns buffered audio and switches to direct streaming.
   */
  transitionToStreaming(onAudioChunk: OnAudioChunk): ArrayBuffer[] {
    const bufferedAudio = [...this.audioBuffer];
    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.isBuffering = false;
    this.onAudioChunk = onAudioChunk;

    void debugLogger.log("PCM_BUFFER_TRANSITION", {
      bufferedChunks: bufferedAudio.length,
      bufferDurationMs: this.bufferStartTime
        ? Date.now() - this.bufferStartTime
        : 0,
      isBufferingAfter: this.isBuffering,
      isPaused: this.isPaused,
      hasCallback: !!this.onAudioChunk,
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
    this.audioBufferSize = 0;
    this.isBuffering = false;
    this.bufferStartTime = null;
    this.isPaused = false;
    this.pauseStartTime = null;
  }

  /**
   * Check if currently in buffering mode.
   */
  isBufferingMode(): boolean {
    return this.isBuffering;
  }

  /**
   * Get buffer statistics for monitoring.
   */
  getBufferStats(): {
    chunkCount: number;
    sizeBytes: number;
    durationMs: number | null;
    isPaused: boolean;
    isBuffering: boolean;
  } {
    return {
      chunkCount: this.audioBuffer.length,
      sizeBytes: this.audioBufferSize,
      durationMs: this.bufferStartTime
        ? Date.now() - this.bufferStartTime
        : null,
      isPaused: this.isPaused,
      isBuffering: this.isBuffering,
    };
  }

  private cleanup(): void {
    void debugLogger.log("PCM_CLEANUP_CALLED", {
      hasProcessorNode: !!this.processorNode,
      hasSourceNode: !!this.sourceNode,
      hasAudioContext: !!this.audioContext,
      isCapturing: this.isCapturing,
      isBuffering: this.isBuffering,
    });

    // Remove track handlers
    this.unregisterTrackEndedHandlers();

    // Clean up flush source if it exists
    if (this.flushSource) {
      try {
        this.flushSource.stop();
        this.flushSource.disconnect();
      } catch {
        // May already be stopped/disconnected
      }
      this.flushSource = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.outputNode) {
      this.outputNode.disconnect();
      this.outputNode = null;
    }

    if (this.outputElement) {
      this.outputElement.pause();
      this.outputElement.srcObject = null;
      this.outputElement = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      if (this.usingSharedContext) {
        this.releaseSharedContext?.();
        this.releaseSharedContext = null;
      } else {
        void this.audioContext.close();
      }
      this.audioContext = null;
    }
    this.usingSharedContext = false;

    // Release our reference but don't stop the stream tracks here.
    // The caller (App.jsx) owns stream lifecycle and may want to cache
    // the stream for faster re-use on the next recording.
    this.stream = null;

    this.onAudioChunk = null;
    this.onTrackEnded = null;
    this.clearBuffer();
  }
}

export default PCMAudioCapture;
