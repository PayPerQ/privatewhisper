import ReasoningService from "../services/ReasoningService";
import StreamingTranscriptionService, {
  StreamingState,
} from "../services/StreamingTranscriptionService";
import { API_ENDPOINTS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";
import apiKeyManager from "../utils/ApiKeyManager";
import { AUDIO_CONFIG } from "../config/audio";
import { withRetry, createApiRetryStrategy } from "../utils/retry";
import PCMAudioCapture from "../utils/pcmAudioCapture";

const debugLogger = createDebugLogger("audio");
const nowMs = () =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

type PipelineMetricsFlags = Record<string, unknown>;

class PipelineMetrics {
  id: string;
  startedAt: number;
  startedAtEpochMs: number;
  marks: Record<string, number>;
  flags: PipelineMetricsFlags;
  errorMessage: string | null;

  constructor() {
    this.id = `dictation-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2)}`;
    this.startedAtEpochMs = Date.now();
    this.startedAt = nowMs();
    this.marks = { start: this.startedAt };
    this.flags = {};
    this.errorMessage = null;
  }

  setError(message: string) {
    if (!this.errorMessage) {
      this.errorMessage = message;
    }
  }

  mark(stage: string, details: PipelineMetricsFlags = {}) {
    this.marks[stage] = nowMs();
    if (details && Object.keys(details).length > 0) {
      const existing = this.flags[stage];
      const existingDetails =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      this.flags[stage] = {
        ...existingDetails,
        ...details,
      };
    }
  }

  setFlag(key: string, value: unknown) {
    this.flags[key] = value;
  }

  duration(from: string, to: string) {
    if (this.marks[from] == null || this.marks[to] == null) return null;
    return Math.max(0, Math.round(this.marks[to] - this.marks[from]));
  }

  buildSummary(finalStage = "pasteEnd") {
    const summary = {
      id: this.id,
      startedAtMs: this.startedAt,
      startedAtEpochMs: this.startedAtEpochMs,
      stages: {
        audioOptimizeMs: this.duration("optimizeStart", "optimizeEnd"),
        transcriptionRequestMs: this.duration(
          "transcriptionRequestStart",
          "transcriptionResponse",
        ),
        transcriptionDecodeMs: this.duration(
          "transcriptionResponse",
          "transcriptionTextReady",
        ),
        transcriptionTotalMs: this.duration("start", "transcriptionTextReady"),
        reasoningMs: this.flags.reasoningUsed
          ? this.duration("reasoningStart", "reasoningEnd")
          : null,
        pasteMs: this.duration("pasteStart", "pasteEnd"),
      },
      totals: {
        toTranscriptionMs: this.duration("start", "transcriptionTextReady"),
        toFinalTextMs:
          this.duration("start", "finalTextReady") ||
          this.duration("start", "transcriptionTextReady"),
        roundTripMs:
          finalStage && this.marks[finalStage] != null
            ? this.duration("start", finalStage)
            : null,
      },
      flags: {
        ...this.flags,
      },
    };

    return summary;
  }
}

type AudioSettings = {
  useReasoningModel: boolean;
  reasoningModel: string;
  preferredLanguage: string;
};

type AudioManagerCallbacks = {
  onError?: (error: { title: string; description: string }) => void;
  onTranscriptionComplete?: (result: {
    success: boolean;
    text?: string;
    source?: string;
    metrics?: PipelineMetrics | null;
  }) => void;
  onInterimResult?: (text: string) => void;
  onStreamingStateChange?: (state: StreamingState) => void;
};

const DEFAULT_SETTINGS: AudioSettings = {
  useReasoningModel: true,
  reasoningModel: "openai/gpt-oss-120b",
  preferredLanguage: "en",
};

class AudioManager {
  settings: AudioSettings;
  onError: AudioManagerCallbacks["onError"];
  onTranscriptionComplete: AudioManagerCallbacks["onTranscriptionComplete"];
  onInterimResult: AudioManagerCallbacks["onInterimResult"];
  onStreamingStateChange: AudioManagerCallbacks["onStreamingStateChange"];
  metrics: PipelineMetrics | null;
  private streamingMode: boolean;
  private pcmCapture: PCMAudioCapture | null;

  constructor(settings: Partial<AudioSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onInterimResult = null;
    this.onStreamingStateChange = null;
    this.metrics = null;
    this.streamingMode = false;
    this.pcmCapture = null;
  }

  updateSettings(settings: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  setCallbacks({
    onError,
    onTranscriptionComplete,
    onInterimResult,
    onStreamingStateChange,
  }: AudioManagerCallbacks) {
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
    this.onInterimResult = onInterimResult;
    this.onStreamingStateChange = onStreamingStateChange;
  }

  async processAudio(audioBlob: Blob) {
    try {
      this.metrics = new PipelineMetrics();
      const metrics = this.metrics;
      metrics.setFlag("preferredLanguage", this.settings.preferredLanguage);
      metrics.setFlag("reasoningModel", this.settings.reasoningModel);
      metrics.setFlag("useReasoningModel", this.settings.useReasoningModel);
      metrics.mark("audioReceived", {
        originalSizeBytes: audioBlob.size,
      });

      const result = await this.processWithPPQAPI(audioBlob);
      this.onTranscriptionComplete?.(result);
    } catch (error: any) {
      this.onError?.({
        title: "Transcription Error",
        description: `Transcription failed: ${error.message}`,
      });
      // Also call onTranscriptionComplete with failure so errors get logged
      this.onTranscriptionComplete?.({
        success: false,
        metrics: this.metrics,
      });
    }
  }

  static normalizeTranscription(text = "") {
    if (!text || typeof text !== "string") {
      return "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  static cleanTranscription(text: string) {
    const normalized = this.normalizeTranscription(text);
    if (!normalized) {
      return "";
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  static cleanTranscriptionForAPI(text: string) {
    return this.normalizeTranscription(text);
  }

  async getAPIKey() {
    return await apiKeyManager.getApiKey();
  }

  async optimizeAudio(audioBlob: Blob) {
    return new Promise<Blob>((resolve) => {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass) {
        resolve(audioBlob);
        return;
      }
      const audioContext = new AudioContextClass();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(
            arrayBuffer as ArrayBuffer,
          );

          const sampleRate = AUDIO_CONFIG.SAMPLE_RATE;
          const channels = AUDIO_CONFIG.MONO_CHANNELS;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(
            channels,
            length,
            sampleRate,
          );

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();

          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (_error) {
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer: AudioBuffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(
      AUDIO_CONFIG.WAV_HEADER_SIZE + length * AUDIO_CONFIG.BYTES_PER_SAMPLE,
    );
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = AUDIO_CONFIG.WAV_HEADER_SIZE;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async processWithReasoningModel(text: string) {
    const model = this.settings.reasoningModel;
    const metrics = this.metrics;

    void debugLogger.log("CALLING_REASONING_SERVICE", {
      model,
      textLength: text.length,
    });

    metrics?.mark("reasoningStart");
    metrics?.setFlag("reasoningEndpoint", API_ENDPOINTS.PPQ_CHAT);

    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model);
      const outputTokens = result.usage?.outputTokens ?? null;

      const processingTime = Date.now() - startTime;
      metrics?.mark("reasoningEnd");
      metrics?.setFlag("reasoningUsed", true);
      metrics?.setFlag("reasoningSuccess", true);
      metrics?.setFlag("reasoningProvider", result.provider);
      metrics?.setFlag("reasoningOutputTokens", outputTokens);
      metrics?.setFlag("reasoningResponseReceivedAtMs", Date.now());

      void debugLogger.log("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.text.length,
        outputTokens,
        success: true,
      });

      return result.text;
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      metrics?.mark("reasoningEnd");
      metrics?.setFlag("reasoningUsed", true);
      metrics?.setFlag("reasoningSuccess", false);
      metrics?.setError(`reasoning_failed: ${error.message}`);

      void debugLogger.log("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  async isReasoningAvailable() {
    const useReasoning = this.settings.useReasoningModel;

    if (!useReasoning) {
      void debugLogger.log("REASONING_DISABLED", { useReasoning });
      return false;
    }

    try {
      const isAvailable = await ReasoningService.isAvailable();

      void debugLogger.log("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      return isAvailable;
    } catch (error: any) {
      void debugLogger.log("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  async processTranscription(text: string, source: string) {
    const metrics = this.metrics;
    void debugLogger.log("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: text.length,
      textPreview: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString(),
    });

    const useReasoning = await this.isReasoningAvailable();
    const { reasoningModel } = this.settings;
    metrics?.setFlag("reasoningEligible", useReasoning);
    metrics?.setFlag("reasoningModel", reasoningModel);

    void debugLogger.log("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider: "ppq",
    });

    if (useReasoning) {
      try {
        const preparedText = AudioManager.cleanTranscriptionForAPI(text);

        void debugLogger.log("SENDING_TO_REASONING", {
          preparedTextLength: preparedText.length,
          model: reasoningModel,
        });

        const result = await this.processWithReasoningModel(preparedText);
        metrics?.mark("finalTextReady");
        metrics?.setFlag("finalTextReadyAtMs", Date.now());

        void debugLogger.log("REASONING_SUCCESS", {
          resultLength: result.length,
          resultPreview:
            result.substring(0, 100) + (result.length > 100 ? "..." : ""),
          processingTime: new Date().toISOString(),
        });

        return result;
      } catch (error: any) {
        void debugLogger.log("REASONING_FAILED", {
          source,
          error: error.message,
          stack: error.stack,
          fallbackToCleanup: true,
        });
      }
    }
    if (!useReasoning) {
      metrics?.setFlag("reasoningUsed", false);
      metrics?.setFlag("reasoningSuccess", false);
    }

    void debugLogger.log("USING_STANDARD_CLEANUP", {
      reason: useReasoning ? "Reasoning failed" : "Reasoning not enabled",
    });

    const cleaned = AudioManager.cleanTranscription(text);
    metrics?.mark("finalTextReady");
    metrics?.setFlag("finalTextReadyAtMs", Date.now());

    return cleaned;
  }

  async processWithPPQAPI(audioBlob: Blob) {
    const metrics = this.metrics;

    try {
      const optimizedAudioPromise = (async () => {
        metrics?.mark("optimizeStart");
        const optimized = await this.optimizeAudio(audioBlob);
        metrics?.mark("optimizeEnd");
        return optimized;
      })();

      const [apiKey, optimizedAudio] = await Promise.all([
        this.getAPIKey(),
        optimizedAudioPromise,
      ]);

      metrics?.setFlag("audioSizes", {
        originalBytes: audioBlob.size,
        optimizedBytes: optimizedAudio.size,
      });

      const formData = new FormData();
      formData.append("file", optimizedAudio, "audio.wav");
      formData.append("model", AUDIO_CONFIG.TRANSCRIPTION_MODEL);
      formData.append("response_format", "json");
      const { preferredLanguage } = this.settings;
      if (preferredLanguage && preferredLanguage !== "auto") {
        formData.append("language", preferredLanguage);
      }

      metrics?.setFlag("transcriptionModel", AUDIO_CONFIG.TRANSCRIPTION_MODEL);
      metrics?.setFlag(
        "transcriptionEndpoint",
        API_ENDPOINTS.PPQ_TRANSCRIPTION,
      );

      // Log all FormData entries for debugging
      const formDataEntries: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        formDataEntries[key] =
          value instanceof Blob
            ? `[Blob: ${value.size} bytes, type: ${value.type}]`
            : value;
      }

      void debugLogger.log("PPQ_TRANSCRIPTION_REQUEST", {
        endpoint: API_ENDPOINTS.PPQ_TRANSCRIPTION,
        model: AUDIO_CONFIG.TRANSCRIPTION_MODEL,
        language: preferredLanguage,
        audioBlobSize: audioBlob.size,
        optimizedAudioSize: optimizedAudio.size,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
        formDataEntries: formDataEntries,
      });

      const result = await withRetry(async () => {
        let response: Response;
        try {
          const requestHeaders = {
            Authorization: `Bearer ${apiKey}`,
          };

          void debugLogger.log("PPQ_TRANSCRIPTION_FETCH_START", {
            endpoint: API_ENDPOINTS.PPQ_TRANSCRIPTION,
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey.substring(0, 8)}...` },
          });

          metrics?.mark("transcriptionRequestStart");
          metrics?.setFlag("transcriptionRequestStartedAtEpochMs", Date.now());
          response = await fetch(API_ENDPOINTS.PPQ_TRANSCRIPTION, {
            method: "POST",
            headers: requestHeaders,
            body: formData,
          });
          metrics?.mark("transcriptionResponse");
        } catch (fetchError: any) {
          void debugLogger.log("PPQ_TRANSCRIPTION_FETCH_ERROR", {
            error: fetchError.message,
            errorType: fetchError.name,
            errorStack: fetchError.stack,
            endpoint: API_ENDPOINTS.PPQ_TRANSCRIPTION,
          });
          throw fetchError;
        }

        void debugLogger.log("PPQ_TRANSCRIPTION_RESPONSE", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (!response.ok) {
          const errorText = await response.text();
          void debugLogger.log("PPQ_TRANSCRIPTION_ERROR_RESPONSE", {
            status: response.status,
            errorText: errorText.substring(0, 500),
          });
          const error = new Error(`API Error: ${response.status} ${errorText}`);
          (error as Error & { response?: Response }).response = response;
          throw error;
        }

        return response.json();
      }, createApiRetryStrategy());
      metrics?.mark("transcriptionTextReady");
      metrics?.setFlag("transcriptionTextReadyAtMs", Date.now());

      void debugLogger.log("PPQ_TRANSCRIPTION_SUCCESS", {
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        textPreview: result.text ? result.text.substring(0, 100) : "no text",
      });

      if (result.text) {
        const text = await this.processTranscription(result.text, "ppq");
        const source = (await this.isReasoningAvailable())
          ? "ppq-reasoned"
          : "ppq";
        return { success: true, text, source, metrics };
      } else {
        throw new Error("No text transcribed");
      }
    } catch (error: any) {
      void debugLogger.log("TRANSCRIPTION_ERROR", {
        error: error.message,
        stack: error.stack,
      });
      metrics?.setError(`transcription_failed: ${error.message}`);
      throw error;
    }
  }

  // Streaming transcription methods
  async startStreaming(): Promise<void> {
    const apiKey = await this.getAPIKey();

    this.metrics = new PipelineMetrics();
    this.metrics.setFlag("preferredLanguage", this.settings.preferredLanguage);
    this.metrics.setFlag("reasoningModel", this.settings.reasoningModel);
    this.metrics.setFlag("useReasoningModel", this.settings.useReasoningModel);
    this.metrics.setFlag("mode", "streaming");
    this.metrics.mark("streamingStart");

    // Set up streaming service callbacks
    StreamingTranscriptionService.setCallbacks({
      onInterimResult: (text: string) => {
        this.onInterimResult?.(text);
      },
      onFinalResult: (_text: string) => {
        // Final result received - accumulated text will be processed when streaming stops
      },
      onError: (error: string) => {
        this.metrics?.setError(`streaming_error: ${error}`);
        this.onError?.({
          title: "Streaming Error",
          description: error,
        });
      },
      onStateChange: (state: StreamingState) => {
        this.onStreamingStateChange?.(state);
      },
      onSpeechStarted: () => {
        this.metrics?.mark("speechStarted");
      },
      onSpeechEnded: () => {
        this.metrics?.mark("speechEnded");
      },
    });

    // Set language for streaming
    StreamingTranscriptionService.setLanguage(this.settings.preferredLanguage);

    try {
      await StreamingTranscriptionService.connect(apiKey, "stt:ppq-voice");
      this.streamingMode = true;
      this.metrics.mark("streamingConnected");
    } catch (error: any) {
      this.metrics?.setError(`streaming_connect_failed: ${error.message}`);
      void debugLogger.log("STREAMING_CONNECT_ERROR", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Start capturing PCM audio directly from a media stream.
   * This bypasses MediaRecorder and captures raw PCM samples at 16kHz.
   * @param stream - The media stream to capture from
   * @param bufferMode - If true, buffer audio until transitionToStreaming() is called
   */
  async startPCMCapture(
    stream: MediaStream,
    bufferMode: boolean = false,
  ): Promise<void> {
    this.pcmCapture = new PCMAudioCapture();

    // Handle audio device disconnection (AirPods, Bluetooth, etc.)
    this.pcmCapture.setOnTrackEnded(() => {
      void debugLogger.log("AUDIO_DEVICE_DISCONNECTED");
      this.stopPCMCapture();
      this.onError?.({
        title: "Audio Device Disconnected",
        description: "Your microphone was disconnected.",
      });
      if (this.streamingMode) this.cancelStreaming();
    });

    try {
      if (bufferMode) {
        // Start buffering immediately - audio will be stored until WebSocket is ready
        await this.pcmCapture.startBuffering(stream);
        void debugLogger.log("PCM_CAPTURE_BUFFERING_STARTED");
      } else if (this.streamingMode) {
        await this.pcmCapture.start(stream, (pcmData: ArrayBuffer) => {
          // Send PCM data directly to the streaming service
          StreamingTranscriptionService.sendAudio(pcmData);
        });
        void debugLogger.log("PCM_CAPTURE_STREAMING_STARTED");
      } else {
        void debugLogger.log("PCM_CAPTURE_NOT_STREAMING");
        return;
      }
    } catch (error: any) {
      void debugLogger.log("PCM_CAPTURE_START_ERROR", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Transition PCM capture from buffering to streaming mode.
   * Flushes buffered audio to WebSocket and switches to live streaming.
   */
  transitionToStreaming(): void {
    if (!this.pcmCapture || !this.streamingMode) {
      void debugLogger.log("TRANSITION_TO_STREAMING_SKIPPED", {
        hasPcmCapture: !!this.pcmCapture,
        streamingMode: this.streamingMode,
      });
      return;
    }

    // Transition PCM capture to streaming mode and get buffered audio
    const bufferedChunks = this.pcmCapture.transitionToStreaming(
      (pcmData: ArrayBuffer) => {
        StreamingTranscriptionService.sendAudio(pcmData);
      },
    );

    // Flush all buffered audio to the streaming service
    this.flushBufferedAudio(bufferedChunks);
  }

  /**
   * Flush buffered audio chunks to the streaming service.
   */
  private flushBufferedAudio(bufferedChunks: ArrayBuffer[]): void {
    if (!this.streamingMode || bufferedChunks.length === 0) {
      return;
    }

    void debugLogger.log("FLUSHING_BUFFER", { chunks: bufferedChunks.length });

    for (const chunk of bufferedChunks) {
      StreamingTranscriptionService.sendAudio(chunk);
    }
  }

  clearPCMBuffer(): void {
    if (this.pcmCapture) {
      this.pcmCapture.clearBuffer();
    }
  }

  /**
   * Stop PCM audio capture.
   */
  stopPCMCapture(): void {
    if (this.pcmCapture) {
      this.pcmCapture.stop();
      this.pcmCapture = null;
    }
  }

  /**
   * Check if PCM capture is active.
   */
  isPCMCaptureActive(): boolean {
    return this.pcmCapture?.isActive() ?? false;
  }

  async stopStreaming(): Promise<string> {
    if (!this.streamingMode) {
      return "";
    }

    // Stop PCM capture first
    this.stopPCMCapture();

    this.metrics?.mark("streamingStopRequested");
    // Mark transcription request start - for streaming, this is when we stop sending audio
    this.metrics?.mark("transcriptionRequestStart");
    this.metrics?.setFlag("transcriptionRequestStartedAtEpochMs", Date.now());

    try {
      const finalText = await StreamingTranscriptionService.close();
      this.streamingMode = false;
      // Mark transcription text ready for STT processing time calculation
      this.metrics?.mark("transcriptionTextReady");
      this.metrics?.setFlag("transcriptionTextReadyAtMs", Date.now());
      this.metrics?.mark("streamingClosed");
      this.metrics?.setFlag("streamingAccumulatedLength", finalText.length);

      void debugLogger.log("STREAMING_STOPPED", {
        textLength: finalText.length,
        textPreview:
          finalText.substring(0, 100) + (finalText.length > 100 ? "..." : ""),
      });

      if (!finalText) {
        // Still notify completion even with empty text so UI state gets reset
        this.onTranscriptionComplete?.({
          success: true,
          text: "",
          source: "streaming",
          metrics: this.metrics,
        });
        return "";
      }

      // Process through reasoning model if enabled
      const processedText = await this.processTranscription(
        finalText,
        "streaming",
      );

      this.metrics?.mark("streamingComplete");

      // Notify completion
      const source = (await this.isReasoningAvailable())
        ? "streaming-reasoned"
        : "streaming";
      this.onTranscriptionComplete?.({
        success: true,
        text: processedText,
        source,
        metrics: this.metrics,
      });

      return processedText;
    } catch (error: any) {
      this.metrics?.setError(`streaming_stop_failed: ${error.message}`);
      this.streamingMode = false;

      void debugLogger.log("STREAMING_STOP_ERROR", {
        error: error.message,
        stack: error.stack,
      });

      this.onError?.({
        title: "Streaming Error",
        description: `Failed to complete streaming: ${error.message}`,
      });

      this.onTranscriptionComplete?.({
        success: false,
        metrics: this.metrics,
      });

      return "";
    }
  }

  isStreaming(): boolean {
    return this.streamingMode;
  }

  cancelStreaming(): void {
    if (this.streamingMode) {
      this.stopPCMCapture();
      StreamingTranscriptionService.disconnect();
      this.streamingMode = false;
      this.metrics?.setFlag("streamingCancelled", true);
      void debugLogger.log("STREAMING_CANCELLED");
    }
  }

  async safePaste(text: string) {
    const MAX_RETRIES = 3;
    const INITIAL_DELAY_MS = 200;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await window.electronAPI.pasteText(text);
        return true;
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES - 1;

        if (isLastAttempt) {
          void debugLogger.log("PASTE_FAILED_ALL_RETRIES", {
            attempts: MAX_RETRIES,
            error: error instanceof Error ? error.message : String(error),
          });
          this.onError?.({
            title: "Paste Error",
            description:
              "Failed to paste text. Please check accessibility permissions.",
          });
          return false;
        }

        // Exponential backoff: 200ms, 400ms, 800ms...
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
        void debugLogger.log("PASTE_RETRY", {
          attempt: attempt + 1,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  async saveTranscription(text: string) {
    try {
      await window.electronAPI.saveTranscription(text);
      return true;
    } catch (_error) {
      return false;
    }
  }

  cleanup() {
    this.stopPCMCapture();
    this.cancelStreaming();
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onInterimResult = null;
    this.onStreamingStateChange = null;
  }
}

export default AudioManager;
