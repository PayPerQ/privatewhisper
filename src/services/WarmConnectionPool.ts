import {
  API_ENDPOINTS,
  CONNECTION_CONFIG,
  WARM_CONNECTION_CONFIG,
} from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";

const debugLogger = createDebugLogger("warm-connection-pool");

type WarmConnectionState = "warming" | "ready" | "in-use" | "stale" | "error";

interface WarmConnection {
  ws: WebSocket;
  createdAt: number;
  state: WarmConnectionState;
  apiKey: string;
  toolId?: string;
}

interface WarmConnectionCallbacks {
  onConnectionReady?: () => void;
  onConnectionError?: (error: string) => void;
  onConnectionStale?: () => void;
}

class WarmConnectionPool {
  private pool: WarmConnection[] = [];
  private callbacks: WarmConnectionCallbacks = {};
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveIntervals: Map<WebSocket, ReturnType<typeof setInterval>> =
    new Map();
  // Use a Promise to allow concurrent callers to await the same warming operation
  private warmingPromise: Promise<void> | null = null;

  setCallbacks(callbacks: WarmConnectionCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Pre-warm a connection for future use.
   * Call this on app launch/focus to have a connection ready.
   * Concurrent calls will await the same warming operation.
   */
  async warmConnection(apiKey: string, toolId?: string): Promise<void> {
    // If warming is in progress, await the existing operation
    if (this.warmingPromise) {
      void debugLogger.log("WARM_ALREADY_IN_PROGRESS_AWAITING");
      return this.warmingPromise;
    }

    // Don't warm if we already have a ready connection
    const existingReady = this.pool.find((c) => c.state === "ready");
    if (existingReady) {
      void debugLogger.log("WARM_ALREADY_READY");
      return;
    }

    // Check if pool is full
    if (this.pool.length >= WARM_CONNECTION_CONFIG.MAX_POOL_SIZE) {
      void debugLogger.log("WARM_POOL_FULL", {
        poolSize: this.pool.length,
        maxSize: WARM_CONNECTION_CONFIG.MAX_POOL_SIZE,
      });
      return;
    }

    void debugLogger.log("WARMING_CONNECTION", {
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
      toolId,
    });

    // Create and store the warming promise before any async operations
    this.warmingPromise = this.doWarmConnection(apiKey, toolId);

    try {
      await this.warmingPromise;
    } finally {
      this.warmingPromise = null;
    }
  }

  private async doWarmConnection(
    apiKey: string,
    toolId?: string,
  ): Promise<void> {
    try {
      const connection = await this.createWarmConnection(apiKey, toolId);
      this.pool.push(connection);
      this.scheduleRefresh();
      this.callbacks.onConnectionReady?.();

      void debugLogger.log("WARM_CONNECTION_READY", {
        poolSize: this.pool.length,
      });
    } catch (error) {
      void debugLogger.log("WARM_CONNECTION_FAILED", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.callbacks.onConnectionError?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async createWarmConnection(
    apiKey: string,
    toolId?: string,
  ): Promise<WarmConnection> {
    return new Promise((resolve, reject) => {
      const wsUrl = API_ENDPOINTS.PPQ_STREAMING_TRANSCRIPTION_WS;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        reject(new Error("Failed to create WebSocket"));
        return;
      }

      const connection: WarmConnection = {
        ws,
        createdAt: Date.now(),
        state: "warming",
        apiKey,
        toolId,
      };

      const timeout = setTimeout(() => {
        if (connection.state === "warming") {
          connection.state = "error";
          ws.close();
          reject(new Error("Warm connection timeout"));
        }
      }, CONNECTION_CONFIG.CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        // Send authentication message
        const authMessage: { type: string; api_key: string; tool_id?: string } =
          {
            type: "auth",
            api_key: apiKey,
          };
        if (toolId) {
          authMessage.tool_id = toolId;
        }
        ws.send(JSON.stringify(authMessage));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "auth_result") {
            if (!msg.success) {
              clearTimeout(timeout);
              connection.state = "error";
              ws.close();
              reject(new Error(msg.error || "Authentication failed"));
            }
            // Wait for 'ready' message
          } else if (msg.type === "ready") {
            clearTimeout(timeout);
            connection.state = "ready";
            this.startKeepalive(connection);
            resolve(connection);
          } else if (msg.type === "pong") {
            // Keepalive pong received
            void debugLogger.log("WARM_KEEPALIVE_PONG");
          } else if (msg.type === "error") {
            void debugLogger.log("WARM_CONNECTION_SERVER_ERROR", {
              message: msg.message,
            });
          }
        } catch (error) {
          void debugLogger.log("WARM_MESSAGE_PARSE_ERROR", { error });
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        connection.state = "error";
        reject(new Error("WebSocket connection error"));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        this.stopKeepalive(connection);
        if (connection.state === "warming") {
          connection.state = "error";
          reject(new Error("WebSocket closed during warming"));
        } else if (connection.state === "ready") {
          connection.state = "stale";
          this.removeFromPool(connection);
        }
      };
    });
  }

  private startKeepalive(connection: WarmConnection): void {
    const interval = setInterval(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // Connection might be closing
        }
      }
    }, CONNECTION_CONFIG.KEEPALIVE_INTERVAL_MS);

    this.keepaliveIntervals.set(connection.ws, interval);
  }

  private stopKeepalive(connection: WarmConnection): void {
    const interval = this.keepaliveIntervals.get(connection.ws);
    if (interval) {
      clearInterval(interval);
      this.keepaliveIntervals.delete(connection.ws);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Schedule refresh before TTL expires
    const refreshIn =
      WARM_CONNECTION_CONFIG.CONNECTION_TTL_MS -
      WARM_CONNECTION_CONFIG.REFRESH_BUFFER_MS;

    this.refreshTimer = setTimeout(() => {
      this.refreshConnections();
    }, refreshIn);

    void debugLogger.log("REFRESH_SCHEDULED", { refreshInMs: refreshIn });
  }

  private async refreshConnections(): Promise<void> {
    void debugLogger.log("REFRESHING_CONNECTIONS");

    // Mark old connections as stale and close them
    const now = Date.now();
    const staleConnections = this.pool.filter(
      (c) =>
        c.state === "ready" &&
        now - c.createdAt > WARM_CONNECTION_CONFIG.CONNECTION_TTL_MS,
    );

    for (const connection of staleConnections) {
      void debugLogger.log("CONNECTION_EXPIRED", {
        age: now - connection.createdAt,
        ttl: WARM_CONNECTION_CONFIG.CONNECTION_TTL_MS,
      });
      connection.state = "stale";
      this.stopKeepalive(connection);
      try {
        connection.ws.close();
      } catch {
        // Ignore close errors
      }
      this.removeFromPool(connection);
      this.callbacks.onConnectionStale?.();
    }

    // Warm a new connection if we have credentials from the stale one
    const lastStale = staleConnections[staleConnections.length - 1];
    if (lastStale) {
      await this.warmConnection(lastStale.apiKey, lastStale.toolId);
    }
  }

  private removeFromPool(connection: WarmConnection): void {
    const index = this.pool.indexOf(connection);
    if (index !== -1) {
      this.pool.splice(index, 1);
      void debugLogger.log("REMOVED_FROM_POOL", {
        poolSize: this.pool.length,
      });
    }
  }

  /**
   * Acquire a warm connection for use.
   * Returns the WebSocket if one is available, null otherwise.
   * The connection is marked as 'in-use' and removed from the pool.
   */
  acquire(): WebSocket | null {
    const readyConnection = this.pool.find(
      (c) => c.state === "ready" && c.ws.readyState === WebSocket.OPEN,
    );

    if (!readyConnection) {
      void debugLogger.log("NO_WARM_CONNECTION_AVAILABLE", {
        poolSize: this.pool.length,
        states: this.pool.map((c) => ({
          state: c.state,
          wsState: c.ws.readyState,
        })),
      });
      return null;
    }

    // Check if connection is still fresh enough
    const age = Date.now() - readyConnection.createdAt;
    if (age > WARM_CONNECTION_CONFIG.CONNECTION_TTL_MS) {
      void debugLogger.log("WARM_CONNECTION_EXPIRED", { age });
      readyConnection.state = "stale";
      this.stopKeepalive(readyConnection);
      this.removeFromPool(readyConnection);
      try {
        readyConnection.ws.close();
      } catch {
        // Ignore close errors
      }
      return null;
    }

    // Mark as in-use and remove from pool
    readyConnection.state = "in-use";
    this.stopKeepalive(readyConnection);
    this.removeFromPool(readyConnection);

    void debugLogger.log("WARM_CONNECTION_ACQUIRED", {
      age,
      poolSize: this.pool.length,
    });

    return readyConnection.ws;
  }

  /**
   * Release a connection back to the pool.
   * Only call this if the connection is still healthy.
   */
  release(ws: WebSocket, apiKey: string, toolId?: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      void debugLogger.log("RELEASE_SKIPPED_NOT_OPEN", {
        readyState: ws.readyState,
      });
      return;
    }

    // Check if pool is full
    if (this.pool.length >= WARM_CONNECTION_CONFIG.MAX_POOL_SIZE) {
      void debugLogger.log("RELEASE_SKIPPED_POOL_FULL");
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
      return;
    }

    const connection: WarmConnection = {
      ws,
      createdAt: Date.now(), // Reset creation time on release
      state: "ready",
      apiKey,
      toolId,
    };

    this.pool.push(connection);
    this.startKeepalive(connection);
    this.scheduleRefresh();

    void debugLogger.log("CONNECTION_RELEASED", {
      poolSize: this.pool.length,
    });
  }

  /**
   * Check if a warm connection is available.
   */
  hasWarmConnection(): boolean {
    return this.pool.some(
      (c) =>
        c.state === "ready" &&
        Date.now() - c.createdAt < WARM_CONNECTION_CONFIG.CONNECTION_TTL_MS,
    );
  }

  /**
   * Get the current pool size.
   */
  getPoolSize(): number {
    return this.pool.length;
  }

  /**
   * Clean up all connections and timers.
   */
  cleanup(): void {
    void debugLogger.log("CLEANUP");

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    for (const connection of this.pool) {
      this.stopKeepalive(connection);
      try {
        connection.ws.close();
      } catch {
        // Ignore close errors
      }
    }

    this.pool = [];
  }
}

// Export as singleton
export default new WarmConnectionPool();
