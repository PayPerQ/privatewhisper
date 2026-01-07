import React, { useState, useEffect, useRef, useMemo } from "react";
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
const builtInMicCache = {
  deviceId: "",
  valid: false,
};
let builtInMicListenerRegistered = false;

const invalidateBuiltInMicCache = () => {
  builtInMicCache.deviceId = "";
  builtInMicCache.valid = false;
};

const registerBuiltInMicCacheListener = () => {
  if (builtInMicListenerRegistered) return;
  if (!navigator.mediaDevices?.addEventListener) return;
  navigator.mediaDevices.addEventListener("devicechange", () => {
    invalidateBuiltInMicCache();
  });
  builtInMicListenerRegistered = true;
};

async function getBuiltInMicrophoneStream() {
  registerBuiltInMicCacheListener();

  if (builtInMicCache.valid && builtInMicCache.deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: builtInMicCache.deviceId } },
      });
    } catch {
      invalidateBuiltInMicCache();
    }
  }

  const initialStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
  });

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

  const currentTrack = initialStream.getAudioTracks()[0];
  const currentDeviceId = currentTrack?.getSettings?.().deviceId;
  if (currentDeviceId && currentDeviceId === builtInDevice.deviceId) {
    return initialStream;
  }
  if (currentTrack?.label && currentTrack.label === builtInDevice.label) {
    return initialStream;
  }

  try {
    const builtInStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: builtInDevice.deviceId } },
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
  if (alwaysUseBuiltInMic) {
    return getBuiltInMicrophoneStream();
  }

  if (preferredMicrophoneId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: preferredMicrophoneId } },
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: true });
}

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
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-1 py-1 text-white bg-gradient-to-r from-neutral-800 to-neutral-700 rounded-md whitespace-nowrap z-10 transition-opacity duration-150"
          style={{ fontSize: "9.7px" }}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-neutral-800"></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
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
  const {
    preferredLanguage,
    hotkeyMode,
    audioCuesEnabled,
    alwaysUseBuiltInMic,
    preferredMicrophoneId,
  } = useSettings();

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

  const startRecording = async () => {
    if (pendingStartRef.current || isRecording || isProcessing) {
      return false;
    }
    try {
      cancelRecordingRef.current = false;
      pendingStartRef.current = true;
      const stream = await getPreferredMicrophoneStream({
        alwaysUseBuiltInMic,
        preferredMicrophoneId,
      });

      // If user released before the stream was ready, abort quietly
      if (cancelRecordingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        pendingStartRef.current = false;
        setIsRecording(false);
        return false;
      }

      mediaRecorderRef.current = new window.MediaRecorder(stream);
      audioChunksRef.current = [];
      let didStart = false;

      mediaRecorderRef.current.onstart = () => {
        if (cancelRecordingRef.current) {
          mediaRecorderRef.current?.stop();
          return;
        }
        if (!didStart) {
          didStart = true;
          setIsRecording(true);
          pendingStartRef.current = false;
          void playCue("start");
        }
      };

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const wasCancelled = cancelRecordingRef.current;
        cancelRecordingRef.current = false;

        if (wasCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          setIsProcessing(false);
          pendingStartRef.current = false;
          return;
        }

        setIsProcessing(true);
        void playCue("stop");
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/wav",
        });
        // Start processing immediately without waiting
        processAudio(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start();
    } catch (err) {
      console.error("Recording error:", err);
      toast({
        title: "Recording Error",
        description: "Failed to access microphone: " + err.message,
        variant: "destructive",
      });
      pendingStartRef.current = false;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Don't set processing immediately - let the onstop handler do it
    }
  };

  const processAudio = async (audioBlob) => {
    try {
      const audioManager = new AudioManager(audioSettings);
      audioManager.setCallbacks({
        onError: (error) => {
          toast({
            title: error.title,
            description: error.description,
            variant: "destructive",
          });
        },
        onTranscriptionComplete: async (result) => {
          if (result.success && result.text) {
            const metrics = result.metrics;

            // Paste immediately - don't wait for database save
            metrics?.mark?.("pasteStart");
            const pastePromise = audioManager.safePaste(result.text);
            void audioManager.saveTranscription(result.text);

            // Wait for paste to complete, but don't block on database save
            try {
              await pastePromise;
            } finally {
              metrics?.mark?.("pasteEnd");
              const summary = metrics?.buildSummary
                ? metrics.buildSummary("pasteEnd")
                : null;

              if (summary) {
                summary.textLength = result.text.length;
                summary.source = result.source;
                void pipelineLogger.log("PIPELINE_TIMING_SUMMARY", summary);
              }
            }
          }
        },
      });

      // Process the audio using our enhanced AudioManager
      await audioManager.processAudio(audioBlob);
    } catch (err) {
      toast({
        title: "Transcription Error",
        description: "Transcription failed: " + err.message,
        variant: "destructive",
      });
    } finally {
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
        setIsRecording(false);
        return;
      }

      if (hotkeyMode === "hold") {
        if (!isRecording && !isProcessing) {
          hotkeyPressStartRef.current = Date.now();
          cancelRecordingRef.current = false;
          startRecording();
          setIsPushToTalk(true);
        } else if (isRecording) {
          setIsPushToTalk(false);
          hotkeyPressStartRef.current = null;
          stopRecording();
        }
        return;
      }

      hotkeyPressStartRef.current = null;
      cancelRecordingRef.current = false;
      if (!isRecording && !isProcessing) {
        startRecording();
      } else if (isRecording) {
        stopRecording();
      }
    };

    const unsubscribe = window.electronAPI.onToggleDictation(handleToggle);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [hotkeyMode, isRecording, isProcessing]);

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
        setIsRecording(false);
        pendingStartRef.current = false;
        return;
      }

      if (isRecording) {
        stopRecording();
      }
    };

    const unsubscribe = window.electronAPI.onDictationHotkeyUp(handleRelease);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [hotkeyMode, isRecording, isPushToTalk]);

  const toggleListening = () => {
    setIsCommandMenuOpen(false);
    if (pendingStartRef.current) {
      cancelRecordingRef.current = true;
      pendingStartRef.current = false;
      setIsRecording(false);
      return;
    }
    if (!isRecording && !isProcessing) {
      startRecording();
    } else if (isRecording) {
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
    if (!isRecording && !isProcessing) {
      setIsPushToTalk(false);
    }
  }, [isRecording, isProcessing]);

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

  // Determine current mic state
  const getMicState = () => {
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();
  const hotkeyTooltip =
    hotkeyMode === "hold"
      ? `Hold [${hotkey}] while you speak`
      : `Press [${hotkey}] to speak`;

  // Get microphone button properties based on state
  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-10 h-10 flex items-center justify-center relative overflow-hidden border-2 border-white/70 cursor-pointer";

    switch (micState) {
      case "idle":
        return {
          className: `${baseClasses} bg-black/50 cursor-pointer`,
          tooltip: hotkeyTooltip,
        };
      case "hover":
        return {
          className: `${baseClasses} bg-black/50 cursor-pointer`,
          tooltip: hotkeyTooltip,
        };
      case "recording":
        return {
          className: `${baseClasses} bg-primary cursor-pointer`,
          tooltip: "Recording...",
        };
      case "processing":
        return {
          className: `${baseClasses} bg-primary cursor-not-allowed`,
          tooltip: "Processing...",
        };
      default:
        return {
          className: `${baseClasses} bg-black/50 cursor-pointer`,
          style: { transform: "scale(0.8)" },
          tooltip: "Click to speak",
        };
    }
  };

  const micProps = getMicButtonProps();

  return (
    <>
      {/* Fixed bottom-right voice button */}
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
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
              onFocus={() => setIsHovered(true)}
              onBlur={() => setIsHovered(false)}
              className={micProps.className}
              style={{
                ...micProps.style,
                cursor:
                  micState === "processing"
                    ? "not-allowed !important"
                    : isDragging
                      ? "grabbing !important"
                      : "pointer !important",
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
    </>
  );
}
