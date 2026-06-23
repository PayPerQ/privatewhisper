# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 0.1.29

### Added

- Platform-specific hotkey guards and suggestions
- Force download option for latest updates
- Fn key can now be combined with other modifier keys
- Hotkey system documentation (`docs/HOTKEY_RULES.md`)

### Changed

- Renamed application to **Private Whisper** (display name / productName; bundle id `ai.ppq.voice` and local data directory unchanged)
- Renamed application to PPQ Whisper
- Updated README with hotkey section, platform notes, and architecture diagram
- Complete CHANGELOG with version history from 0.1.2 onwards

## [0.1.28] - 2026-02-02

### Fixed

- LLM prompt now detects concatenated words
- Bluetooth cold start issue by removing proactive built-in mic cache invalidation on devicechange events

## [0.1.27] - 2026-02-01

### Changed

- Simplified streaming finalized handler by removing interim text rescue logic that caused duplicate transcriptions

### Fixed

- Better API key persistence

## [0.1.26] - 2026-01-31

### Fixed

- Prevent orphan PCM captures and suppress spurious errors on rapid push-to-talk

## [0.1.25] - 2026-01-30

### Fixed

- Removed warm pool for websockets
- Aggressively kill CharacterPalette to prevent emoji popover on macOS
- Better persistence for audio device selection
- Fully block Globe key emoji popover with multi-layer suppression

## [0.1.24] - 2026-01-29

### Added

- WebSocket reconnection with warm connection pooling
- Audio device recovery for Bluetooth resilience
- macOS Globe key system-level suppression

### Fixed

- Pull default microphone on startup

## [0.1.23] - 2026-01-28

### Fixed

- Microphone staying focused issue
- Globe key registry issues

## [0.1.22] - 2026-01-28

### Changed

- Register new hotkey before unregistering old one to prevent no-hotkey gap on failure
- Log restore failures in loadSavedHotkey

### Fixed

- Space key registration
- Reorder streaming shutdown to send finalize after PCM flush, preventing tail-end audio loss

## [0.1.21] - 2026-01-28

### Added

- GLOBE keycode mapping

### Changed

- Dismiss emoji picker on Globe key press
- Clean up audio resources on quit

## [0.1.20] - 2026-01-27

### Fixed

- Stream cleanup issues

## [0.1.19] - 2026-01-26

### Added

- getUserMedia fallback for audio capture

### Fixed

- Handle audio device disconnect gracefully

### Changed

- Consolidated keycode maps

## [0.1.18] - 2026-01-25

### Fixed

- Chatwoot environment variable in release scripts

## [0.1.17] - 2026-01-23

### Added

- Chatwoot support widget for in-app support

### Changed

- Updated system prompts for better transcription cleanup

## [0.1.16] - 2026-01-20

### Fixed

- Use bash shell for .env creation on Windows CI
- Add log URLs to environment in build

## [0.1.15] - 2026-01-19

### Changed

- Improved system prompt for transcription cleanup

## [0.1.14] - 2026-01-19

### Fixed

- WebSocket URL configuration

## [0.1.13] - 2026-01-18

### Added

- Separate Input Monitoring permissions (macOS)

### Fixed

- UI state for permission dialogs
- Access permissions check
- Close to tray behavior

## [0.1.12] - 2026-01-17

### Added

- Cancel recording button

## [0.1.11] - 2026-01-16

### Changed

- Updated Deepgram supported languages list

### Fixed

- Updater evaluation logic
- Compound hotkey not working for push-to-talk mode
- Hotkey instructions text wrapping

## [0.1.10] - 2026-01-15

### Fixed

- Handle hotkey listening during early registration
- Added IPC handler to open accessibility settings

## [0.1.9] - 2026-01-15

### Fixed

- IPC handler for accessibility settings

## [0.1.8] - 2026-01-14

### Fixed

- Platform-specific accessibility permission issues

## [0.1.7] - 2026-01-12

### Added

- Updated support options

## [0.1.6] - 2026-01-12

### Added

- Real-time streaming transcription via WebSocket

### Changed

- Extract shared audio utilities
- Clean up streaming transcription service

### Fixed

- Cold start problem for transcription
- Socket not closing when user doesn't speak

## [0.1.5] - 2026-01-11

### Added

- Allow Globe key press registration during onboarding
- Streaming transcription (first pass)

## [0.1.4] - 2026-01-09

### Changed

- Centralize update install timeout handling in main process
- Improved hotkey registration and onboarding steps
- Improved hotkey error handling and toast accuracy
- DRY up menu templates

### Fixed

- Hotkey-related issues
- Missing persistApiKey dependency in nextStep callback
- Onboarding navigation
- Hotkey duplicate detection
- Hold-to-talk sync
- Cmd+V paste support

## [0.1.3] - 2026-01-09

### Added

- Supabase logging integration
- Auto-update improvements

## [0.1.2] - 2026-01-08

### Added

- Initial public release
- Cloud-powered transcription via PPQ API
- Global hotkey support (Globe key on macOS, Ctrl+Win on Windows/Linux)
- Toggle and hold-to-talk modes
- Automatic paste to active application
- Local transcription history (SQLite)
- AI cleanup pipeline for formatting
- Auto-update support via GitHub releases
