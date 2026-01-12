import {
  BaseReasoningService,
  ReasoningConfig,
  ReasoningResult,
  ReasoningUsage,
} from "./BaseReasoningService";
import { withRetry, createApiRetryStrategy } from "../utils/retry";
import { API_ENDPOINTS, TOKEN_LIMITS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";
import apiKeyManager from "../utils/ApiKeyManager";

const debugLogger = createDebugLogger("reasoning");

export const DEFAULT_PROMPTS = {
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
    config: ReasoningConfig = {},
  ) {
    const systemPrompt = `You are a dictation post-processor. Your task is to clean up speech-to-text transcriptions.

Input: Raw transcribed text from voice dictation, which may contain:
- Grammar and punctuation errors
- Transcription mistakes (misheard words, homophones)
- Filler words or false starts
- Missing or incorrect capitalization

Your task:
1. Fix grammar, punctuation, and capitalization
2. Correct obvious transcription errors based on context
3. Remove filler words (um, uh, like) and false starts
4. Preserve the speaker's intended meaning, tone, and style
5. Do NOT add, interpret, or respond to the content

Output: Only the corrected text. No explanations, comments, or formatting.`;
    const userPrompt = `${text} /no_think`;

    const maxTokens =
      config.maxTokens ??
      this.calculateMaxTokens(
        text.length,
        TOKEN_LIMITS.MIN_TOKENS,
        TOKEN_LIMITS.MAX_TOKENS,
        TOKEN_LIMITS.TOKEN_MULTIPLIER,
      );

    return {
      model: model || "qwen/qwen3-32b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: config.temperature ?? 0.3,
      max_tokens: maxTokens,
      provider: {
        order: ["groq"],
      },
      reasoning: {
        enabled: false,
      },
    };
  }

  private extractUsage(payload: any): ReasoningUsage | undefined {
    const usage = payload?.usage;
    if (!usage || typeof usage !== "object") return undefined;

    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    const { prompt_tokens, completion_tokens, total_tokens } = usage;

    if (
      prompt_tokens == null &&
      completion_tokens == null &&
      total_tokens == null
    ) {
      return undefined;
    }

    return {
      promptTokens: num(prompt_tokens),
      outputTokens: num(completion_tokens),
      totalTokens: num(total_tokens),
    };
  }

  private extractProvider(payload: any): string | undefined {
    if (typeof payload?.provider === "string") {
      return payload.provider;
    }
    if (typeof payload?.provider_name === "string") {
      return payload.provider_name;
    }
    if (typeof payload?.model_provider === "string") {
      return payload.model_provider;
    }
    return undefined;
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
    config: ReasoningConfig = {},
  ): Promise<ReasoningResult> {
    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    if (!text || !text.trim()) {
      throw new Error("No text provided for reasoning");
    }

    this.isProcessing = true;

    try {
      const apiKey = await apiKeyManager.getApiKey();

      const requestBody = this.buildRequestBody(text, modelId, config);

      void debugLogger.log("PPQ_REASONING_REQUEST", {
        endpoint: API_ENDPOINTS.PPQ_CHAT,
        model: requestBody.model,
        maxTokens: requestBody.max_tokens,
        temperature: requestBody.temperature,
        textLength: text.length,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
      });

      const response = await withRetry(async () => {
        const res = await fetch(API_ENDPOINTS.PPQ_CHAT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        // void debugLogger.log("PPQ_REASONING_RESPONSE", {
        //   status: res.status,
        //   statusText: res.statusText,
        //   ok: res.ok,
        //   headers: Object.fromEntries(res.headers.entries()),
        // });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          void debugLogger.log("PPQ_REASONING_ERROR_RESPONSE", {
            status: res.status,
            errorText: errorText.substring(0, 500),
          });
          const message =
            errorText || res.statusText || "PPQ API request failed";
          const error: any = new Error(message);
          error.response = res;
          throw error;
        }

        return res.json();
      }, createApiRetryStrategy());

      void debugLogger.log("PPQ_RESPONSE_RECEIVED", {
        model: requestBody.model,
        hasChoices: Array.isArray(response?.choices),
        choicesCount: response?.choices?.length ?? 0,
        firstChoice: JSON.stringify(response?.choices?.[0])?.substring(0, 500),
      });

      const cleaned = this.extractResponseText(response);

      if (!cleaned) {
        void debugLogger.log("PPQ_EMPTY_RESPONSE", {
          model: requestBody.model,
          rawResponse: JSON.stringify(response).substring(0, 1000),
        });
        throw new Error("PPQ API returned an empty response");
      }

      return {
        text: cleaned,
        usage: this.extractUsage(response),
        model: requestBody.model,
        provider:
          this.extractProvider(response) ?? requestBody?.provider?.order?.[0],
      };
    } catch (error) {
      void debugLogger.log("PPQ_ERROR", {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }
}

export default new ReasoningService();
