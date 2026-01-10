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

// Keys that cannot be used as hotkeys
const DISALLOWED_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Enter",
  "Backspace",
]);

// Modifier keys for combinations
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * Maps a keyboard event to a hotkey string that Electron can register.
 * Supports modifier combinations like Ctrl+N, Shift+Space, etc.
 */
export function mapKeyboardEventToHotkey(
  e: React.KeyboardEvent,
): string | null {
  const key = e.key;
  const code = e.code;

  // Build modifier prefix
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("CommandOrControl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  // Note: e.metaKey is Cmd on Mac, but we use CommandOrControl for cross-platform

  // If only modifier keys are pressed, don't register
  if (MODIFIER_KEYS.has(key)) {
    return null;
  }

  // Map the main key
  let mappedKey: string;
  if (code === "Backquote" || key === "`") {
    mappedKey = "`";
  } else if (key === "Escape") {
    mappedKey = "Esc";
  } else if (key === " ") {
    mappedKey = "Space";
  } else if (key === "fn" || key === "Function") {
    // Globe key can't have modifiers
    if (modifiers.length > 0) return null;
    mappedKey = "GLOBE";
  } else if (key.length === 1) {
    // Single character keys - uppercase for letters
    mappedKey = /^[a-zA-Z]$/.test(key) ? key.toUpperCase() : key;
  } else if (VALID_FUNCTION_KEYS.has(key)) {
    mappedKey = key;
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

      // Check for disallowed standalone keys
      if (
        DISALLOWED_KEYS.has(e.key) &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
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
