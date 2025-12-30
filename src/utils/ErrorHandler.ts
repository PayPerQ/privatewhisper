export const ErrorCodes = {
  API_KEY_MISSING: "API_KEY_MISSING",
  AUDIO_EMPTY: "AUDIO_EMPTY",
  AUDIO_RECORDING_FAILED: "AUDIO_RECORDING_FAILED",
  CLIPBOARD_READ_FAILED: "CLIPBOARD_READ_FAILED",
  CLIPBOARD_WRITE_FAILED: "CLIPBOARD_WRITE_FAILED",
  CLIPBOARD_PASTE_FAILED: "CLIPBOARD_PASTE_FAILED",
  TRANSCRIPTION_FAILED: "TRANSCRIPTION_FAILED",
  REASONING_FAILED: "REASONING_FAILED",
  DATABASE_ERROR: "DATABASE_ERROR",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  MICROPHONE_NOT_FOUND: "MICROPHONE_NOT_FOUND",
  MICROPHONE_IN_USE: "MICROPHONE_IN_USE",
  HOTKEY_REGISTRATION_FAILED: "HOTKEY_REGISTRATION_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  code: ErrorCode | string;
  context: Record<string, unknown>;
  isRecoverable: boolean;

  constructor(
    code: ErrorCode | string,
    message: string,
    context: Record<string, unknown> = {},
    isRecoverable = true,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.context = context;
    this.isRecoverable = isRecoverable;
  }
}
