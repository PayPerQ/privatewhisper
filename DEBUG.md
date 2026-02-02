# PPQ Whisper Debugging Guide

Use debug logging when you need deeper insight into the microphone, transcription, or reasoning pipeline.

## Enabling Debug Mode

### Option 1 – CLI flag

```bash
# macOS
/Applications/PPQ\ Whisper.app/Contents/MacOS/PPQ\ Whisper --debug

# Windows
"C:\Program Files\PPQ Whisper\PPQ Whisper.exe" --debug
```

### Option 2 – Environment variable

```bash
# macOS / Linux
export PPQWHISPER_DEBUG=true
open /Applications/PPQ\ Whisper.app

# Windows (PowerShell)
$env:PPQWHISPER_DEBUG="true"
Start-Process "C:\Program Files\PPQ Whisper\PPQ Whisper.exe"
```

Debug mode is off by default. Remove the flag/variable to disable it.

## Where Logs Live

- **macOS** – `~/Library/Application Support/ppq-whisper/logs/debug-<timestamp>.log`
- **Windows** – `%APPDATA%\ppq-whisper\logs\debug-<timestamp>.log`
- **Linux** – `~/.config/ppq-whisper/logs/debug-<timestamp>.log`

Each launch in debug mode creates a new timestamped file.

## What Gets Logged

| Stage                   | Details captured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hotkey & permissions    | Registration status, mic/accessibility prompts, failure reasons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audio capture           | Device metadata, recording duration, blob size, optimization results.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| PPQ transcription       | Endpoint used, payload size, HTTP status, error body if non-200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ReasoningService        | Provider routing, API choices (`/responses` vs `/chat`), retries, timing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Clipboard / database    | Paste attempts, SQLite insert status, error stacks if operations fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pipeline timing summary | Per-dictation timings (all in ms):<br>- `audioOptimizeMs`: browser-side audio conversion (start of resample → optimized blob ready).<br>- `transcriptionRequestMs`: wire time for transcription POST (before fetch → HTTP response arrives).<br>- `transcriptionDecodeMs`: parse/prepare transcription response (response arrival → text extracted).<br>- `transcriptionTotalMs`: start of dictation → transcription text ready (includes optimize + network + decode).<br>- `reasoningMs`: AI cleanup request/response if used (send text → cleaned text returned).<br>- `pasteMs`: issuing the paste keystroke (command sent → paste call completes).<br>- Totals: `toTranscriptionMs` (start → transcription text ready), `toFinalTextMs` (start → final cleaned text ready), `roundTripMs` (start → final measured stage, defaults to end of paste).<br>- `startedAtMs` is the anchor timestamp for the run; useful to correlate events, not for perf. |

All entries are timestamped and marked with emojis (`🎤`, `🤖`, `📡`, etc.) to make scanning easier.

## Reading the Logs

Common entries:

- `🎤 AUDIO_RECORDER_START` / `STOP` – recording lifecycle. Zero-length blobs usually mean the microphone is muted or in use elsewhere.
- `📡 TRANSCRIPTION_REQUEST` – shows which base URL was used and the payload size.
- `❌ TRANSCRIPTION_ERROR` – includes HTTP status and truncated response text. Check for expired API keys or unsupported models.
- `🤖 REASONING_*` – selection + response for PPQ clean-up. Failures include provider-specific error messages and request IDs.
- `📋 PASTE_ERROR` – indicates accessibility permission problems.

## Troubleshooting Cheatsheet

| Message                             | Action                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `Microphone Access Denied`          | Re-run onboarding or go to System Settings → Privacy & Security → Microphone. |
| `401 Unauthorized` in transcription | The PPQ API key is missing/invalid. Update `.env` and restart.                |
| `Only HTTPS endpoints are allowed`  | Custom base URLs must be HTTPS or localhost.                                  |
| `Paste failed`                      | Re-grant Accessibility permission and restart the app.                        |

## Sharing Logs

1. Enable debug mode and reproduce the issue.
2. Open the most recent file from the log directory above.
3. Redact API keys if they appear (the app tries to avoid logging them).
4. Attach the relevant excerpt when filing an issue or emailing support.
