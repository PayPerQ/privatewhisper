# PPQ Whisper – Assistant Technical Notes

Use this doc whenever you need quick architectural context while working on the repo.

## 1. What PPQ Whisper Does

PPQ Whisper is an Electron 36 desktop app (React 19 renderer) that:

1. Listens for a global hotkey (default `\``).
2. Records audio via the browser's `MediaRecorder`.
3. Streams the audio blob to PPQ's API (cloud-only) for transcription.
4. Optionally runs the transcript through PPQ's reasoning models for clean-up.
5. Pastes the final text wherever the user's cursor sits and stores it in a local SQLite DB.

There is **no** local inferencing, Python bridge, or llama.cpp dependency anymore. Everything runs in the renderer + Electron main process.

## 2. High-Level Architecture

```
Renderer (React/Vite)
 ├─ audioManager.js ........ handles recording, sending to cloud APIs, reasoning pipeline
 ├─ ReasoningService.ts .... routes clean-up to PPQ reasoning models
 ├─ UI (App.jsx, SettingsPage.tsx, OnboardingFlow.tsx, etc.)
 └─ Hooks (useSettings, usePermissions, useLocalStorage)

Preload (preload.js)
 └─ Exposes whitelisted IPC methods (clipboard, db, settings, updater, etc.)

Main process (Electron)
 ├─ main.js ................ bootstraps managers + windows
 ├─ ipcHandlers.js ......... registers IPC endpoints used by the renderer
 ├─ clipboard.js / tray.js / windowManager.js / menuManager.js
 ├─ database.js ............ wraps better-sqlite3 for transcription history
 ├─ environment.js ......... loads and persists API keys (.env under userData)
 └─ updater.js ............. electron-updater wiring for GitHub releases
```

## 3. Key Flows

### Dictation

1. `AudioManager.startRecording()` – uses `navigator.mediaDevices.getUserMedia`.
2. On stop → converts blob to WAV → `optimizeAudio` (16 kHz mono) → `processWithPPQAPI`.
3. Sends `multipart/form-data` to `API_ENDPOINTS.PPQ_TRANSCRIPTION` (default `https://api.ppq.ai/audio/transcriptions` or overridden via `PPQVOICE_PPQ_BASE_URL`).
4. On success, runs `processTranscription`, optionally piping through `ReasoningService`.
5. Calls `window.electronAPI.pasteText` and `saveTranscription`.

### ReasoningService

- Uses PPQ API exclusively – a single PPQ API key is cached via `SecureCache`.
- Calls `https://api.ppq.ai/chat/completions` with Whisper output + clean-up prompts.
- Extracts the first `choices[].message.content` text payload and returns it to `audioManager`.
- Logs every stage via `window.electronAPI.logReasoning` for debugging.

## 4. Settings + Storage

`src/hooks/useSettings.ts` centralises everything. Keys currently stored in `localStorage`:

- `preferredLanguage` – used to pre-fill the PPQ transcription request.
- `ppqApiKey` – cached in the renderer (also mirrored to `.env` via `environment.js`).
- `dictationKey` – user's chosen hotkey.
- `hotkeyMode` – toggle vs hold-to-talk behavior.
- `audioCuesEnabled` – enable/disable start/stop sounds.

## 5. Permissions & Windows

- `usePermissions.ts` checks mic + accessibility.
- `WindowManager` spawns two BrowserWindows:
  - Main dictation overlay (frameless, always-on-top, 240×240).
  - Control Panel (1200×800, hidden until needed).
- Menus/Tray live in `menuManager.js` and `tray.js`.

## 6. Database Schema

`src/helpers/database.js` uses better-sqlite3. Table definition (see file for migrations):

```sql
CREATE TABLE IF NOT EXISTS transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Records are appended via IPC (`db-save-transcription`). There’s a cleanup helper in `cleanup.js` that wipes the dev DB under `~/Library/Application Support/ppq-voice/transcriptions-dev.db` (platform-specific path equivalents exist for Windows/Linux).

## 7. Debugging

- Set `PPQVOICE_DEBUG=true` (in `.env` or env var) **or** run the app with `--debug`.
- Logs live in `userData/logs/debug-*.log` – the path is printed on startup when debug mode is on.
- You can also run `npm run dev -- --debug` to flip the same switch.

## 8. Building & Releases

- Renderer build: `npm run build:renderer`.
- Desktop packaging: `electron-builder` via `npm run build`, `build:mac`, etc.
- GitHub auto-updates: configured in `electron-builder.json` + `src/updater.js` (owner `HeroTools`, repo `ppq-voice`).

## 9. Things Removed Compared to OpenWhispr

- No `whisper.js`, `pythonInstaller`, `modelManager`, or llama.cpp tooling.
- No local model download UI (`WhisperModelPicker`, `ProcessingModeSelector`, `LocalReasoningService`, etc.).
- All docs now assume cloud workflows only.

Use this doc whenever you need quick bearings—everything else lives in the source files noted above.
