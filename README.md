# PPQ Whisper

PPQ Whisper is a lightweight Electron desktop app that turns any text field into a dictation box. Press a single hotkey, speak, and the app streams your audio to PPQ Cloud for transcription and clean-up, then pastes the result wherever your cursor was.

## Why Teams Use PPQ Whisper

- **Cloud-first dictation** – Streams audio to PPQ Cloud for fast, consistent transcriptions.
- **Automatic paste + history** – Captured text is pasted into the active app and stored locally in SQLite.
- **AI clean-up pipeline** – PPQ cleans punctuation, lists, and formatting automatically.
- **Cross-platform** – macOS, Windows, and Linux packages powered by Electron + Vite.
- **Flexible hotkeys** – Globe key on macOS, customizable hotkeys on all platforms.
- **Ops-friendly** – Toggle `PPQVOICE_DEBUG=true` to write rich logs to the user data directory.
- **Zero local-model overhead** – No llama.cpp builds, Python dependencies, or multi-GB downloads.

## Quick Start

```bash
git clone https://github.com/PayPerQ/ppq-voice-private.git
cd ppq-whisper
npm install
cp env.example .env   # add your PPQ API key
npm run dev           # launches Vite + Electron with hot reload
```

Want the production build? Run `npm start` to launch Electron with the prebuilt renderer bundle.

## Configuration

### `.env` keys

| Key              | Required | Description                                                                                                      |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `PPQ_API_KEY`    | Yes      | Your PPQ API key used for transcription and clean-up.                                                            |
| `PPQVOICE_DEBUG` | No       | `true` writes detailed logs to `~/Library/Application Support/ppq-whisper/logs` (platform-specific equivalents). |

All other preferences (language, hotkeys, audio cues) can be changed inside the Control Panel UI. They persist in `localStorage` and synchronize with the renderer.

## Hotkeys

### Default Hotkeys by Platform

| Platform | Default Hotkey |
| -------- | -------------- |
| macOS    | Globe (Fn) key |
| Windows  | Ctrl+Win       |
| Linux    | Ctrl+Super     |

### Hotkey Modes

- **Toggle** (default): Press once to start, press again to stop
- **Hold-to-talk**: Hold to record, release to stop (compound hotkeys only)

### Platform Notes

**macOS:**

- Globe key works without Input Monitoring permission
- Single-key hotkeys (like backtick) require Input Monitoring permission
- Compound hotkeys (Ctrl+K) work without extra permissions

**Windows/Linux:**

- No special permissions required
- Super key (Windows key) supported in combinations

For full hotkey documentation, see [docs/HOTKEY_RULES.md](docs/HOTKEY_RULES.md).

## NPM Scripts

| Script              | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `npm run dev`       | Runs Vite + Electron with live reload.                               |
| `npm start`         | Launches Electron in production mode (expects a built renderer).     |
| `npm run build`     | Builds the renderer and packages the desktop app for the current OS. |
| `npm run pack`      | Prepares an unsigned directory build (great for quick installs).     |
| `npm run lint`      | Runs ESLint on the renderer source (`src/`).                         |
| `npm run typecheck` | Runs TypeScript type checking.                                       |
| `npm run format`    | Runs Prettier to format code.                                        |
| `npm run clean`     | Sweeps `dist/`, `src/dist/`, and resets the dev SQLite DB.           |

## Building Installers

```bash
npm run pack                # unsigned build (all platforms)
npm run build:mac           # macOS DMG/ZIP
npm run build:win           # Windows NSIS + portable
npm run build:linux         # Linux AppImage + deb
```

Artifacts land in `dist/`. On macOS the unsigned app lives at `dist/mac-arm64/PPQ Whisper.app`; Windows gets `dist/win-unpacked/PPQ Whisper.exe`.

## Permissions

PPQ Whisper needs two macOS permissions (Windows/Linux equivalents are requested automatically):

1. **Microphone** – required for recording audio.
2. **Accessibility** – needed so the app can paste transcriptions for you.
3. **Input Monitoring** (macOS only) – required only for single-key hotkeys (not needed for Globe key or compound hotkeys).

You can revisit permissions in **Control Panel → Settings → Permissions** if something stops working. The onboarding wizard also walks through granting them.

## Architecture

```
Renderer (React/Vite)
 ├─ audioManager.js ........ handles recording, streaming to cloud APIs
 ├─ ReasoningService.ts .... routes clean-up to PPQ reasoning models
 └─ UI (App.jsx, SettingsPage.tsx, OnboardingFlow.tsx, etc.)

Main process (Electron)
 ├─ main.js ................ bootstraps managers + windows
 ├─ hotkeyManager.js ....... global hotkey registration
 ├─ globeKeyManager.js ..... macOS Globe/Fn key native listener
 ├─ database.js ............ wraps better-sqlite3 for transcription history
 └─ updater.js ............. electron-updater wiring for GitHub releases
```

## Troubleshooting

| Symptom                            | Fix                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "PPQ key not found"                | Confirm `.env` + Control Panel → PPQ Cloud has a valid value.                                                                                                                                  |
| Nothing pastes after transcription | Re-request Accessibility permission from Settings, then relaunch the app.                                                                                                                      |
| Hotkey not working                 | Check if another app is using the same hotkey. Try a different hotkey in Settings.                                                                                                             |
| Need extra logs                    | Run `PPQVOICE_DEBUG=true npm start` (or `npm run dev -- --debug`). Logs go to `%APPDATA%/ppq-whisper/logs`, `~/Library/Application Support/ppq-whisper/logs`, or `~/.config/ppq-whisper/logs`. |
| Updater stuck                      | Use Control Panel → Settings → Updates → "Download Update" to retry, or grab the latest release from GitHub.                                                                                   |

## Documentation

- [Hotkey Rules & Platform Support](docs/HOTKEY_RULES.md)
- [Technical Notes (CLAUDE.md)](CLAUDE.md)

## Support & Feedback

- Email: [support@ppq.ai](mailto:support@ppq.ai)
- Issues: [github.com/PayPerQ/ppq-voice-private/issues](https://github.com/PayPerQ/ppq-voice-private/issues)
