import { API_ENDPOINTS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";

const debugLogger = createDebugLogger("streaming-transcription");

export type StreamingState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "ready"
  | "streaming"
  | "closed"
  | "error";

export interface StreamingCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: StreamingState) => void;
  onSpeechStarted?: () => void;
  onSpeechEnded?: () => void;
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
    | "config_ack";
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
  private maxReconnectAttempts = 3;
  private language: string = "multi";

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
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  async connect(apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        void debugLogger.log("ALREADY_CONNECTED");
        resolve();
        return;
      }

      this.accumulatedText = "";
      this.setState("connecting");

      const wsUrl = API_ENDPOINTS.PPQ_STREAMING_TRANSCRIPTION_WS;

      void debugLogger.log("CONNECTING", {
        url: wsUrl,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
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
      }, 10000);

      this.ws.onopen = () => {
        this.setState("authenticating");

        // Send authentication message
        this.ws?.send(JSON.stringify({ type: "auth", api_key: apiKey }));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          this.handleMessage(msg, resolve, reject, connectionTimeout);
        } catch (error) {
          void debugLogger.log("MESSAGE_PARSE_ERROR", { error, data: event.data });
        }
      };

      this.ws.onerror = (event: Event) => {
        void debugLogger.log("WEBSOCKET_ERROR", { event });
        clearTimeout(connectionTimeout);
        this.setState("error");
        this.callbacks.onError?.("WebSocket connection error");

        if (
          this.state === "connecting" ||
          this.state === "authenticating"
        ) {
          reject(new Error("WebSocket connection error"));
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        void debugLogger.log("WEBSOCKET_CLOSE", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });

        clearTimeout(connectionTimeout);

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
    connectionTimeout: ReturnType<typeof setTimeout>
  ): void {
    switch (msg.type) {
      case "auth_result":
        if (msg.success) {
          // Wait for 'ready' message before resolving
        } else {
          void debugLogger.log("AUTH_FAILED", { error: msg.error });
          clearTimeout(connectionTimeout);
          this.setState("error");
          this.callbacks.onError?.(msg.error || "Authentication failed");
          reject(new Error(msg.error || "Authentication failed"));
        }
        break;

      case "ready":
        clearTimeout(connectionTimeout);
        this.setState("ready");
        this.reconnectAttempts = 0;

        // Send config for language
        if (this.language !== "multi") {
          this.ws?.send(
            JSON.stringify({ type: "config", language: this.language })
          );
        }

        resolve();
        break;

      case "transcript":
        if (msg.text) {
          if (msg.is_final) {
            this.accumulatedText += msg.text + " ";
            this.callbacks.onFinalResult?.(this.accumulatedText.trim());
          } else {
            // Interim result - show accumulated + current interim
            const interimDisplay = this.accumulatedText + msg.text;
            this.callbacks.onInterimResult?.(interimDisplay);
          }
        }
        break;

      case "speech_started":
        if (this.state === "ready") {
          this.setState("streaming");
        }
        this.callbacks.onSpeechStarted?.();
        break;

      case "speech_ended":
        void debugLogger.log("SPEECH_ENDED");
        this.callbacks.onSpeechEnded?.();
        break;

      case "error":
        void debugLogger.log("SERVER_ERROR", { message: msg.message });
        this.callbacks.onError?.(msg.message || "Server error");
        break;

      case "closed":
        void debugLogger.log("SERVER_CLOSED");
        this.setState("closed");
        break;

      case "config_ack":
        // Config acknowledged by server
        break;

      default:
        void debugLogger.log("UNKNOWN_MESSAGE", { msg });
    }
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Convert ArrayBuffer to base64
      const uint8Array = new Uint8Array(chunk);
      let binary = "";
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);

      this.ws.send(JSON.stringify({ type: "audio", data: base64 }));
    } else {
      void debugLogger.log("SEND_AUDIO_FAILED", {
        readyState: this.ws?.readyState,
        expectedState: WebSocket.OPEN,
      });
    }
  }

  finalize(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      void debugLogger.log("SENDING_FINALIZE");
      this.ws.send(JSON.stringify({ type: "finalize" }));
    }
  }

  async close(): Promise<string> {
    void debugLogger.log("CLOSING", {
      accumulatedText: this.accumulatedText.trim(),
    });

    // First finalize to flush any remaining audio
    this.finalize();

    // Wait briefly for final results to come through
    await new Promise((resolve) => setTimeout(resolve, 500));

    const finalText = this.accumulatedText.trim();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "close" }));
    }

    this.ws?.close();
    this.ws = null;
    this.setState("disconnected");

    return finalText;
  }

  disconnect(): void {
    void debugLogger.log("DISCONNECTING");

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.accumulatedText = "";
    this.setState("disconnected");
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export as singleton
export default new StreamingTranscriptionService();
