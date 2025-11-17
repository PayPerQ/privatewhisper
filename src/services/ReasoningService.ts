import { BaseReasoningService, ReasoningConfig } from "./BaseReasoningService";
import { withRetry, createApiRetryStrategy } from "../utils/retry";
import { API_ENDPOINTS, TOKEN_LIMITS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";
import apiKeyManager from "../utils/ApiKeyManager";

const debugLogger = createDebugLogger("reasoning");

export const DEFAULT_PROMPTS = {
  agent: `You are {{agentName}}, a helpful AI assistant. Process and improve the following text, removing any reference to your name from the output:\n\n{{text}}\n\nImproved text:`,
  regular: `Process and improve the following text:\n\n{{text}}\n\nImproved text:`,
};

class ReasoningService extends BaseReasoningService {
  constructor() {
    super();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const key = await apiKeyManager.getApiKey();
      return Boolean(key);
    } catch {
      return false;
    }
  }

  private buildRequestBody(
    text: string,
    model: string,
    agentName: string | null,
    config: ReasoningConfig = {}
  ) {
    const systemPrompt =
      "You are a dictation assistant. Clean up text by fixing grammar and punctuation. Output ONLY the cleaned text without any explanations, options, or commentary.";
    const userPrompt = this.getReasoningPrompt(text, agentName, config);

    const maxTokens =
      config.maxTokens ??
      this.calculateMaxTokens(
        text.length,
        TOKEN_LIMITS.MIN_TOKENS,
        TOKEN_LIMITS.MAX_TOKENS,
        TOKEN_LIMITS.TOKEN_MULTIPLIER
      );

    return {
      model: model || "qwen/qwen3-32b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: config.temperature ?? 0.3,
      max_tokens: maxTokens,
    };
  }

  private extractResponseText(payload: any): string {
    if (Array.isArray(payload?.choices)) {
      for (const choice of payload.choices) {
        const message = choice?.message ?? choice?.delta;
        const content = message?.content;

        if (typeof content === "string" && content.trim()) {
          return content.trim();
        }

        if (Array.isArray(content)) {
          for (const part of content) {
            if (typeof part?.text === "string" && part.text.trim()) {
              return part.text.trim();
            }
          }
        }
      }
    }

    if (typeof payload?.output_text === "string") {
      return payload.output_text.trim();
    }

    if (Array.isArray(payload?.output)) {
      for (const item of payload.output) {
        if (item?.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === "output_text" && part.text) {
              return part.text.trim();
            }
          }
        }
      }
    }

    return "";
  }

  async processText(
    text: string,
    modelId: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    if (!text || !text.trim()) {
      throw new Error("No text provided for reasoning");
    }

    this.isProcessing = true;

    try {
      const apiKey = await apiKeyManager.getApiKey();

      const requestBody = this.buildRequestBody(text, modelId, agentName, config);

      void debugLogger.log("GROQ_REQUEST", {
        model: requestBody.model,
        maxTokens: requestBody.max_tokens,
        temperature: requestBody.temperature,
        textLength: text.length,
      });

      const response = await withRetry(
        async () => {
          const res = await fetch(API_ENDPOINTS.GROQ_CHAT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errorText = await res.text().catch(() => "");
            const message =
              errorText || res.statusText || "Groq API request failed";
            const error: any = new Error(message);
            error.response = res;
            throw error;
          }

          return res.json();
        },
        createApiRetryStrategy()
      );

      void debugLogger.log("GROQ_RESPONSE_RECEIVED", {
        model: requestBody.model,
        hasChoices: Array.isArray(response?.choices),
        hasOutput: Array.isArray(response?.output),
      });

      const cleaned = this.extractResponseText(response);

      if (!cleaned) {
        void debugLogger.log("GROQ_EMPTY_RESPONSE", {
          model: requestBody.model,
        });
        throw new Error("Groq API returned an empty response");
      }

      return cleaned;
    } catch (error) {
      void debugLogger.log("GROQ_ERROR", {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }
}

export default new ReasoningService();
