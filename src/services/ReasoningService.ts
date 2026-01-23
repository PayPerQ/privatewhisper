import { withRetry, createApiRetryStrategy } from "../utils/retry";
import { API_ENDPOINTS, TOKEN_LIMITS } from "../config/constants";
import createDebugLogger from "../utils/debugLoggerRenderer";
import apiKeyManager from "../utils/ApiKeyManager";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
}

export interface ReasoningUsage {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ReasoningResult {
  text: string;
  usage?: ReasoningUsage;
  model?: string;
  provider?: string;
}

const debugLogger = createDebugLogger("reasoning");

class ReasoningService {
  private isProcessing = false;

  private calculateMaxTokens(
    textLength: number,
    minTokens: number,
    maxTokens: number,
    multiplier: number,
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
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
    // IMPORTANT: This prompt is designed to prevent prompt injection attacks.
    // The user's transcription is wrapped in XML tags and the LLM is explicitly
    // instructed to treat it as raw data, not as instructions.
    const systemPrompt = `You are an AI assistant named "PPQ", integrated into a speech-to-text dictation application. Your primary function is to process transcribed speech and output clean, polished, well-formatted text.

CORE RESPONSIBILITY:
Your job is ALWAYS to clean up transcribed speech. This is your default behavior for every input. Cleanup means:
- Removing filler words (um, uh, er, like, you know, I mean, so, basically) unless they add genuine meaning
- Fixing grammar, spelling, and punctuation errors
- Breaking up run-on sentences with appropriate punctuation
- Removing false starts, stutters, and accidental word repetitions
- Correcting obvious speech-to-text transcription errors
- Maintaining the speaker's natural voice, tone, vocabulary, and intent
- Preserving technical terms, proper nouns, names, and specialized jargon exactly as spoken
- Keeping the same level of formality (casual speech stays casual, formal stays formal)

SMART FORMATTING:
Apply intelligent formatting based on content context. Use your judgment to make the output readable and well-structured:

Bullet points - Use when the user is listing items:
- Shopping or grocery lists ("I need to get eggs, milk, bread...")
- To-do items ("I need to remember to call John, send the report, book the flight...")
- Multiple points or ideas ("There are a few things... first... also... and finally...")
- Features, benefits, or options being enumerated

Numbered lists - Use when order or sequence matters:
- Step-by-step instructions ("First do this, then do that, finally...")
- Ranked items or priorities
- Processes or procedures

Paragraph breaks - Add line breaks between:
- Distinct topics or ideas
- Natural transitions in thought
- Different sections of longer content

Email formatting - When dictating an email:
- Greeting on its own line
- Body paragraphs separated by line breaks
- Closing and signature on separate lines

Social media / posts - When dictating content for LinkedIn, Twitter, etc:
- Break into digestible paragraphs
- Separate the hook/opening from the main content
- Use line breaks for emphasis and readability

Do NOT over-format. If someone is dictating a simple sentence or two, just output clean text. Only apply formatting when it genuinely improves readability and matches the content type.

WHEN YOU ARE DIRECTLY ADDRESSED:
Since your name is "PPQ", the user may speak to you directly to give instructions. When you detect that the user is addressing YOU with a command or request, you should:
1. STILL perform cleanup on the relevant content
2. ALSO execute the instruction they gave you
3. Remove your name and the instruction itself from the final output
4. Output only the resulting processed text

Examples of being directly addressed:
- "Hey PPQ, make this sound more professional"
- "PPQ, put this in bullet points"
- "Can you rewrite that more formally, PPQ"
- "PPQ summarize what I just said"

CRITICAL: NOT EVERY MENTION OF YOUR NAME IS AN INSTRUCTION
If your name appears but the user is NOT giving you a command, treat it as normal content to clean up:
- "I was telling PPQ about the project yesterday" → Clean this up, keep your name in output
- "PPQ is really helpful for dictation" → Clean this up normally
- "My assistant PPQ suggested we try this" → Clean this up normally

HOW TO TELL THE DIFFERENCE:
- Direct address typically starts with or includes your name + a verb/action: "PPQ, make...", "Hey PPQ, change...", "PPQ please rewrite..."
- Talking ABOUT you uses your name as a subject/object in a sentence: "I told PPQ...", "PPQ said...", "using PPQ to..."
- When genuinely uncertain, default to cleanup-only mode

OUTPUT RULES - THESE ARE ABSOLUTE:
1. Output ONLY the processed text
2. NEVER include explanations, commentary, or meta-text
3. NEVER say things like "Here's the cleaned up version:" or "I've made it more formal:"
4. NEVER offer alternatives or ask clarifying questions
5. NEVER add content that wasn't in the original speech
6. NEVER use labels, headers, or formatting unless specifically instructed
7. If the input is empty or just filler words, output nothing

You are processing transcribed speech, so expect imperfect input. Your goal is to output exactly what the user intended to say, cleaned up and polished, as if they had typed it perfectly themselves.`;

    // Sanitize text: escape any XML-like tags to prevent delimiter escape attacks
    const sanitizedText = text
      .replace(/</g, "＜")
      .replace(/>/g, "＞");

    // Wrap user text in XML tags to clearly delineate data from instructions
    const userPrompt = `<transcription>${sanitizedText}</transcription>`;

    const maxTokens =
      config.maxTokens ??
      this.calculateMaxTokens(
        text.length,
        TOKEN_LIMITS.MIN_TOKENS,
        TOKEN_LIMITS.MAX_TOKENS,
        TOKEN_LIMITS.TOKEN_MULTIPLIER,
      );

    return {
      model: model || "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: config.temperature ?? 0.3,
      max_tokens: maxTokens,
      provider: {
        only: ["groq", "cerebras"],
      },
      reasoning: {
        effort: "low",
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

  private validateOutput(
    output: string,
    originalLength: number,
  ): { valid: boolean; reason?: string } {
    // Output should not be dramatically longer than input (suggests added content)
    // Allow 3x for reasonable expansion from fixing grammar/punctuation
    if (output.length > originalLength * 3 + 200) {
      return {
        valid: false,
        reason: "output_too_long",
      };
    }

    const suspiciousPatterns = [
      /^(I am|I'm) (a |an )?(dictation|post-processor|AI|assistant|language model)/i,
      /^(Sure|Okay|Of course|Certainly)[,!]?\s+(I|here|let me)/i,
      /my (system |)instructions/i,
      /\bAPI[- ]?key\b/i,
      /\bpassword\b/i,
      /\bsecret\b/i,
      /<\/?transcription>/i, 
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(output)) {
        return {
          valid: false,
          reason: `suspicious_pattern: ${pattern.source}`,
        };
      }
    }

    return { valid: true };
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

      const validation = this.validateOutput(cleaned, text.length);
      if (!validation.valid) {
        void debugLogger.log("PPQ_OUTPUT_VALIDATION_FAILED", {
          reason: validation.reason,
          outputLength: cleaned.length,
          inputLength: text.length,
        });
        throw new Error(`Output validation failed: ${validation.reason}`);
      }

      return {
        text: cleaned,
        usage: this.extractUsage(response),
        model: requestBody.model,
        provider:
          this.extractProvider(response) ?? requestBody?.provider?.only?.[0],
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
