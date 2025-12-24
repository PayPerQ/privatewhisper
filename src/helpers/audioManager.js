import ReasoningService from "../services/ReasoningService";
import { API_ENDPOINTS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";
import apiKeyManager from "../utils/ApiKeyManager";
import { AppError, ErrorCodes } from "../utils/ErrorHandler";
import { AUDIO_CONFIG } from "../config/audio";
import { withRetry, createApiRetryStrategy } from "../utils/retry";

const debugLogger = createDebugLogger("audio");
const pipelineLogger = createDebugLogger("pipeline");

const nowMs = () =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

class PipelineMetrics {
  constructor() {
    this.id = `dictation-${Date.now().toString(36)}-${Math.random()
      .toString(16)
      .slice(2)}`;
    this.startedAt = nowMs();
    this.marks = { start: this.startedAt };
    this.flags = {};
  }

  mark(stage, details = {}) {
    this.marks[stage] = nowMs();
    if (details && Object.keys(details).length > 0) {
      this.flags[stage] = {
        ...(this.flags[stage] || {}),
        ...details,
      };
    }
  }

  setFlag(key, value) {
    this.flags[key] = value;
  }

  duration(from, to) {
    if (this.marks[from] == null || this.marks[to] == null) return null;
    return Math.max(0, Math.round(this.marks[to] - this.marks[from]));
  }

  buildSummary(finalStage = "pasteEnd") {
    const summary = {
      id: this.id,
      startedAtMs: this.startedAt,
      stages: {
        audioOptimizeMs: this.duration("optimizeStart", "optimizeEnd"),
        transcriptionRequestMs: this.duration(
          "transcriptionRequestStart",
          "transcriptionResponse"
        ),
        transcriptionDecodeMs: this.duration(
          "transcriptionResponse",
          "transcriptionTextReady"
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

const DEFAULT_SETTINGS = {
  useReasoningModel: true,
  reasoningModel: "qwen/qwen3-32b",
  preferredLanguage: "en",
};

class AudioManager {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.metrics = null;
  }

  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  setCallbacks({ onStateChange, onError, onTranscriptionComplete }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
  }

  async startRecording() {
    try {
      if (this.isRecording) {
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });


      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        this.isProcessing = true;
        this.onStateChange?.({ isRecording: false, isProcessing: true });

        const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });

        if (audioBlob.size === 0) {
          throw new AppError(
            ErrorCodes.AUDIO_EMPTY,
            "No audio was recorded",
            { blobSize: audioBlob.size }
          );
        }

        await this.processAudio(audioBlob);

        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      return true;
    } catch (error) {
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;
      
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = ErrorCodes.PERMISSION_DENIED;
        errorDescription = "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = ErrorCodes.MICROPHONE_NOT_FOUND;
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = ErrorCodes.MICROPHONE_IN_USE;
        errorDescription = "The microphone is being used by another application. Please close other apps and try again.";
      }
      
      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      return true;
    }
    return false;
  }

  async processAudio(audioBlob) {
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
    } catch (error) {
      this.onError?.({
        title: "Transcription Error",
        description: `Transcription failed: ${error.message}`,
      });
    } finally {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  static normalizeTranscription(text = "") {
    if (!text || typeof text !== "string") {
      return "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  static cleanTranscription(text) {
    const normalized = this.normalizeTranscription(text);
    if (!normalized) {
      return "";
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  static cleanTranscriptionForAPI(text) {
    return this.normalizeTranscription(text);
  }

  async getAPIKey() {
    return await apiKeyManager.getApiKey();
  }

  async optimizeAudio(audioBlob) {
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          const sampleRate = AUDIO_CONFIG.SAMPLE_RATE;
          const channels = AUDIO_CONFIG.MONO_CHANNELS;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(
            channels,
            length,
            sampleRate
          );

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();

          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (error) {
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(
      AUDIO_CONFIG.WAV_HEADER_SIZE + length * AUDIO_CONFIG.BYTES_PER_SAMPLE
    );
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
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
        true
      );
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async processWithReasoningModel(text) {
    const model = this.settings.reasoningModel;
    const metrics = this.metrics;

    void debugLogger.log("CALLING_REASONING_SERVICE", {
      model,
      textLength: text.length
    });

    metrics?.mark("reasoningStart");
    metrics?.setFlag("reasoningEndpoint", API_ENDPOINTS.PPQ_CHAT);

    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model);

      const processingTime = Date.now() - startTime;
      metrics?.mark("reasoningEnd");
      metrics?.setFlag("reasoningUsed", true);
      metrics?.setFlag("reasoningSuccess", true);

      void debugLogger.log("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      metrics?.mark("reasoningEnd");
      metrics?.setFlag("reasoningUsed", true);
      metrics?.setFlag("reasoningSuccess", false);

      void debugLogger.log("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack
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
        finalDecision: useReasoning && isAvailable
      });

      return isAvailable;
    } catch (error) {
      void debugLogger.log("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  async processTranscription(text, source) {
    const metrics = this.metrics;
    void debugLogger.log("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: text.length,
      textPreview: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString()
    });

    const useReasoning = await this.isReasoningAvailable();
    const { reasoningModel } = this.settings;
    metrics?.setFlag("reasoningEligible", useReasoning);
    metrics?.setFlag("reasoningModel", reasoningModel);

    void debugLogger.log("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider: "ppq"
    });

    if (useReasoning) {
      try {
        const preparedText = AudioManager.cleanTranscriptionForAPI(text);

        void debugLogger.log("SENDING_TO_REASONING", {
          preparedTextLength: preparedText.length,
          model: reasoningModel
        });
        
        const result = await this.processWithReasoningModel(preparedText);
        metrics?.mark("finalTextReady");
        
        void debugLogger.log("REASONING_SUCCESS", {
          resultLength: result.length,
          resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
          processingTime: new Date().toISOString()
        });
        
        return result;
      } catch (error) {
        void debugLogger.log("REASONING_FAILED", {
          source,
          error: error.message,
          stack: error.stack,
          fallbackToCleanup: true
        });
      }
    }
    if (!useReasoning) {
      metrics?.setFlag("reasoningUsed", false);
      metrics?.setFlag("reasoningSuccess", false);
    }

    void debugLogger.log("USING_STANDARD_CLEANUP", {
      reason: useReasoning ? "Reasoning failed" : "Reasoning not enabled"
    });

    const cleaned = AudioManager.cleanTranscription(text);
    metrics?.mark("finalTextReady");

    return cleaned;
  }

  async processWithPPQAPI(audioBlob) {
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
      metrics?.setFlag("transcriptionEndpoint", API_ENDPOINTS.PPQ_TRANSCRIPTION);

      // Log all FormData entries for debugging
      const formDataEntries = {};
      for (const [key, value] of formData.entries()) {
        formDataEntries[key] = value instanceof Blob
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
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : 'none',
        formDataEntries: formDataEntries
      });

      const result = await withRetry(
        async () => {
          let response;
          try {
            const requestHeaders = {
              Authorization: `Bearer ${apiKey}`,
            };

            void debugLogger.log("PPQ_TRANSCRIPTION_FETCH_START", {
              endpoint: API_ENDPOINTS.PPQ_TRANSCRIPTION,
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey.substring(0, 8)}...` }
            });

            metrics?.mark("transcriptionRequestStart");
            response = await fetch(API_ENDPOINTS.PPQ_TRANSCRIPTION, {
              method: "POST",
              headers: requestHeaders,
              body: formData,
            });
            metrics?.mark("transcriptionResponse");
          } catch (fetchError) {
            void debugLogger.log("PPQ_TRANSCRIPTION_FETCH_ERROR", {
              error: fetchError.message,
              errorType: fetchError.name,
              errorStack: fetchError.stack,
              endpoint: API_ENDPOINTS.PPQ_TRANSCRIPTION
            });
            throw fetchError;
          }

          void debugLogger.log("PPQ_TRANSCRIPTION_RESPONSE", {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries())
          });

          if (!response.ok) {
            const errorText = await response.text();
            void debugLogger.log("PPQ_TRANSCRIPTION_ERROR_RESPONSE", {
              status: response.status,
              errorText: errorText.substring(0, 500)
            });
            const error = new Error(`API Error: ${response.status} ${errorText}`);
            error.response = response;
            throw error;
          }

          return response.json();
        },
        createApiRetryStrategy()
      );
      metrics?.mark("transcriptionTextReady");

      void debugLogger.log("PPQ_TRANSCRIPTION_SUCCESS", {
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        textPreview: result.text ? result.text.substring(0, 100) : 'no text'
      });

      if (result.text) {
        const text = await this.processTranscription(result.text, "ppq");
        const source = await this.isReasoningAvailable() ? "ppq-reasoned" : "ppq";
        return { success: true, text, source, metrics };
      } else {
        throw new Error("No text transcribed");
      }
    } catch (error) {
      void debugLogger.log("TRANSCRIPTION_ERROR", {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async safePaste(text) {
    try {
      await window.electronAPI.pasteText(text);
      return true;
    } catch (error) {
      this.onError?.({
        title: "Paste Error",
        description: `Failed to paste text. Please check accessibility permissions. ${error.message}`,
      });
      return false;
    }
  }

  async saveTranscription(text) {
    try {
      await window.electronAPI.saveTranscription(text);
      return true;
    } catch (error) {
      return false;
    }
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
    };
  }

  cleanup() {
    if (this.mediaRecorder && this.isRecording) {
      this.stopRecording();
    }
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
  }
}

export default AudioManager;
