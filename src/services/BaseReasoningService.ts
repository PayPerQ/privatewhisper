export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getReasoningPrompt(text: string): string {
    const DEFAULT_PROMPT = `Clean up the following dictated text by fixing grammar, punctuation, and formatting. Output ONLY the cleaned text without any explanations, options, or commentary:\n\n{{text}}`;

    let prompt = DEFAULT_PROMPT;

    if (typeof window !== 'undefined' && window.localStorage) {
      const customPrompts = window.localStorage.getItem('customPrompts');
      if (customPrompts) {
        try {
          const parsed = JSON.parse(customPrompts);
          prompt = parsed.regular || DEFAULT_PROMPT;
        } catch {
          // Use default prompt on parse error
        }
      }
    }

    return prompt.replace(/\{\{text\}\}/g, text);
  }

  /**
   * Calculate optimal max tokens based on input length
   */
  protected calculateMaxTokens(
    textLength: number,
    minTokens = 100,
    maxTokens = 2048,
    multiplier = 2
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }

  /**
   * Check if service is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Process text with reasoning
   */
  abstract processText(
    text: string,
    modelId: string,
    config?: ReasoningConfig
  ): Promise<string>;
}