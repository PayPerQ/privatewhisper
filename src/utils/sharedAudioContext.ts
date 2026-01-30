import createDebugLogger from "./debugLoggerRenderer";
import { TARGET_SAMPLE_RATE } from "./audioUtils";

const debugLogger = createDebugLogger("shared-audio-context");

let sharedAudioContext: AudioContext | null = null;
let sharedContextUsers = 0;

const ensureSharedAudioContext = async (): Promise<AudioContext> => {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("AudioContext not supported");
    }

    sharedAudioContext = new AudioContextClass({
      sampleRate: TARGET_SAMPLE_RATE,
    });
  }

  if (sharedAudioContext.state === "suspended") {
    try {
      await sharedAudioContext.resume();
    } catch (error) {
      void debugLogger.log("AUDIO_CONTEXT_RESUME_FAILED", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sharedAudioContext;
};

const releaseSharedAudioContext = (): void => {
  if (!sharedAudioContext) return;

  sharedContextUsers = Math.max(0, sharedContextUsers - 1);

  // Don't suspend the AudioContext when users reach 0.
  // Keeping it running ("warm") prevents Bluetooth audio interruptions
  // that occur when resuming a suspended context (A2DP/HFP renegotiation).
};

export const acquireSharedAudioContext = async (): Promise<{
  context: AudioContext;
  release: () => void;
}> => {
  const context = await ensureSharedAudioContext();
  sharedContextUsers += 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSharedAudioContext();
  };

  return { context, release };
};

/**
 * Pre-warm the shared AudioContext without acquiring it.
 * Call this early (e.g., on app load or focus) to avoid Bluetooth audio
 * interruptions on the first recording. The context will stay running
 * after creation, so subsequent acquires won't trigger audio system changes.
 */
export const warmSharedAudioContext = async (): Promise<void> => {
  try {
    await ensureSharedAudioContext();
    void debugLogger.log("AUDIO_CONTEXT_WARMED");
  } catch (error) {
    void debugLogger.log("AUDIO_CONTEXT_WARM_FAILED", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
