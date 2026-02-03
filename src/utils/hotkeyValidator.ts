export type Platform = "darwin" | "win32" | "linux";

export type ValidationErrorCode =
  | "TOO_MANY_KEYS"
  | "NO_MODIFIER"
  | "MODIFIER_ONLY"
  | "SIMPLE_KEY"
  | "RESERVED"
  | "DUPLICATE"
  | "LEFT_RIGHT_CONFLICT";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: ValidationErrorCode;
}

// Base modifier names (used for normalization and sorting)
const BASE_MODIFIERS = new Set(["Command", "Control", "Alt", "Shift", "Super"]);

// Modifiers that have Left/Right variants that cannot be mixed
const LEFT_RIGHT_MODIFIERS = ["Control", "Alt", "Shift", "Command"] as const;

// All valid modifier forms including left/right variants
const MODIFIERS = new Set([
  ...BASE_MODIFIERS,
  // Left variants
  "LeftControl",
  "ControlLeft",
  "LeftAlt",
  "AltLeft",
  "LeftShift",
  "ShiftLeft",
  "LeftCommand",
  "CommandLeft",
  // Right variants
  "RightControl",
  "ControlRight",
  "RightAlt",
  "AltRight",
  "RightShift",
  "ShiftRight",
  "RightCommand",
  "CommandRight",
]);

const SPECIAL_KEYS = new Set([
  "GLOBE",
  "Fn",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  "Esc",
  "Space",
  "Tab",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Left",
  "Right",
  "Up",
  "Down",
  "Insert",
  "Delete",
  "PrintScreen",
]);

const STANDALONE_ALLOWED = new Set(
  Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
);

// Normalize left/right modifier variants to base form
function normalizeModifier(mod: string): string {
  for (const base of LEFT_RIGHT_MODIFIERS) {
    if (
      mod === `Left${base}` ||
      mod === `${base}Left` ||
      mod === `Right${base}` ||
      mod === `${base}Right`
    ) {
      return base;
    }
  }
  return mod;
}

export function normalizeHotkey(hotkey: string): string {
  if (!hotkey) return "";
  const parts = hotkey.split("+");
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    if (MODIFIERS.has(part)) {
      // Normalize left/right variants to base form for comparison
      modifiers.push(normalizeModifier(part));
    } else if (BASE_MODIFIERS.has(part)) {
      modifiers.push(part);
    } else {
      keys.push(part);
    }
  }

  const modifierOrder = ["Control", "Command", "Alt", "Shift", "Super"];
  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));

  return [...modifiers, ...keys].join("+");
}

export function validateHotkey(
  hotkey: string,
  platform: Platform,
  existingHotkeys: string[] = [],
): ValidationResult {
  if (!hotkey) {
    return {
      valid: false,
      error: "No hotkey provided",
      errorCode: "SIMPLE_KEY",
    };
  }

  if (hotkey === "GLOBE") {
    return { valid: true };
  }

  const parts = hotkey.split("+");

  if (parts.length > 3) {
    return {
      valid: false,
      error: "Hotkeys are limited to 3 keys",
      errorCode: "TOO_MANY_KEYS",
    };
  }

  const hasModifier = parts.some((p) => MODIFIERS.has(p));

  if (parts.length === 1 && !hasModifier) {
    const key = parts[0];
    if (!STANDALONE_ALLOWED.has(key)) {
      return {
        valid: false,
        error:
          "Single-key hotkeys are not supported. Use a modifier (Ctrl, Cmd, Alt, Shift) + key combination.",
        errorCode: "SIMPLE_KEY",
      };
    }
  }

  const hasSpecialKey = parts.some((p) => SPECIAL_KEYS.has(p));

  if (!hasModifier && !hasSpecialKey) {
    return {
      valid: false,
      error:
        "Must include a modifier key (Ctrl, Cmd, Alt, Shift) or special key",
      errorCode: "NO_MODIFIER",
    };
  }

  // Check if it's modifier-only (no non-modifier key)
  // Modifier-only hotkeys (e.g., Ctrl+Alt) are not supported because:
  // 1. Electron's globalShortcut requires at least one non-modifier key
  // 2. Works consistently across macOS, Windows, and Linux
  const nonModifierKeys = parts.filter((p) => !MODIFIERS.has(p));
  if (nonModifierKeys.length === 0) {
    return {
      valid: false,
      error:
        "Modifier-only hotkeys are not supported. Add a key like Space, K, or F9 (e.g., Ctrl+Option+Space)",
      errorCode: "MODIFIER_ONLY",
    };
  }

  // Check for left/right modifier mixing (e.g., LeftCtrl + RightCtrl)
  for (const mod of LEFT_RIGHT_MODIFIERS) {
    const hasLeft = parts.some((p) => p === `Left${mod}` || p === `${mod}Left`);
    const hasRight = parts.some(
      (p) => p === `Right${mod}` || p === `${mod}Right`,
    );
    if (hasLeft && hasRight) {
      return {
        valid: false,
        error: `Cannot use both Left and Right ${mod} in the same hotkey`,
        errorCode: "LEFT_RIGHT_CONFLICT",
      };
    }
  }

  const normalizedHotkey = normalizeHotkey(hotkey);
  const forbidden = getForbiddenHotkeys(platform);
  const normalizedForbidden = forbidden.map(normalizeHotkey);

  if (normalizedForbidden.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: `"${hotkey}" is reserved by the system`,
      errorCode: "RESERVED",
    };
  }

  const normalizedExisting = existingHotkeys.map(normalizeHotkey);
  if (normalizedExisting.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "This hotkey is already in use",
      errorCode: "DUPLICATE",
    };
  }

  return { valid: true };
}

// macOS forbidden hotkeys - must match documentation in ppq-keyboard-shortcuts.md
const MAC_FORBIDDEN_HOTKEYS = [
  // Common Cmd hotkeys
  "Command+C",
  "Command+V",
  "Command+X",
  "Command+Z",
  "Command+Shift+Z",
  "Command+A",
  "Command+Q",
  "Command+W",
  "Command+R",
  "Command+T",
  "Command+S",
  "Command+P",
  "Command+N",
  "Command+M",
  "Command+H",
  "Command+F",
  "Command+G",
  "Command+Shift+G",
  "Command+,",
  // Navigation and Control
  "Command+Left",
  "Command+Right",
  "Command+Up",
  "Command+Down",
  "Command+Shift+Left",
  "Command+Shift+Right",
  "Command+Shift+Up",
  "Command+Shift+Down",
  "Command+Control+F",
  "Command+Space",
  "Command+Alt+Space",
  "Command+Shift+3",
  "Command+Shift+4",
  "Command+Shift+5",
  "Command+Alt+Esc",
  "Command+Alt+D",
  "Command+Delete",
  "Command+Shift+Delete",
  "Command+Shift+Q",
  // Browser and Editor Style hotkeys
  "Command+B",
  "Command+I",
  "Command+U",
  "Command+Shift+T",
  "Command+=",
  "Command+-",
  "Command+Alt+F",
  "Command+Shift+F",
  // Function keys (F11/F12 are Mission Control/Show Desktop on macOS)
  "F11",
  "F12",
] as const;

// Windows forbidden hotkeys - must match documentation in ppq-keyboard-shortcuts.md
const WINDOWS_FORBIDDEN_HOTKEYS = [
  // Ctrl hotkeys
  "Control+C",
  "Control+V",
  "Control+X",
  "Control+Z",
  "Control+Y",
  "Control+R",
  "Control+A",
  "Control+F",
  "Control+G",
  "Control+O",
  "Control+S",
  "Control+P",
  "Control+N",
  "Control+T",
  "Control+W",
  "Control+Home",
  "Control+End",
  "Control+Alt+Delete",
  "Control+Shift+Escape",
  "Control+Backspace",
  "Control+Delete",
  "Control+K",
  "Control+Shift+T",
  "Control+=",
  "Control+-",
  // Alt hotkeys
  "Alt+Tab",
  "Alt+F4",
  "Alt+Left",
  "Alt+Right",
  "Alt+PrintScreen",
  // Function and Navigation keys
  "F5",
  "F11",
  "Home",
  "End",
  "PrintScreen",
  // Windows key hotkeys
  "Super+E",
  "Super+R",
  "Super+L",
  "Super+D",
  "Super+Tab",
  "Super+I",
  "Super+S",
  "Super+X",
  "Super+P",
  "Super+Q",
  "Super+U",
  "Super+B",
  "Super+Up",
  "Super+Down",
] as const;

// Linux forbidden hotkeys - must match documentation in ppq-keyboard-shortcuts.md
const LINUX_FORBIDDEN_HOTKEYS = [
  // Ctrl hotkeys
  "Control+C",
  "Control+V",
  "Control+X",
  "Control+Z",
  "Control+Y",
  "Control+R",
  "Control+A",
  "Control+F",
  "Control+G",
  "Control+O",
  "Control+S",
  "Control+P",
  "Control+N",
  "Control+T",
  "Control+W",
  "Control+Q",
  "Control+H",
  "Control+L",
  "Control+Home",
  "Control+End",
  "Control+Backspace",
  "Control+Delete",
  "Control+Shift+T",
  "Control+Shift+Q",
  "Control+=",
  "Control+-",
  // Ctrl+Alt hotkeys (Desktop Environment)
  "Control+Alt+T",
  "Control+Alt+Delete",
  "Control+Alt+L",
  "Control+Alt+Escape",
  "Control+Alt+Left",
  "Control+Alt+Right",
  "Control+Alt+Up",
  "Control+Alt+Down",
  "Control+Alt+D",
  "Control+Alt+S",
  "Control+Alt+Tab",
  // Alt hotkeys
  "Alt+Tab",
  "Alt+Shift+Tab",
  "Alt+F1",
  "Alt+F2",
  "Alt+F4",
  "Alt+F7",
  "Alt+F8",
  "Alt+F9",
  "Alt+F10",
  "Alt+Space",
  "Alt+Left",
  "Alt+Right",
  "Alt+PrintScreen",
  // Super key hotkeys
  "Super",
  "Super+A",
  "Super+D",
  "Super+L",
  "Super+S",
  "Super+M",
  "Super+Tab",
  "Super+Space",
  "Super+Left",
  "Super+Right",
  "Super+Up",
  "Super+Down",
  "Super+Shift+Left",
  "Super+Shift+Right",
  "Super+Shift+Up",
  "Super+Shift+Down",
  "Super+PageUp",
  "Super+PageDown",
  "Super+Home",
  "Super+End",
  // Function and Navigation keys
  "F1",
  "F5",
  "F11",
  "PrintScreen",
  "Shift+PrintScreen",
  "Super+PrintScreen",
] as const;

export function getForbiddenHotkeys(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_FORBIDDEN_HOTKEYS;
    case "win32":
      return WINDOWS_FORBIDDEN_HOTKEYS;
    case "linux":
      return LINUX_FORBIDDEN_HOTKEYS;
    default:
      return [];
  }
}

// Alias for backwards compatibility
export const getReservedHotkeys = getForbiddenHotkeys;

// Recommended patterns per platform - must match documentation in ppq-keyboard-shortcuts.md
const MAC_RECOMMENDED = [
  "Fn (Globe key) — if you have a built-in Mac keyboard",
  "Ctrl + Option + key — two modifiers rarely conflict with other apps",
  "Option + Cmd + key — comfortable to press together",
  "Shift + F9 or other function key combinations",
] as const;

const WINDOWS_RECOMMENDED = [
  "Shift + F9 — default, simple and reliable",
  "Ctrl + Alt + key — common pattern, easy to press",
  "Ctrl + Shift + key — widely supported",
] as const;

const LINUX_RECOMMENDED = [
  "Shift + F9 — default, simple and reliable",
  "Ctrl + Shift + key — widely supported",
  "Super + Shift + key — if Ctrl is inconvenient",
] as const;

export function getRecommendedPatterns(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RECOMMENDED;
    case "win32":
      return WINDOWS_RECOMMENDED;
    case "linux":
      return LINUX_RECOMMENDED;
    default:
      return [];
  }
}

// Valid examples per platform - must match documentation in ppq-keyboard-shortcuts.md
const MAC_EXAMPLES = [
  "GLOBE",
  "Control+Shift+K",
  "Alt+F7",
  "Control+Space",
  "Control+Alt+M",
  "Shift+F9",
] as const;

const WINDOWS_EXAMPLES = [
  "Shift+F9",
  "Control+Shift+K",
  "Alt+F7",
  "Control+Space",
  "Control+Alt+M",
] as const;

const LINUX_EXAMPLES = [
  "Shift+F9",
  "Control+Shift+K",
  "Control+Super+K",
  "Super+Shift+R",
  "Control+Shift+Space",
] as const;

// Note: Alt+F7 is reserved on Linux (used for window move), so it's not in Linux examples

export function getValidExamples(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_EXAMPLES;
    case "win32":
      return WINDOWS_EXAMPLES;
    case "linux":
      return LINUX_EXAMPLES;
    default:
      return [];
  }
}

// Validation rules displayed to users - must match documentation in ppq-keyboard-shortcuts.md
export const VALIDATION_RULES = [
  "Uses three keys or fewer",
  "Includes at least one modifier (Ctrl, Cmd, Alt, Shift) plus a non-modifier key",
  "Does not use both the left and right version of the same modifier",
  "Does not match another PPQ hotkey already in use",
  "Is not a reserved system hotkey",
] as const;
