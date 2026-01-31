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
    void debugLogger.log("AUDIO_CONTEXT_RESUMING", {
      state: sharedAudioContext.state,
    });
    try {
      await sharedAudioContext.resume();
      // Wait a tick for state to propagate - browsers may not update synchronously
      await new Promise((r) => setTimeout(r, 10));
    } catch (error) {
      void debugLogger.log("AUDIO_CONTEXT_RESUME_FAILED", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Try creating a new context
      sharedAudioContext = null;
      return ensureSharedAudioContext();
    }
  }

  // Verify context is running (resume() may not have worked)
  // Use string comparison to avoid TypeScript narrowing issues
  const currentState = sharedAudioContext.state as string;
  if (currentState !== "running") {
    void debugLogger.log("AUDIO_CONTEXT_NOT_RUNNING", {
      state: currentState,
    });
    // Try creating a new context
    try {
      await sharedAudioContext.close();
    } catch {
      // Ignore close errors
    }
    sharedAudioContext = null;
    return ensureSharedAudioContext();
  }

  void debugLogger.log("AUDIO_CONTEXT_READY", {
    state: sharedAudioContext.state,
    sampleRate: sharedAudioContext.sampleRate,
  });

  return sharedAudioContext;
};

const releaseSharedAudioContext = (): void => {
  if (!sharedAudioContext) return;

  sharedContextUsers = Math.max(0, sharedContextUsers - 1);
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
