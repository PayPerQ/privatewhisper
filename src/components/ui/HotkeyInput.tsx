import React, { useRef, useState, useCallback } from "react";
import { Keyboard, Loader2 } from "lucide-react";
import { formatHotkeyLabel } from "../../utils/hotkeys";

interface HotkeyInputProps {
  value: string;
  onSave: (key: string) => Promise<boolean>;
  isSaving?: boolean;
  disabled?: boolean;
  showGlobeOption?: boolean;
  className?: string;
}

// Valid Electron accelerator keys (function keys)
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
  // Use CommandOrControl for cross-platform (Cmd on Mac, Ctrl elsewhere)
  // Include metaKey (Cmd on Mac) in CommandOrControl
  if (e.ctrlKey || e.metaKey) modifiers.push("CommandOrControl");
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
  } else if (VALID_FUNCTION_KEYS.has(e.key)) {
    // Function keys use e.key directly (F1, F2, etc.)
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

  const handleGlobeSelect = useCallback(async () => {
    if (isSaving || disabled) return;
    setPendingKey("GLOBE");
    await onSave("GLOBE");
    setPendingKey(null);
  }, [isSaving, disabled, onSave]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      // Allow Tab for accessibility
      if (e.key === "Tab") {
        return;
      }

      e.preventDefault();

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

      // Show pending state
      setPendingKey(mappedKey);
      setIsListening(false);
      inputRef.current?.blur();

      // Try to save
      const success = await onSave(mappedKey);
      if (!success) {
        // Reset to previous value on failure
        setPendingKey(null);
      } else {
        setPendingKey(null);
      }
    },
    [isListening, isSaving, disabled, onSave],
  );

  const displayKey = pendingKey || value;
  const isActive = isListening || isSaving;
  const isGlobeSelected = displayKey === "GLOBE";

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
              {isListening ? "..." : formatHotkeyLabel(displayKey)}
            </kbd>
          )}
          <div>
            <p
              className={`text-sm font-medium ${isActive ? "text-primary" : "text-foreground"}`}
            >
              {isSaving
                ? "Registering..."
                : isListening
                  ? "Press any key or combination..."
                  : "Current hotkey"}
            </p>
            {!isActive && (
              <p className="text-xs text-muted-foreground">
                Click to change (supports Ctrl/Alt/Shift + key)
              </p>
            )}
          </div>
        </div>
        {!isActive && <Keyboard className="w-5 h-5 text-muted-foreground" />}
      </div>

      {/* Globe key option for macOS - can't be detected via keyboard events */}
      {showGlobeOption && (
        <button
          type="button"
          onClick={handleGlobeSelect}
          disabled={isSaving || disabled}
          className={`
            w-full p-3 rounded-lg border transition-all duration-200
            flex items-center justify-center gap-2 text-sm
            ${disabled ? "cursor-not-allowed opacity-60" : ""}
            ${
              isGlobeSelected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
            }
          `}
        >
          <span className="text-lg">🌐</span>
          <span>Use Globe key (fn)</span>
        </button>
      )}
    </div>
  );
}
