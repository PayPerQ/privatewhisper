import { API_ENDPOINTS, CONNECTION_CONFIG } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";

const debugLogger = createDebugLogger("streaming-transcription");

export type StreamingState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "ready"
  | "streaming"
  | "reconnecting"
  | "closed"
  | "error";

export interface StreamingCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: StreamingState) => void;
  onSpeechStarted?: () => void;
  onSpeechEnded?: () => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onReconnected?: () => void;
}

interface ServerMessage {
  type:
    | "auth_result"
    | "ready"
    | "transcript"
    | "speech_started"
    | "speech_ended"
    | "error"
    | "closed"
    | "config_ack"
    | "pong"
    | "finalized";
  success?: boolean;
  error?: string;
  message?: string;
  text?: string;
  is_final?: boolean;
  confidence?: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

class StreamingTranscriptionService {
  private ws: WebSocket | null = null;
  private callbacks: StreamingCallbacks = {};
  private accumulatedText = "";
  private state: StreamingState = "disconnected";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS;
  private language: string = "multi";
  private finalized = false;

  // Cached credentials for reconnection
  private cachedApiKey: string = "";
  private cachedToolId: string | undefined;

  // Keepalive mechanism
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongTime: number = 0;
  private isReconnecting: boolean = false;

  // Track if we're in the middle of an active streaming session
  private wasStreaming: boolean = false;

  // Event-driven finalize completion
  private finalizeResolver: (() => void) | null = null;
  private finalizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Track last interim text in case server doesn't send is_final before finalized
  private lastInterimText = "";

  // Track if we've received ANY server response after starting to send audio.
  // If we're streaming but receive nothing within a timeout, connection is dead.
  private receivedResponseAfterStreaming = false;
  private streamingResponseTimeoutId: ReturnType<typeof setTimeout> | null =
    null;
  private static readonly STREAMING_RESPONSE_TIMEOUT_MS = 5000; // 5 seconds

  // Track if connection was intentionally aborted (e.g., rapid push-to-talk taps)
  // Suppresses error callbacks when user cancels before connection completes
  private aborted = false;

  setCallbacks(callbacks: StreamingCallbacks): void {
    this.callbacks = callbacks;
  }

  setLanguage(language: string): void {
    this.language = language === "auto" ? "multi" : language;
  }

  getState(): StreamingState {
    return this.state;
  }

  getAccumulatedText(): string {
    return this.accumulatedText.trim();
  }

  private setState(newState: StreamingState): void {
    const previousState = this.state;
    this.state = newState;
    this.callbacks.onStateChange?.(newState);

    void debugLogger.log("STATE_CHANGE", {
      from: previousState,
      to: newState,
    });
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastPongTime = Date.now();

    // Send immediate ping so server can respond before first timeout check
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // Connection might be closing
      }
    }

    this.keepaliveInterval = setInterval(() => {
      // Only do keepalive when NOT streaming - during streaming, audio data keeps connection alive
      if (this.state === "streaming") {
        return;
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch (error) {
          void debugLogger.log("KEEPALIVE_PING_ERROR", { error });
        }

        const timeSinceLastPong = Date.now() - this.lastPongTime;
        if (
          timeSinceLastPong >
          CONNECTION_CONFIG.KEEPALIVE_INTERVAL_MS +
            CONNECTION_CONFIG.KEEPALIVE_TIMEOUT_MS
        ) {
          void debugLogger.log("KEEPALIVE_TIMEOUT", {
            timeSinceLastPong,
            threshold:
              CONNECTION_CONFIG.KEEPALIVE_INTERVAL_MS +
              CONNECTION_CONFIG.KEEPALIVE_TIMEOUT_MS,
          });
          this.handleStaleConnection();
          return;
        }
      }
    }, CONNECTION_CONFIG.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
      void debugLogger.log("KEEPALIVE_STOPPED");
    }
  }

  private handleStaleConnection(): void {
    void debugLogger.log("STALE_CONNECTION_DETECTED");
    this.stopKeepalive();

    // Close the stale WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors on stale connection
      }
      this.ws = null;
    }

    // Attempt reconnection if we were actively streaming
    if (
      this.wasStreaming &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      void this.attemptReconnect();
    } else {
      this.setState("error");
      this.callbacks.onError?.("Connection lost (keepalive timeout)");
    }
  }

  private async attemptReconnect(): Promise<boolean> {
    if (this.isReconnecting) {
      void debugLogger.log("RECONNECT_ALREADY_IN_PROGRESS");
      return false;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      void debugLogger.log("RECONNECT_MAX_ATTEMPTS_REACHED", {
        attempts: this.reconnectAttempts,
        max: this.maxReconnectAttempts,
      });
      this.setState("error");
      this.callbacks.onError?.(
        `Connection lost after ${this.maxReconnectAttempts} reconnection attempts`,
      );
      return false;
    }

    this.isReconnecting = true;
    this.setState("reconnecting");

    const backoffMs = Math.min(
      CONNECTION_CONFIG.INITIAL_BACKOFF_MS *
        Math.pow(CONNECTION_CONFIG.BACKOFF_MULTIPLIER, this.reconnectAttempts),
      CONNECTION_CONFIG.MAX_BACKOFF_MS,
    );

    this.reconnectAttempts++;
    this.callbacks.onReconnecting?.(
      this.reconnectAttempts,
      this.maxReconnectAttempts,
    );

    void debugLogger.log("RECONNECT_ATTEMPTING", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      backoffMs,
    });

    await new Promise((r) => setTimeout(r, backoffMs));

    try {
      await this.connectInternal(this.cachedApiKey, this.cachedToolId);
      this.isReconnecting = false;
      this.callbacks.onReconnected?.();

      void debugLogger.log("RECONNECT_SUCCESS", {
        attempt: this.reconnectAttempts,
      });

      return true;
    } catch (error) {
      void debugLogger.log("RECONNECT_FAILED", {
        attempt: this.reconnectAttempts,
        error: error instanceof Error ? error.message : String(error),
      });

      this.isReconnecting = false;

      // Try again if we haven't exceeded max attempts
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        return this.attemptReconnect();
      }

      this.setState("error");
      this.callbacks.onError?.(
        `Reconnection failed after ${this.maxReconnectAttempts} attempts`,
      );
      return false;
    }
  }

  async connect(apiKey: string, toolId?: string): Promise<void> {
    // Abort any existing connection before starting a new one
    // This prevents orphan connections and state corruption
    if (this.ws) {
      void debugLogger.log("ABORTING_EXISTING_CONNECTION", {
        readyState: this.ws.readyState,
        state: this.state,
      });
      this.stopKeepalive();
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    // Cache credentials for potential reconnection
    this.cachedApiKey = apiKey;
    this.cachedToolId = toolId;
    this.reconnectAttempts = 0;
    this.wasStreaming = false;
    this.accumulatedText = "";
    this.lastInterimText = "";
    this.finalized = false;
    this.isReconnecting = false;
    this.finalizeResolver = null;
    if (this.finalizeTimeoutId) {
      clearTimeout(this.finalizeTimeoutId);
      this.finalizeTimeoutId = null;
    }
    this.receivedResponseAfterStreaming = false;
    if (this.streamingResponseTimeoutId) {
      clearTimeout(this.streamingResponseTimeoutId);
      this.streamingResponseTimeoutId = null;
    }

    return this.connectInternal(apiKey, toolId);
  }

  /**
   * Handle messages during active streaming (after authentication).
   */
  private handleStreamingMessage(msg: ServerMessage): void {
    void debugLogger.log("WS_RECV", { ...msg });

    // Any message from the server proves the connection is alive and processing
    // Clear the "no response" timeout if we were waiting for a response
    if (
      this.wasStreaming &&
      !this.receivedResponseAfterStreaming &&
      (msg.type === "transcript" ||
        msg.type === "speech_started" ||
        msg.type === "speech_ended" ||
        msg.type === "finalized")
    ) {
      this.receivedResponseAfterStreaming = true;
      if (this.streamingResponseTimeoutId) {
        clearTimeout(this.streamingResponseTimeoutId);
        this.streamingResponseTimeoutId = null;
      }
    }

    switch (msg.type) {
      case "pong":
        this.lastPongTime = Date.now();
        break;

      case "transcript":
        if (msg.text) {
          if (msg.is_final) {
            void debugLogger.log("TRANSCRIPT_FINAL", {
              text: msg.text,
              accumulatedBefore: this.accumulatedText.trim().slice(-50),
              lastInterim: this.lastInterimText.slice(-50),
            });
            this.accumulatedText += msg.text + " ";
            // Don't clear lastInterimText here - wait for finalized to ensure
            // all server-side processing is complete and nothing is lost
            this.callbacks.onFinalResult?.(this.accumulatedText.trim());
          } else {
            this.lastInterimText = msg.text; // Track latest interim
            const interimDisplay = this.accumulatedText + msg.text;
            this.callbacks.onInterimResult?.(interimDisplay);
          }
        }
        break;

      case "speech_started":
        if (this.state === "ready") {
          this.setState("streaming");
        }
        this.wasStreaming = true;
        this.callbacks.onSpeechStarted?.();
        break;

      case "speech_ended":
        this.callbacks.onSpeechEnded?.();
        break;

      case "error":
        void debugLogger.log("SERVER_ERROR", { message: msg.message });
        this.callbacks.onError?.(msg.message || "Unknown server error");
        break;

      case "closed":
        this.stopKeepalive();
        this.setState("closed");
        // Server confirmed close - resolve any pending finalize
        if (this.finalizeResolver) {
          this.finalizeResolver();
          this.finalizeResolver = null;
        }
        break;

      case "config_ack":
        break;

      case "finalized":
        void debugLogger.log("WS_FINALIZED", {
          accumulatedText: this.accumulatedText.trim().slice(-100),
          lastInterimText: this.lastInterimText,
        });
        // If we have pending interim text, check if it contains content not yet in accumulated
        if (this.lastInterimText) {
          const accumulated = this.accumulatedText.trim();
          const interim = this.lastInterimText.trim();

          // Only add interim if it's not already contained in accumulated text
          // This handles the case where the final transcript was truncated
          if (
            !accumulated.endsWith(interim) &&
            !accumulated.includes(interim)
          ) {
            // Find if interim extends beyond accumulated (shares a common prefix/overlap)
            // For simplicity, if interim is longer and accumulated doesn't contain it, add it
            void debugLogger.log("ADDED_PENDING_INTERIM", {
              text: this.lastInterimText,
              reason: "interim not found in accumulated",
            });
            this.accumulatedText += this.lastInterimText + " ";
          } else {
            void debugLogger.log("SKIPPED_PENDING_INTERIM", {
              text: this.lastInterimText,
              reason: "already in accumulated",
            });
          }
          this.lastInterimText = "";
        }
        if (this.finalizeResolver) {
          this.finalizeResolver();
          this.finalizeResolver = null;
        }
        break;
    }
  }

  private async connectInternal(
    apiKey: string,
    toolId?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        void debugLogger.log("ALREADY_CONNECTED");
        resolve();
        return;
      }

      // Don't reset accumulated text on reconnection
      if (!this.isReconnecting) {
        this.accumulatedText = "";
      }
      this.finalized = false;
      this.aborted = false; // Reset aborted flag for new connection
      this.setState("connecting");

      const wsUrl = API_ENDPOINTS.PPQ_STREAMING_TRANSCRIPTION_WS;

      void debugLogger.log("CONNECTING", {
        url: wsUrl,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
        toolId,
        isReconnect: this.isReconnecting,
      });

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (error) {
        void debugLogger.log("WEBSOCKET_CREATE_ERROR", { error });
        this.setState("error");
        reject(new Error("Failed to create WebSocket connection"));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.state === "connecting" || this.state === "authenticating") {
          void debugLogger.log("CONNECTION_TIMEOUT");
          this.ws?.close();
          this.setState("error");
          reject(new Error("Connection timeout"));
        }
      }, CONNECTION_CONFIG.CONNECTION_TIMEOUT_MS);

      this.ws.onopen = () => {
        this.setState("authenticating");

        // Send authentication message with optional tool_id for creator payouts
        const authMessage: { type: string; api_key: string; tool_id?: string } =
          {
            type: "auth",
            api_key: apiKey,
          };
        if (toolId) {
          authMessage.tool_id = toolId;
        }
        this.ws?.send(JSON.stringify(authMessage));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.handleMessage(msg, resolve, reject, connectionTimeout);
        } catch (error) {
          void debugLogger.log("MESSAGE_PARSE_ERROR", {
            error,
            data: event.data,
          });
        }
      };

      this.ws.onerror = (event: Event) => {
        void debugLogger.log("WEBSOCKET_ERROR", {
          event,
          aborted: this.aborted,
        });
        clearTimeout(connectionTimeout);
        this.stopKeepalive();

        // Suppress errors if connection was intentionally aborted (e.g., rapid push-to-talk)
        if (this.aborted) {
          // Still reject the promise so it doesn't hang, but with a distinct error
          reject(new Error("Connection aborted"));
          return;
        }

        const wasConnecting =
          this.state === "connecting" || this.state === "authenticating";

        // If we were streaming and lost connection, attempt reconnection
        if (
          this.wasStreaming &&
          !wasConnecting &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.ws = null;
          void this.attemptReconnect();
          return;
        }

        this.setState("error");

        // Only notify via callback if already connected (not during initial connection)
        // During connection, we reject the promise instead to let the caller handle it
        if (wasConnecting) {
          reject(new Error("WebSocket connection error"));
        } else {
          this.callbacks.onError?.("WebSocket connection error");
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        void debugLogger.log("WEBSOCKET_CLOSE", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          wasStreaming: this.wasStreaming,
        });

        clearTimeout(connectionTimeout);
        this.stopKeepalive();

        // Don't attempt reconnection if it was a clean close or we initiated it
        const shouldReconnect =
          this.wasStreaming &&
          !event.wasClean &&
          this.state !== "closed" &&
          this.state !== "error" &&
          this.state !== "disconnected" &&
          this.reconnectAttempts < this.maxReconnectAttempts;

        if (shouldReconnect) {
          this.ws = null;
          void this.attemptReconnect();
          return;
        }

        if (this.state !== "closed" && this.state !== "error") {
          this.setState("closed");
        }

        this.ws = null;
      };
    });
  }

  private handleMessage(
    msg: ServerMessage,
    resolve: (value: void | PromiseLike<void>) => void,
    reject: (reason?: any) => void,
    connectionTimeout: ReturnType<typeof setTimeout>,
  ): void {
    // Handle authentication-phase messages
    switch (msg.type) {
      case "auth_result":
        if (msg.success) {
          // Wait for 'ready' message before resolving
        } else {
          void debugLogger.log("AUTH_FAILED", { error: msg.error });
          clearTimeout(connectionTimeout);
          this.stopKeepalive();
          this.setState("error");
          this.callbacks.onError?.(msg.error || "Authentication failed");
          reject(new Error(msg.error || "Authentication failed"));
        }
        return;

      case "ready":
        clearTimeout(connectionTimeout);
        this.setState("ready");
        this.reconnectAttempts = 0;

        // Start keepalive mechanism
        this.startKeepalive();

        if (this.language !== "multi") {
          this.ws?.send(
            JSON.stringify({ type: "config", language: this.language }),
          );
        }

        resolve();
        return;
    }

    // Delegate all post-authentication messages to the shared handler
    this.handleStreamingMessage(msg);
  }

  sendAudio(chunk: ArrayBuffer): void {
    // Log first few sends for debugging
    if (!this.wasStreaming) {
      void debugLogger.log("SEND_AUDIO_FIRST", {
        wsExists: !!this.ws,
        readyState: this.ws?.readyState,
        expectedState: WebSocket.OPEN,
        state: this.state,
        chunkSize: chunk.byteLength,
      });
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      // Mark that we're actively streaming
      this.wasStreaming = true;

      // Start a timeout to detect dead connections - if we're sending audio but
      // receive no response within 5 seconds, the server isn't processing our audio
      if (
        !this.receivedResponseAfterStreaming &&
        !this.streamingResponseTimeoutId
      ) {
        this.streamingResponseTimeoutId = setTimeout(() => {
          if (!this.receivedResponseAfterStreaming && this.wasStreaming) {
            void debugLogger.log("STREAMING_NO_RESPONSE_TIMEOUT");
            // Connection appears open but server isn't responding - treat as stale
            this.handleStaleConnection();
          }
        }, StreamingTranscriptionService.STREAMING_RESPONSE_TIMEOUT_MS);
      }

      // Convert ArrayBuffer to base64 efficiently using chunked approach
      // This avoids stack overflow on large buffers and is faster than string concatenation
      const uint8Array = new Uint8Array(chunk);
      const CHUNK_SIZE = 32768; // Process 32KB at a time to avoid call stack issues
      let binary = "";
      for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
        const slice = uint8Array.subarray(
          i,
          Math.min(i + CHUNK_SIZE, uint8Array.length),
        );
        binary += String.fromCharCode.apply(null, Array.from(slice));
      }
      const base64 = btoa(binary);

      this.ws.send(JSON.stringify({ type: "audio", data: base64 }));
    } else if (this.state === "reconnecting") {
      // During reconnection, audio will be buffered by PCMAudioCapture
      void debugLogger.log("SEND_AUDIO_DURING_RECONNECT", {
        state: this.state,
      });
    } else {
      void debugLogger.log("SEND_AUDIO_FAILED", {
        readyState: this.ws?.readyState,
        expectedState: WebSocket.OPEN,
        currentState: this.state,
      });
    }
  }

  finalize(): void {
    if (this.finalized) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      void debugLogger.log("WS_SEND", { type: "finalize" });
      this.ws.send(JSON.stringify({ type: "finalize" }));
      this.finalized = true;
    }
  }

  async close(): Promise<string> {
    void debugLogger.log("WS_CLOSING", {
      accumulated: this.accumulatedText.trim().slice(0, 50),
    });

    // Mark that we're no longer actively streaming (prevent reconnection attempts)
    this.wasStreaming = false;
    this.stopKeepalive();

    // Finalize if not already done (idempotent)
    this.finalize();

    // Wait for server to confirm finalization (event-driven) with timeout fallback
    const FINALIZE_TIMEOUT_MS = 3000;
    await new Promise<void>((resolve) => {
      this.finalizeResolver = () => {
        if (this.finalizeTimeoutId) {
          clearTimeout(this.finalizeTimeoutId);
          this.finalizeTimeoutId = null;
        }
        resolve();
      };
      this.finalizeTimeoutId = setTimeout(() => {
        void debugLogger.log("WS_FINALIZE_TIMEOUT");
        this.finalizeTimeoutId = null;
        this.finalizeResolver = null;
        resolve();
      }, FINALIZE_TIMEOUT_MS);
    });
    this.finalizeResolver = null;

    const finalText = this.accumulatedText.trim();
    void debugLogger.log("WS_FINAL_TEXT", {
      text: finalText.slice(0, 100),
      length: finalText.length,
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      void debugLogger.log("WS_SEND", { type: "close" });
      this.ws.send(JSON.stringify({ type: "close" }));
    }

    this.ws?.close();
    this.ws = null;
    this.finalized = false;
    this.lastInterimText = "";
    this.receivedResponseAfterStreaming = false;
    if (this.streamingResponseTimeoutId) {
      clearTimeout(this.streamingResponseTimeoutId);
      this.streamingResponseTimeoutId = null;
    }
    this.setState("disconnected");

    return finalText;
  }

  disconnect(): void {
    void debugLogger.log("DISCONNECTING");

    // Mark as aborted to suppress error callbacks from pending WebSocket events
    this.aborted = true;
    this.wasStreaming = false;
    this.stopKeepalive();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.accumulatedText = "";
    this.lastInterimText = "";
    this.finalized = false;
    this.finalizeResolver = null;
    if (this.finalizeTimeoutId) {
      clearTimeout(this.finalizeTimeoutId);
      this.finalizeTimeoutId = null;
    }
    this.receivedResponseAfterStreaming = false;
    if (this.streamingResponseTimeoutId) {
      clearTimeout(this.streamingResponseTimeoutId);
      this.streamingResponseTimeoutId = null;
    }
    this.cachedApiKey = "";
    this.cachedToolId = undefined;
    this.setState("disconnected");
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isInReconnectingState(): boolean {
    return this.state === "reconnecting" || this.isReconnecting;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  didUseWarmConnection(): boolean {
    return false; // Warm connection pool removed for simplicity
  }
}

// Export as singleton
export default new StreamingTranscriptionService();
