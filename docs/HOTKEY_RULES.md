# Hotkey System Documentation

This document describes how hotkey selection and registration works in Private Whisper across different platforms.

## Core Architecture

The hotkey system uses **Electron's `globalShortcut` API** for cross-platform keyboard registration. Key files:

| File                                | Purpose                            |
| ----------------------------------- | ---------------------------------- |
| `src/helpers/hotkeyManager.js`      | Global hotkey registration         |
| `src/helpers/globeKeyManager.js`    | macOS Globe/Fn key native listener |
| `src/utils/hotkeyValidator.ts`      | Validation + forbidden hotkeys     |
| `src/components/ui/HotkeyInput.tsx` | UI hotkey picker                   |
| `src/hooks/useSettings.ts`          | Persistent storage                 |

---

## Platform-Specific Defaults

| Platform | Default Hotkey   |
| -------- | ---------------- |
| macOS    | `GLOBE` (Fn key) |
| Windows  | `Shift+F9`       |
| Linux    | `Shift+F9`       |

---

## macOS-Specific Features

### Globe/Fn Key Support

- Uses a **native binary** (`macos-globe-listener`) to detect the Globe/Fn key
- Arch-specific binaries: `macos-globe-listener-arm64` or `macos-globe-listener-x86_64`
- Runs in "globe-only" mode by default — **no Input Monitoring permission required**
- Communicates via stdout events: `FN_DOWN`, `FN_UP`

### F-Key Behavior

- macOS defaults to F-keys controlling media (brightness, volume, etc.)
- The app checks system setting via `defaults read NSGlobalDomain com.apple.keyboard.fnState`
- UI displays "Fn+F9" vs "F9" depending on user's system preference

### Input Monitoring Permission

- **Required for:** Single simple-key hotkeys (e.g., backtick `` ` ``)
- **NOT required for:** Globe key, compound hotkeys (Ctrl+K, Shift+Space)

### Known Issue: Emoji Picker

- Pressing Globe normally triggers the emoji picker
- The app calls `disableGlobeKeyEmojiPicker()` to suppress this when Globe is the hotkey

---

## Windows-Specific Features

- **Super key** = Windows key — supported in combinations like `Super+E`
- No special permissions required
- Standard Electron `globalShortcut` works directly

---

## Linux-Specific Features

- **Super key** works normally
- No special permissions required
- Desktop environment hotkeys are reserved (Ctrl+Alt+T for terminal, etc.)

---

## Validation Rules

The `hotkeyValidator.ts` enforces these rules:

| Rule                                                      | Error Code            |
| --------------------------------------------------------- | --------------------- |
| Maximum 3 keys                                            | `TOO_MANY_KEYS`       |
| Requires modifier + non-modifier (except F1-F24)          | `SIMPLE_KEY`          |
| Cannot mix left/right variants (e.g., LeftCtrl+RightCtrl) | `LEFT_RIGHT_CONFLICT` |
| Cannot use modifier-only hotkeys (e.g., Ctrl+Alt alone)   | `MODIFIER_ONLY`       |
| Cannot use reserved system hotkeys                        | `RESERVED`            |

---

## Forbidden Hotkeys (Blocked)

Each platform has 40-60+ reserved hotkeys that **cannot** be used:

### macOS

```
Cmd+C, Cmd+V, Cmd+X, Cmd+Z, Cmd+A, Cmd+S, Cmd+Q, Cmd+W, Cmd+N, Cmd+O,
Cmd+P, Cmd+F, Cmd+H, Cmd+M, Cmd+Tab, Cmd+Space, Cmd+Shift+3, Cmd+Shift+4,
Cmd+Shift+5, Cmd+Option+Esc, F11, F12, Control+Up, Control+Down,
Control+Left, Control+Right, etc.
```

### Windows

```
Ctrl+Alt+Delete, Alt+Tab, Alt+F4, Super+E, Super+R, Super+D, Super+L,
Ctrl+Shift+Escape, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z, Ctrl+A, Ctrl+S,
Ctrl+P, Ctrl+F, Alt+Space, Super+Tab, Super+I, Super+A, etc.
```

### Linux

```
Ctrl+Alt+T (terminal), Ctrl+Alt+Delete, Super+D, Alt+Tab, Alt+F2,
Ctrl+Alt+Up/Down/Left/Right (workspaces), Ctrl+C, Ctrl+V, Ctrl+X,
Ctrl+Z, Ctrl+A, Ctrl+S, Super+L, Super+A, etc.
```

---

## Hotkey Modes

| Mode                 | Behavior                                        |
| -------------------- | ----------------------------------------------- |
| **Toggle** (default) | Press hotkey once to start, press again to stop |
| **Hold-to-talk**     | Hold hotkey to record, release to stop          |

**Platform Note:** Hold-to-talk is **macOS only**. Windows and Linux always use toggle mode due to platform limitations with key-up detection.

---

## What Doesn't Work / Limitations

1. **Single-key hotkeys on macOS** require Input Monitoring permission (except Globe key)
2. **F-keys** require Fn on most Macs (unless user changes system settings)
3. **Reserved system hotkeys** are blocked — attempting to use them shows an error
4. **Modifier-only hotkeys** (e.g., just Ctrl+Shift) are not allowed
5. **Hold-to-talk mode** is macOS only — Windows and Linux use toggle mode
6. **Globe key on non-Mac** — not available (Windows/Linux don't have this key)
7. **More than 3 keys** in a combination — not supported

---

## Registration Flow

1. User selects hotkey in `HotkeyInput` component
2. `validateHotkey()` checks against all rules
3. If valid, `window.electronAPI.updateHotkey(hotkey)` is called
4. Main process registers via `globalShortcut.register()`
5. Old hotkey is unregistered only after new one succeeds (prevents gaps)
6. Hotkey is persisted to `localStorage` as `dictationKey`

---

## Suggested Hotkeys by Platform

### macOS

- Globe (Fn) key — default, no permissions needed
- Ctrl+Space
- Cmd+Shift+D
- Option+Space

### Windows

- Shift+F9 — default, simple and reliable
- Ctrl+Shift+Space
- Ctrl+Alt+Space
- F9

### Linux

- Shift+F9 — default, simple and reliable
- Ctrl+Shift+Space
- Super+Shift+Space
- F9

---

## Technical Details

### Key Code Mapping

The app uses `e.code` for layout-independent mapping (works with AZERTY, QWERTY, etc.). Key codes are converted to Electron accelerator format:

- `KeyA` → `A`
- `Digit1` → `1`
- `ShiftLeft` → `Shift`
- `MetaLeft` → `Command` (macOS) or `Super` (Windows/Linux)

### IPC Communication

| Handler                      | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `update-hotkey`              | Register new hotkey                    |
| `set-hotkey-listening-mode`  | Pause dictation while selecting hotkey |
| `update-globe-listener-mode` | Configure Globe key listener mode      |
| `get-fn-key-mode`            | Check macOS F-key system preference    |

### Storage

- **Key:** `dictationKey` in `localStorage`
- **Mode:** `hotkeyMode` in `localStorage` (`"toggle"` or `"hold"`)
