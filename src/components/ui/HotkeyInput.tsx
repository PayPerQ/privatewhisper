import React, { useRef, useState, useCallback, useEffect } from "react";
import { Keyboard, Loader2 } from "lucide-react";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { validateHotkey, type Platform } from "../../utils/hotkeyValidator";
import { useFnKeyMode } from "../../hooks/useFnKeyMode";

interface HotkeyInputProps {
  value: string;
  onSave: (key: string) => Promise<boolean>;
  isSaving?: boolean;
  disabled?: boolean;
  showGlobeOption?: boolean;
  className?: string;
}

// Valid Electron accelerator keys (function keys)
// Used for both e.key and e.code checking
const VALID_FUNCTION_KEYS = new Set([
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "F13",
  "F14",
  "F15",
  "F16",
  "F17",
  "F18",
  "F19",
  "F20",
  "F21",
  "F22",
  "F23",
  "F24",
]);

// Keys that cannot be used as hotkeys (by code)
const DISALLOWED_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "Enter",
  "Backspace",
]);

// Map e.code to Electron accelerator key names (layout-independent)
const CODE_TO_KEY: Record<string, string> = {
  Backquote: "`",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Digit0: "0",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Escape: "Esc",
};

/**
 * Maps a keyboard event to a hotkey string that Electron can register.
 * Uses e.code for layout-independent mapping (e.g., Shift+1 stays "Shift+1" not "Shift+!").
 * Supports modifier combinations like Ctrl+N, Cmd+K, Shift+Space, etc.
 */
export function mapKeyboardEventToHotkey(
  e: React.KeyboardEvent,
): string | null {
  const code = e.code;

  // Reject standalone modifier keys and disallowed keys
  if (DISALLOWED_CODES.has(code)) {
    return null;
  }

  // Build modifier prefix
  const modifiers: string[] = [];
  // Map Ctrl and Cmd/Meta as separate modifiers so the user can
  // register Ctrl-based hotkeys independently of Cmd on macOS.
  // On macOS: metaKey = Command
  // On Windows/Linux: metaKey = Super (Windows key)
  const isMac = /Mac|Darwin/.test(navigator.platform);
  if (e.ctrlKey) modifiers.push("Control");
  if (e.metaKey) {
    modifiers.push(isMac ? "Command" : "Super");
  }
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");

  // Map the main key using e.code for layout independence
  let mappedKey: string;

  // Check code-to-key map first (handles symbols and special keys)
  if (CODE_TO_KEY[code]) {
    mappedKey = CODE_TO_KEY[code];
  } else if (code.startsWith("Key") && code.length === 4) {
    // Letter keys: KeyA -> A, KeyB -> B, etc.
    mappedKey = code.charAt(3).toUpperCase();
  } else if (VALID_FUNCTION_KEYS.has(code)) {
    // Function keys: e.code is "F1", "F2", etc. (more reliable than e.key)
    mappedKey = code;
  } else if (VALID_FUNCTION_KEYS.has(e.key)) {
    // Fallback: check e.key for function keys
    mappedKey = e.key;
  } else if (e.key === "fn" || e.key === "Function") {
    // Globe key can't have modifiers
    if (modifiers.length > 0) return null;
    mappedKey = "GLOBE";
  } else {
    // Reject keys that won't work as Electron accelerators
    return null;
  }

  // Combine modifiers with key
  if (modifiers.length > 0) {
    return [...modifiers, mappedKey].join("+");
  }
  return mappedKey;
}

export default function HotkeyInput({
  value,
  onSave,
  isSaving = false,
  disabled = false,
  showGlobeOption = false,
  className = "",
}: HotkeyInputProps) {
  const inputRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isListeningRef = useRef(isListening);
  const isSavingRef = useRef(isSaving);
  const disabledRef = useRef(disabled);

  // Check if Fn key is required for function keys on macOS
  const { requiresFn } = useFnKeyMode();

  // Keep refs in sync with state/props for use in IPC callback
  useEffect(() => {
    isListeningRef.current = isListening;
    isSavingRef.current = isSaving;
    disabledRef.current = disabled;
  }, [isListening, isSaving, disabled]);

  // Notify main process when entering/exiting listening mode
  // This suppresses dictation triggering while user is selecting a hotkey
  useEffect(() => {
    window.electronAPI?.setHotkeyListeningMode?.(isListening);
    return () => {
      // Ensure we exit listening mode when component unmounts
      if (isListening) {
        window.electronAPI?.setHotkeyListeningMode?.(false);
      }
    };
  }, [isListening]);

  // Track if globe key is pending (pressed but not yet released)
  // This allows Fn+F9 to register as F9 instead of GLOBE
  const globePendingRef = useRef(false);

  // Cancel any pending globe key selection (called when user presses another key)
  const cancelGlobeSelection = useCallback(() => {
    globePendingRef.current = false;
  }, []);

  // Listen for globe key down/up via IPC when in listening mode (macOS only)
  // Uses key-up detection: only save GLOBE if Fn was pressed and released without any other key
  useEffect(() => {
    if (!showGlobeOption) return;

    const handleGlobeKeyDetected = () => {
      // Only process if we're currently listening for hotkey input
      if (!isListeningRef.current || isSavingRef.current || disabledRef.current)
        return;

      // Mark globe as pending - will be confirmed on key-up if no other key was pressed
      globePendingRef.current = true;
    };

    const handleGlobeKeyReleased = async () => {
      // Only process if we're currently listening and globe was pending
      if (
        !isListeningRef.current ||
        isSavingRef.current ||
        disabledRef.current ||
        !globePendingRef.current
      ) {
        globePendingRef.current = false;
        return;
      }

      // Globe key was pressed and released without any other key - save GLOBE
      globePendingRef.current = false;
      setPendingKey("GLOBE");
      setIsListening(false);
      inputRef.current?.blur();

      await onSave("GLOBE");
      setPendingKey(null);
    };

    const cleanupDetected = window.electronAPI?.onGlobeKeyDetected?.(
      handleGlobeKeyDetected,
    );
    const cleanupReleased = window.electronAPI?.onGlobeKeyReleased?.(
      handleGlobeKeyReleased,
    );

    return () => {
      cleanupDetected?.();
      cleanupReleased?.();
      globePendingRef.current = false;
    };
  }, [showGlobeOption, onSave]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      // Allow Tab for accessibility
      if (e.key === "Tab") {
        return;
      }

      e.preventDefault();
      setValidationError(null);

      // Cancel any pending globe key selection - user is pressing another key
      // This allows Fn+F9 to register as F9 instead of GLOBE
      cancelGlobeSelection();

      // Only process when listening
      if (!isListening || isSaving || disabled) {
        return;
      }

      // Check for disallowed standalone keys (modifier-only presses handled in mapKeyboardEventToHotkey)
      if (
        DISALLOWED_CODES.has(e.code) &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey
      ) {
        return;
      }

      const mappedKey = mapKeyboardEventToHotkey(e);
      if (!mappedKey) {
        return;
      }

      // Validate against forbidden hotkeys
      const platform = (window.electronAPI?.getPlatform?.() ??
        "darwin") as Platform;
      const validation = validateHotkey(mappedKey, platform);

      if (!validation.valid) {
        setValidationError(validation.error ?? "Invalid hotkey");
        setIsListening(false);
        inputRef.current?.blur();
        return;
      }

      // Show pending state
      setPendingKey(mappedKey);
      setIsListening(false);
      inputRef.current?.blur();

      // Try to save, then clear pending state regardless of outcome
      await onSave(mappedKey);
      setPendingKey(null);
    },
    [isListening, isSaving, disabled, onSave, cancelGlobeSelection],
  );

  const displayKey = pendingKey || value;
  const isActive = isListening || isSaving;

  return (
    <div className={`space-y-3 ${className}`}>
      <div
        ref={inputRef}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onFocus={() => !disabled && !isSaving && setIsListening(true)}
        onBlur={() => setIsListening(false)}
        className={`
          w-full p-4 rounded-xl border-2 transition-all duration-200
          flex items-center justify-between
          ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
          ${
            isActive
              ? "border-primary bg-primary/5 shadow-lg"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
          }
        `}
      >
        <div className="flex items-center gap-3">
          {isSaving ? (
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : (
            <kbd
              className={`
              px-4 py-2 rounded-lg font-mono text-xl font-semibold shadow-sm min-w-[60px] text-center
              ${
                isListening
                  ? "bg-primary text-primary-foreground"
                  : "bg-white border-2 border-primary/30 text-primary"
              }
            `}
            >
              {isListening
                ? "..."
                : formatHotkeyLabel(displayKey, { requiresFn })}
            </kbd>
          )}
          <div>
            <p
              className={`text-sm font-medium ${isActive ? "text-primary" : "text-foreground"}`}
            >
              {isSaving
                ? "Registering..."
                : isListening
                  ? showGlobeOption
                    ? "Press any key, combination, or Globe..."
                    : "Press any key or combination..."
                  : "Current hotkey"}
            </p>
            {!isActive && (
              <p className="text-xs text-muted-foreground">
                {showGlobeOption
                  ? "Click to change (supports Globe, Ctrl/Alt/Shift + key)"
                  : "Click to change (supports Ctrl/Alt/Shift + key)"}
              </p>
            )}
          </div>
        </div>
        {!isActive && <Keyboard className="w-5 h-5 text-muted-foreground" />}
      </div>

      {validationError && (
        <p className="text-sm text-destructive">{validationError}</p>
      )}
    </div>
  );
}
