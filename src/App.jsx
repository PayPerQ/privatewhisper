import React, { useState, useEffect, useRef, useMemo } from "react";
import { X } from "lucide-react";
import "./index.css";
import { useToast } from "./components/ui/Toast";
import { LoadingDots } from "./components/ui/LoadingDots";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useSettings } from "./hooks/useSettings";
import AudioManager from "./helpers/audioManager";
import createDebugLogger from "./utils/debugLoggerRenderer";

const MIN_HOLD_DURATION_MS = 200;
const pipelineLogger = createDebugLogger("pipeline");
const BUILT_IN_MIC_LABEL =
  /built[- ]?in|internal|macbook|imac|mac mini|mac studio|mac pro/i;
const BUILT_IN_MIC_STORAGE_KEY = "builtInMicDeviceId";
const builtInMicCache = {
  deviceId: "",
  valid: false,
};
let builtInMicListenerRegistered = false;

const loadBuiltInMicCacheFromStorage = () => {
  if (builtInMicCache.valid || builtInMicCache.deviceId) {
    return;
  }
  try {
    const storedDeviceId = localStorage.getItem(BUILT_IN_MIC_STORAGE_KEY);
    if (storedDeviceId) {
      builtInMicCache.deviceId = storedDeviceId;
      builtInMicCache.valid = true;
    }
  } catch {}
};

const persistBuiltInMicCache = () => {
  if (!builtInMicCache.deviceId) return;
  try {
    localStorage.setItem(BUILT_IN_MIC_STORAGE_KEY, builtInMicCache.deviceId);
  } catch {}
};

const clearBuiltInMicStorage = () => {
  try {
    localStorage.removeItem(BUILT_IN_MIC_STORAGE_KEY);
  } catch {}
};

const invalidateBuiltInMicCache = ({ clearStorage = false } = {}) => {
  builtInMicCache.deviceId = "";
  builtInMicCache.valid = false;
  if (clearStorage) {
    clearBuiltInMicStorage();
  }
};

const registerBuiltInMicCacheListener = () => {
  if (builtInMicListenerRegistered) return;
  if (!navigator.mediaDevices?.addEventListener) return;
  navigator.mediaDevices.addEventListener("devicechange", () => {
    invalidateBuiltInMicCache();
  });
  builtInMicListenerRegistered = true;
};

/**
 * Audio constraints optimized for dictation.
 * Disabling echo cancellation, noise suppression, and auto gain control
 * can help prevent Bluetooth profile switching on some devices,
 * and gives us more control over the raw audio.
 */
const DICTATION_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  // Prefer 16kHz sample rate to match transcription service
  sampleRate: { ideal: 16000 },
  channelCount: { ideal: 1 },
};

/**
 * Get audio stream with fallback for device compatibility.
 * Tries strict constraints first for quality, falls back to basic if device can't comply.
 */
async function getUserMediaWithFallback(constraints) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (e) {
    console.warn("[Audio] Strict constraints failed, trying basic:", e.message);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function getBuiltInMicrophoneStream() {
  registerBuiltInMicCacheListener();
  loadBuiltInMicCacheFromStorage();

  if (builtInMicCache.valid && builtInMicCache.deviceId) {
    try {
      return await getUserMediaWithFallback({
        deviceId: { exact: builtInMicCache.deviceId },
        ...DICTATION_AUDIO_CONSTRAINTS,
      });
    } catch {
      invalidateBuiltInMicCache({ clearStorage: true });
    }
  }

  const initialStream = await getUserMediaWithFallback(
    DICTATION_AUDIO_CONSTRAINTS,
  );

  if (!navigator.mediaDevices?.enumerateDevices) {
    return initialStream;
  }

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return initialStream;
  }

  const builtInDevice = devices.find(
    (device) =>
      device.kind === "audioinput" && BUILT_IN_MIC_LABEL.test(device.label),
  );

  if (!builtInDevice?.deviceId) {
    return initialStream;
  }

  builtInMicCache.deviceId = builtInDevice.deviceId;
  builtInMicCache.valid = true;
  persistBuiltInMicCache();

  const currentTrack = initialStream.getAudioTracks()[0];
  const currentDeviceId = currentTrack?.getSettings?.().deviceId;
  if (currentDeviceId && currentDeviceId === builtInDevice.deviceId) {
    return initialStream;
  }
  if (currentTrack?.label && currentTrack.label === builtInDevice.label) {
    return initialStream;
  }

  try {
    const builtInStream = await getUserMediaWithFallback({
      deviceId: { exact: builtInDevice.deviceId },
      ...DICTATION_AUDIO_CONSTRAINTS,
    });
    initialStream.getTracks().forEach((track) => track.stop());
    return builtInStream;
  } catch {
    return initialStream;
  }
}

async function getPreferredMicrophoneStream({
  alwaysUseBuiltInMic,
  preferredMicrophoneId,
}) {
  // Using built-in mic avoids Bluetooth profile switch entirely
  // (music keeps playing in high-quality A2DP while recording uses built-in mic)
  if (alwaysUseBuiltInMic) {
    return getBuiltInMicrophoneStream();
  }

  if (preferredMicrophoneId) {
    try {
      return await getUserMediaWithFallback({
        deviceId: { exact: preferredMicrophoneId },
        ...DICTATION_AUDIO_CONSTRAINTS,
      });
    } catch {
      // Fallback without exact device constraint
      return getUserMediaWithFallback(DICTATION_AUDIO_CONSTRAINTS);
    }
  }

  return getUserMediaWithFallback(DICTATION_AUDIO_CONSTRAINTS);
}

const scheduleBackgroundTask = (task) => {
  if (typeof window !== "undefined" && window.requestIdleCallback) {
    window.requestIdleCallback(() => task(), { timeout: 1500 });
  } else {
    setTimeout(task, 0);
  }
};

// Sound Wave Icon Component (for idle/hover states)
const SoundWaveIcon = ({ size = 16 }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size }}
      ></div>
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
    </div>
  );
};

// Voice Wave Animation Component (for processing state)
const VoiceWaveIndicator = ({ isListening }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-all duration-150 ${
            isListening ? "animate-pulse h-4" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
};

// Enhanced Tooltip Component
const Tooltip = ({ children, content, emoji }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible && (
        <div
          className="absolute bottom-full right-0 mb-2 px-2 py-1 text-white bg-gradient-to-r from-neutral-800 to-neutral-700 rounded-md z-10 transition-opacity duration-150 text-center"
          style={{ fontSize: "9.7px", maxWidth: "180px" }}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div className="absolute top-full right-4 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-neutral-800"></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false); // Optimistic UI: show animation while connecting
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isStreamingMode, setIsStreamingMode] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioManagerRef = useRef(null);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast } = useToast();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();
  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const hotkeyPressStartRef = useRef(null);
  const cancelRecordingRef = useRef(false);
  const pendingStartRef = useRef(false);
  const audioContextRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const lastAudioDurationMsRef = useRef(null);
  const cachedStreamRef = useRef(null);
  const streamCacheTimerRef = useRef(null);
  const [shouldShowIconDelayed, setShouldShowIconDelayed] = useState(false);
  const showIconTimeoutRef = useRef(null);
  const {
    preferredLanguage,
    dictationKey,
    hotkeyMode: rawHotkeyMode,
    setHotkeyMode,
    audioCuesEnabled,
    alwaysUseBuiltInMic,
    preferredMicrophoneId,
    showIconOnlyWhenActive,
  } = useSettings();

  // Hold-to-talk only works on macOS (requires native key-up detection)
  const isMacOS = window.electronAPI?.getPlatform?.() === "darwin";
  const hotkeyMode = isMacOS ? rawHotkeyMode : "toggle";

  // Update globe key listener mode when hotkey or mode changes (macOS only)
  // This ensures the native listener suppresses the correct key to prevent default system actions
  // (e.g., backtick triggering the emoji picker)
  useEffect(() => {
    if (!isMacOS) return;
    window.electronAPI?.updateGlobeListenerMode?.(dictationKey, hotkeyMode);
  }, [isMacOS, dictationKey, hotkeyMode]);

  // Listen for hotkey mode changes from other windows (e.g., Settings)
  useEffect(() => {
    if (!window.electronAPI?.onHotkeyModeChanged) return;
    const unsubscribe = window.electronAPI.onHotkeyModeChanged((newMode) => {
      setHotkeyMode(newMode);
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [setHotkeyMode]);

  const audioSettings = useMemo(
    () => ({
      preferredLanguage,
    }),
    [preferredLanguage],
  );

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    if (isCommandMenuOpen) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, setWindowInteractivity]);

  // Monitor for audio device changes (Bluetooth connect/disconnect, etc.)
  // This helps handle AirPods disconnection gracefully during recording
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = async () => {
      // If we're currently recording and the device changes, the track will end
      // The track 'ended' event handler in pcmAudioCapture will handle this
      // Here we just invalidate the built-in mic cache so next recording uses correct device
      invalidateBuiltInMicCache();
      releaseCachedStream();

      // Log device change for debugging Bluetooth issues
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        console.log(
          "[Audio] Device change detected. Available inputs:",
          audioInputs.map((d) => d.label || d.deviceId).join(", "),
        );
      } catch {
        // Enumeration may fail if permissions not granted
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, []);

  // --- Mic stream caching for faster recording start ---
  const STREAM_CACHE_TTL_MS = 30000; // release cached stream after 30s of inactivity

  // Release cached stream on unmount to avoid leaking mic access
  useEffect(() => {
    return () => {
      if (streamCacheTimerRef.current) {
        clearTimeout(streamCacheTimerRef.current);
        streamCacheTimerRef.current = null;
      }
      if (cachedStreamRef.current) {
        cachedStreamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* already stopped */
          }
        });
        cachedStreamRef.current = null;
      }
    };
  }, []);

  const releaseCachedStream = () => {
    if (streamCacheTimerRef.current) {
      clearTimeout(streamCacheTimerRef.current);
      streamCacheTimerRef.current = null;
    }
    if (cachedStreamRef.current) {
      cachedStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
      cachedStreamRef.current = null;
    }
  };

  const cacheStream = (stream) => {
    // Replace any previous cached stream
    if (cachedStreamRef.current && cachedStreamRef.current !== stream) {
      cachedStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
    }
    cachedStreamRef.current = stream;

    // Auto-release after TTL
    if (streamCacheTimerRef.current) clearTimeout(streamCacheTimerRef.current);
    streamCacheTimerRef.current = setTimeout(
      releaseCachedStream,
      STREAM_CACHE_TTL_MS,
    );
  };

  const getCachedOrNewStream = async () => {
    // Check if cached stream is still alive
    if (cachedStreamRef.current) {
      const tracks = cachedStreamRef.current.getAudioTracks();
      const allAlive =
        tracks.length > 0 && tracks.every((t) => t.readyState === "live");
      if (allAlive) {
        // Reset the cache TTL timer
        if (streamCacheTimerRef.current)
          clearTimeout(streamCacheTimerRef.current);
        streamCacheTimerRef.current = setTimeout(
          releaseCachedStream,
          STREAM_CACHE_TTL_MS,
        );
        return cachedStreamRef.current;
      }
      // Cached stream is dead, release it
      releaseCachedStream();
    }
    // Acquire a new stream
    return getPreferredMicrophoneStream({
      alwaysUseBuiltInMic,
      preferredMicrophoneId,
    });
  };

  const startRecording = async () => {
    if (
      pendingStartRef.current ||
      isRecording ||
      isConnecting ||
      isProcessing
    ) {
      return false;
    }
    try {
      cancelRecordingRef.current = false;
      pendingStartRef.current = true;

      // OPTIMISTIC UI: Show animation immediately before async operations complete
      setIsConnecting(true);

      // Play audio cue BEFORE mic request - this ensures the cue plays through
      // the current audio output before any Bluetooth profile switch occurs.
      // Note: If using Bluetooth mic, the mic request below will cause a profile
      // switch from A2DP (high-quality stereo) to HFP (mono). To avoid interrupting
      // music playback, users should enable "Always use built-in microphone" in settings.
      void playCue("start");

      // Create AudioManager for this recording session
      const audioManager = new AudioManager(audioSettings);
      audioManagerRef.current = audioManager;

      audioManager.setCallbacks({
        onError: (error) => {
          toast({
            title: error.title,
            description: error.description,
            variant: "destructive",
          });
        },
        onInterimResult: (text) => {
          setInterimTranscript(text);
        },
        onStreamingStateChange: (_state) => {
          // Streaming state change handled by AudioManager
        },
        onTranscriptionComplete: async (result) => {
          const metrics = result.metrics;

          if (result.success && result.text) {
            // Paste immediately - don't wait for database save
            metrics?.mark?.("pasteStart");
            const pastePromise = audioManager.safePaste(result.text);
            void audioManager.saveTranscription(result.text);

            // Wait for paste to complete, but don't block on database save
            try {
              await pastePromise;
            } finally {
              metrics?.mark?.("pasteEnd");
            }
          }

          // Log metrics for both success and failure cases
          const summary = metrics?.buildSummary
            ? metrics.buildSummary(result.success ? "pasteEnd" : "start")
            : null;

          if (summary) {
            summary.textLength = result.text?.length ?? 0;
            summary.source = result.source;

            const requestStartedAtMs =
              metrics?.flags?.transcriptionRequestStartedAtEpochMs ||
              summary.startedAtEpochMs ||
              Date.now();
            const responseReceivedAtMs =
              metrics?.flags?.finalTextReadyAtMs || Date.now();
            const sttProcessingMs = metrics?.duration?.(
              "transcriptionRequestStart",
              "transcriptionTextReady",
            );
            const llmProcessingMs = summary.stages?.reasoningMs ?? null;
            const roundtripMs = Number.isFinite(responseReceivedAtMs)
              ? Math.max(0, responseReceivedAtMs - requestStartedAtMs)
              : null;
            const miscProcessingMs =
              roundtripMs == null
                ? null
                : Math.max(
                    0,
                    roundtripMs -
                      (sttProcessingMs ?? 0) -
                      (llmProcessingMs ?? 0),
                  );
            const reasoningUsed = Boolean(metrics?.flags?.reasoningUsed);
            const modelUsed = reasoningUsed
              ? metrics?.flags?.reasoningModel
              : metrics?.flags?.transcriptionModel;
            const providerUsed = reasoningUsed
              ? metrics?.flags?.reasoningProvider || "groq"
              : "ppq";
            const outputTokens = metrics?.flags?.reasoningOutputTokens ?? null;

            const logPayload = {
              request_started_at: new Date(requestStartedAtMs).toISOString(),
              response_received_at: new Date(
                responseReceivedAtMs,
              ).toISOString(),
              stt_processing_ms: sttProcessingMs ?? null,
              audio_duration_ms: lastAudioDurationMsRef.current ?? null,
              llm_processing_ms: llmProcessingMs ?? null,
              output_tokens: outputTokens,
              roundtrip_ms: roundtripMs,
              misc_processing_ms: miscProcessingMs,
              model_used: modelUsed ?? null,
              provider_used: providerUsed ?? null,
              error_message: metrics?.errorMessage ?? null,
            };

            void pipelineLogger.log("LOG_PAYLOAD", logPayload);

            if (window.electronAPI?.logPipelineMetrics) {
              scheduleBackgroundTask(() => {
                void window.electronAPI.logPipelineMetrics(logPayload);
              });
            }
          }

          setIsProcessing(false);
          setInterimTranscript("");
        },
      });

      // Use cached stream if available, otherwise acquire a new one
      const stream = await getCachedOrNewStream();

      // If user released before the stream was ready, abort quietly
      if (cancelRecordingRef.current) {
        cacheStream(stream);
        pendingStartRef.current = false;
        setIsConnecting(false);
        setIsRecording(false);
        audioManagerRef.current = null;
        return false;
      }

      // Start PCM capture in buffer mode immediately to capture audio while WebSocket connects
      // This ensures no audio is lost during the connection phase
      let streamingStarted = false;
      let pcmBufferingStarted = false;
      try {
        // Start buffering PCM audio immediately (before WebSocket is ready)
        await audioManager.startPCMCapture(stream, true /* bufferMode */);
        pcmBufferingStarted = true;

        // Now connect WebSocket (audio is being buffered in the meantime)
        await audioManager.startStreaming();

        // WebSocket is ready - transition from buffering to streaming
        // This flushes all buffered audio and switches to live streaming
        audioManager.transitionToStreaming();
        streamingStarted = true;
        setIsStreamingMode(true);
      } catch (streamingError) {
        void pipelineLogger.log("STREAMING_FALLBACK_TO_BATCH", {
          error: streamingError.message,
        });
        // Clear buffer and fall back to batch mode
        if (pcmBufferingStarted) {
          audioManager.clearPCMBuffer();
          audioManager.stopPCMCapture();
        }
        setIsStreamingMode(false);
      }

      mediaRecorderRef.current = new window.MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      audioChunksRef.current = [];
      let didStart = false;

      mediaRecorderRef.current.onstart = () => {
        if (cancelRecordingRef.current) {
          mediaRecorderRef.current?.stop();
          return;
        }
        if (!didStart) {
          didStart = true;
          recordingStartedAtRef.current = Date.now();
          // Transition from connecting to recording state
          setIsConnecting(false);
          setIsRecording(true);
          pendingStartRef.current = false;
          // Audio cue already played at start of startRecording()
        }
      };

      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          // In streaming mode, PCM capture handles audio directly from the stream.
          // We only accumulate chunks for batch mode fallback.
          if (!streamingStarted || !audioManagerRef.current?.isStreaming()) {
            // Batch mode: accumulate chunks
            audioChunksRef.current.push(event.data);
          }
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const wasCancelled = cancelRecordingRef.current;
        cancelRecordingRef.current = false;

        if (wasCancelled) {
          cacheStream(stream);
          if (audioManagerRef.current?.isStreaming()) {
            audioManagerRef.current.cancelStreaming();
          }
          audioManagerRef.current?.clearPCMBuffer();
          setIsProcessing(false);
          setIsConnecting(false);
          setIsStreamingMode(false);
          pendingStartRef.current = false;
          recordingStartedAtRef.current = null;
          lastAudioDurationMsRef.current = null;
          audioManagerRef.current = null;
          setInterimTranscript("");
          return;
        }

        setIsProcessing(true);
        void playCue("stop");
        const recordingDurationMs = recordingStartedAtRef.current
          ? Math.max(0, Date.now() - recordingStartedAtRef.current)
          : null;
        lastAudioDurationMsRef.current = recordingDurationMs;

        if (streamingStarted && audioManagerRef.current?.isStreaming()) {
          // Streaming mode: finalize and get result
          try {
            await audioManagerRef.current.stopStreaming();
            // onTranscriptionComplete callback handles the rest
          } catch (err) {
            toast({
              title: "Transcription Error",
              description: "Streaming transcription failed: " + err.message,
              variant: "destructive",
            });
            setIsProcessing(false);
          }
        } else {
          // Batch mode: process accumulated audio
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm",
          });
          processAudio(audioBlob);
        }

        // Cache the stream for faster start on next recording instead of releasing it
        cacheStream(stream);
        setIsStreamingMode(false);
        audioManagerRef.current = null;
      };

      // Start MediaRecorder - in streaming mode PCM capture handles audio directly,
      // but we still need MediaRecorder for its lifecycle events (onstart/onstop)
      // and batch mode fallback
      mediaRecorderRef.current.start();
    } catch (err) {
      console.error("Recording error:", err);
      toast({
        title: "Recording Error",
        description: "Failed to access microphone: " + err.message,
        variant: "destructive",
      });
      pendingStartRef.current = false;
      setIsConnecting(false);
      audioManagerRef.current = null;
      setIsStreamingMode(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isConnecting)) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsConnecting(false);
      // Don't set processing immediately - let the onstop handler do it
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isConnecting)) {
      cancelRecordingRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsConnecting(false);
      setIsPushToTalk(false);
      return true;
    }
    return false;
  };

  const processAudio = async (audioBlob) => {
    // Use the audioManager from startRecording if available (batch mode fallback)
    const audioManager = audioManagerRef.current;
    if (!audioManager) {
      // This shouldn't happen, but handle gracefully
      toast({
        title: "Transcription Error",
        description: "Audio manager not initialized",
        variant: "destructive",
      });
      setIsProcessing(false);
      return;
    }

    try {
      // Process the audio using the pre-configured AudioManager
      // Callbacks were already set up in startRecording
      await audioManager.processAudio(audioBlob);
    } catch (err) {
      toast({
        title: "Transcription Error",
        description: "Transcription failed: " + err.message,
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleToggle = () => {
      setIsCommandMenuOpen(false);

      if (pendingStartRef.current) {
        cancelRecordingRef.current = true;
        pendingStartRef.current = false;
        setIsConnecting(false);
        setIsRecording(false);
        return;
      }

      if (hotkeyMode === "hold") {
        if (!isRecording && !isConnecting && !isProcessing) {
          hotkeyPressStartRef.current = Date.now();
          cancelRecordingRef.current = false;
          startRecording();
          setIsPushToTalk(true);
        } else if (isRecording || isConnecting) {
          setIsPushToTalk(false);
          hotkeyPressStartRef.current = null;
          stopRecording();
        }
        return;
      }

      hotkeyPressStartRef.current = null;
      cancelRecordingRef.current = false;
      if (!isRecording && !isConnecting && !isProcessing) {
        startRecording();
      } else if (isRecording || isConnecting) {
        stopRecording();
      }
    };

    const unsubscribe = window.electronAPI.onToggleDictation(handleToggle);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [hotkeyMode, isRecording, isConnecting, isProcessing]);

  useEffect(() => {
    if (!window.electronAPI?.onDictationHotkeyUp) {
      return;
    }

    const handleRelease = () => {
      if (hotkeyMode !== "hold" || !isPushToTalk) return;

      const now = Date.now();
      const pressedAt = hotkeyPressStartRef.current;
      const heldDuration = pressedAt ? now - pressedAt : 0;
      const tooQuick = heldDuration < MIN_HOLD_DURATION_MS;
      const wasPendingStart = pendingStartRef.current;

      cancelRecordingRef.current = tooQuick || wasPendingStart;
      hotkeyPressStartRef.current = null;
      setIsPushToTalk(false);

      if (wasPendingStart) {
        // Stop immediately if we released before recording actually began
        setIsConnecting(false);
        setIsRecording(false);
        pendingStartRef.current = false;
        return;
      }

      if (isRecording || isConnecting) {
        stopRecording();
      }
    };

    const unsubscribe = window.electronAPI.onDictationHotkeyUp(handleRelease);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [hotkeyMode, isRecording, isConnecting, isPushToTalk]);

  const toggleListening = () => {
    setIsCommandMenuOpen(false);
    if (pendingStartRef.current) {
      cancelRecordingRef.current = true;
      pendingStartRef.current = false;
      setIsConnecting(false);
      setIsRecording(false);
      return;
    }
    if (!isRecording && !isConnecting && !isProcessing) {
      startRecording();
    } else if (isRecording || isConnecting) {
      stopRecording();
      setIsPushToTalk(false);
    }
  };

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    if (!isRecording && !isConnecting && !isProcessing) {
      setIsPushToTalk(false);
    }
  }, [isRecording, isConnecting, isProcessing]);

  // Handle delayed icon visibility when showIconOnlyWhenActive is enabled
  useEffect(() => {
    const isActive = isRecording || isConnecting || isProcessing;

    if (isActive) {
      // Show icon after 500ms delay
      showIconTimeoutRef.current = setTimeout(() => {
        setShouldShowIconDelayed(true);
      }, 300);
    } else {
      // Hide immediately when no longer active
      if (showIconTimeoutRef.current) {
        clearTimeout(showIconTimeoutRef.current);
        showIconTimeoutRef.current = null;
      }
      setShouldShowIconDelayed(false);
    }

    return () => {
      if (showIconTimeoutRef.current) {
        clearTimeout(showIconTimeoutRef.current);
        showIconTimeoutRef.current = null;
      }
    };
  }, [isRecording, isConnecting, isProcessing]);

  const playCue = React.useCallback(
    async (type) => {
      try {
        if (!audioCuesEnabled) return;
        const AudioContextClass =
          window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        if (
          !audioContextRef.current ||
          audioContextRef.current.state === "closed"
        ) {
          audioContextRef.current = new AudioContextClass();
        }

        const context = audioContextRef.current;
        if (context.state === "suspended") {
          await context.resume();
        }

        const isStart = type === "start";
        const now = context.currentTime + 0.01;
        const master = context.createGain();
        master.gain.setValueAtTime(0.9, now);
        master.connect(context.destination);

        const cue = isStart
          ? {
              gap: 0.09,
              bloops: [
                { startFreq: 560, endFreq: 430, peak: 0.18, duration: 0.14 },
                { startFreq: 720, endFreq: 520, peak: 0.2, duration: 0.16 },
              ],
            }
          : {
              gap: 0.12,
              bloops: [
                { startFreq: 480, endFreq: 340, peak: 0.16, duration: 0.16 },
                { startFreq: 360, endFreq: 260, peak: 0.15, duration: 0.18 },
              ],
            };

        const scheduleBloop = ({
          startFreq,
          endFreq,
          peak,
          duration,
          time,
        }) => {
          const osc = context.createOscillator();
          const gain = context.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(startFreq, time);
          osc.frequency.exponentialRampToValueAtTime(
            endFreq,
            time + duration * 0.85,
          );

          gain.gain.setValueAtTime(0.0001, time);
          gain.gain.exponentialRampToValueAtTime(peak, time + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

          osc.connect(gain);
          gain.connect(master);
          osc.start(time);
          osc.stop(time + duration + 0.04);
        };

        cue.bloops.forEach((bloop, index) => {
          scheduleBloop({
            ...bloop,
            time: now + index * cue.gap,
          });
        });
      } catch (error) {
        console.debug("Audio cue failed:", error);
      }
    },
    [audioCuesEnabled],
  );

  const getMicState = () => {
    if (isConnecting) return "connecting";
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered) return "hover";
    return "idle";
  };

  const micState = getMicState();
  const hotkeyTooltip =
    hotkeyMode === "hold"
      ? `Hold [${hotkey}] while you speak`
      : `Press [${hotkey}] to speak`;

  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-10 h-10 flex items-center justify-center relative overflow-hidden border-2 border-white/70";
    const isActive =
      micState === "connecting" ||
      micState === "recording" ||
      micState === "processing";

    return {
      className: `${baseClasses} ${isActive ? "bg-primary" : "bg-black/50"}`,
      tooltip: isActive
        ? micState === "connecting"
          ? "Connecting..."
          : micState === "recording"
            ? "Recording..."
            : "Processing..."
        : hotkeyTooltip,
    };
  };

  const micProps = getMicButtonProps();

  // Determine if the icon should be visible
  const shouldShowIcon = !showIconOnlyWhenActive || shouldShowIconDelayed;

  return (
    <>
      {/* Fixed bottom-right voice button */}
      {shouldShowIcon && (
        <div className="fixed bottom-6 right-6 z-50">
          <div
            className="relative flex items-center gap-2"
            onMouseEnter={() => {
              setIsHovered(true);
              setWindowInteractivity(true);
            }}
            onMouseLeave={() => {
              setIsHovered(false);
              if (!isCommandMenuOpen) {
                setWindowInteractivity(false);
              }
            }}
          >
            {isRecording && isHovered && (
              <Tooltip content="Cancel recording">
                <button
                  aria-label="Cancel recording"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRecording();
                  }}
                  className="w-7 h-7 rounded-full bg-neutral-800/90 hover:bg-red-500 border border-white/20 hover:border-red-400 flex items-center justify-center transition-all duration-150 shadow-lg backdrop-blur-sm"
                >
                  <X size={12} strokeWidth={2.5} color="white" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={micProps.tooltip}>
              <button
                ref={buttonRef}
                onMouseDown={(e) => {
                  setIsCommandMenuOpen(false);
                  setDragStartPos({ x: e.clientX, y: e.clientY });
                  setHasDragged(false);
                  handleMouseDown(e);
                }}
                onMouseMove={(e) => {
                  if (dragStartPos && !hasDragged) {
                    const distance = Math.sqrt(
                      Math.pow(e.clientX - dragStartPos.x, 2) +
                        Math.pow(e.clientY - dragStartPos.y, 2),
                    );
                    if (distance > 5) {
                      // 5px threshold for drag
                      setHasDragged(true);
                    }
                  }
                }}
                onMouseUp={(e) => {
                  handleMouseUp(e);
                  setDragStartPos(null);
                }}
                onClick={(e) => {
                  if (!hasDragged) {
                    setIsCommandMenuOpen(false);
                    toggleListening();
                  }
                  e.preventDefault();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!hasDragged) {
                    setWindowInteractivity(true);
                    setIsCommandMenuOpen((prev) => !prev);
                  }
                }}
                className={micProps.className}
                style={{
                  cursor:
                    micState === "processing"
                      ? "not-allowed"
                      : isDragging
                        ? "grabbing"
                        : "pointer",
                  transition:
                    "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
                }}
              >
                {/* Background effects */}
                <div
                  className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
                  style={{ opacity: micState === "hover" ? 0.8 : 0 }}
                ></div>
                <div
                  className="absolute inset-0 transition-colors duration-150"
                  style={{
                    backgroundColor:
                      micState === "hover" ? "rgba(0,0,0,0.1)" : "transparent",
                  }}
                ></div>

                {/* Dynamic content based on state */}
                {micState === "idle" || micState === "hover" ? (
                  <SoundWaveIcon size={micState === "idle" ? 12 : 14} />
                ) : micState === "connecting" ? (
                  <div className="opacity-70">
                    <LoadingDots />
                  </div>
                ) : micState === "recording" ? (
                  <LoadingDots />
                ) : micState === "processing" ? (
                  <VoiceWaveIndicator isListening={true} />
                ) : null}

                {/* State indicator ring for recording */}
                {micState === "recording" && (
                  <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-pulse"></div>
                )}

                {/* State indicator ring for processing */}
                {micState === "processing" && (
                  <div className="absolute inset-0 rounded-full border-2 border-primary/30 opacity-50"></div>
                )}
              </button>
            </Tooltip>
            {isCommandMenuOpen && (
              <div
                ref={commandMenuRef}
                className="absolute bottom-full right-0 mb-3 w-48 rounded-lg border border-white/10 bg-neutral-900/95 text-white shadow-lg backdrop-blur-sm"
                onMouseEnter={() => {
                  setWindowInteractivity(true);
                }}
                onMouseLeave={() => {
                  if (!isHovered) {
                    setWindowInteractivity(false);
                  }
                }}
              >
                <button
                  className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                  onClick={() => {
                    toggleListening();
                  }}
                >
                  {isRecording ? "Stop listening" : "Start listening"}
                </button>
                <div className="h-px bg-white/10" />
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                  onClick={() => {
                    setIsCommandMenuOpen(false);
                    setWindowInteractivity(false);
                    handleClose();
                  }}
                >
                  Hide this for now
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
