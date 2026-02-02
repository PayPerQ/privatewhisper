export type Platform = "darwin" | "win32" | "linux";

export type ValidationErrorCode =
  | "TOO_MANY_KEYS"
  | "NO_MODIFIER"
  | "SIMPLE_KEY"
  | "RESERVED"
  | "DUPLICATE";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: ValidationErrorCode;
}

const MODIFIERS = new Set(["Command", "Control", "Alt", "Shift", "Super"]);

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

export function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split("+");
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    if (MODIFIERS.has(part)) {
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
  if (hotkey === "GLOBE") {
    return { valid: true };
  }

  const parts = hotkey.split("+");

  if (parts.length > 3) {
    return {
      valid: false,
      error: "Shortcuts are limited to 3 keys",
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
          "Single-key shortcuts are not supported. Use a modifier (Ctrl, Cmd, Alt, Shift) + key combination.",
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

  const normalizedHotkey = normalizeHotkey(hotkey);
  const reserved = getReservedShortcuts(platform);
  const normalizedReserved = reserved.map(normalizeHotkey);

  if (normalizedReserved.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "This shortcut is reserved by the system",
      errorCode: "RESERVED",
    };
  }

  const normalizedExisting = existingHotkeys.map(normalizeHotkey);
  if (normalizedExisting.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "This shortcut is already in use",
      errorCode: "DUPLICATE",
    };
  }

  return { valid: true };
}

const MAC_RESERVED_SHORTCUTS = [
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
  "Command+B",
  "Command+I",
  "Command+U",
  "Command+Shift+T",
  "Command+=",
  "Command+-",
  "Command+Alt+F",
  "Command+Shift+F",
  "Fn+F11",
  "Fn+F12",
] as const;

const WINDOWS_RESERVED_SHORTCUTS = [
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
  "Alt+Tab",
  "Alt+F4",
  "Alt+Left",
  "Alt+Right",
  "Alt+PrintScreen",
  "F5",
  "F11",
  "Home",
  "End",
  "PrintScreen",
] as const;

const LINUX_RESERVED_SHORTCUTS = [
  "Control+C",
  "Control+V",
  "Control+X",
  "Control+Z",
  "Control+Shift+Z",
  "Control+A",
  "Control+S",
  "Control+P",
  "Control+N",
  "Control+W",
  "Control+Q",
  "Control+F",
  "Control+H",
  "Control+R",
  "Control+T",
  "Control+D",
  "Control+L",
  "Control+Alt+T",
  "Control+Alt+Delete",
  "Control+Alt+F1",
  "Control+Alt+F2",
  "Control+Alt+F3",
  "Control+Alt+F4",
  "Control+Alt+F5",
  "Control+Alt+F6",
  "Control+Alt+F7",
  "Control+Alt+F8",
  "Super",
  "Alt+Tab",
  "Alt+Shift+Tab",
  "Alt+F4",
  "Alt+F2",
  "Super+L",
  "Super+D",
  "Super+E",
  "Super+A",
  "Super+S",
  "Control+Alt+Left",
  "Control+Alt+Right",
  "Control+Alt+Up",
  "Control+Alt+Down",
  "Super+PageUp",
  "Super+PageDown",
  "Super+Up",
  "Super+Down",
  "Super+Left",
  "Super+Right",
  "Alt+F7",
  "Alt+F8",
  "Alt+F9",
  "Alt+F10",
  "Print",
  "Shift+Print",
  "Alt+Print",
  "Control+Print",
  "Control+Shift+Print",
  "Control+Alt+Backspace",
  "Control+Alt+Escape",
] as const;

export function getReservedShortcuts(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RESERVED_SHORTCUTS;
    case "win32":
      return WINDOWS_RESERVED_SHORTCUTS;
    case "linux":
      return LINUX_RESERVED_SHORTCUTS;
    default:
      return [];
  }
}

const MAC_RECOMMENDED = [
  "Globe key — easiest option, just press once",
  "Ctrl + Option — two modifiers, rarely conflicts with other apps",
  "Option + Cmd — comfortable to press together",
  "Shift + F9 or other function key combinations",
] as const;

const WINDOWS_RECOMMENDED = [
  "Ctrl + Win — two modifiers, rarely conflicts with other apps",
  "Ctrl + Alt — common pattern, easy to press",
  "Ctrl + Shift + key — familiar from other apps",
  "Shift + F9 or other function key combinations",
] as const;

const LINUX_RECOMMENDED = [
  "Ctrl + Super — two modifiers, rarely conflicts",
  "Ctrl + Shift + key — familiar pattern",
  "Super + Shift + key — if Ctrl is inconvenient",
  "Shift + F9 or other function key combinations",
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

const MAC_EXAMPLES = [
  "GLOBE",
  "Control+Alt+Space",
  "Alt+Command+D",
  "Control+Shift+K",
  "Shift+F9",
] as const;

const WINDOWS_EXAMPLES = [
  "Control+Alt+Space",
  "Control+Shift+K",
  "Alt+F7",
  "Shift+F9",
] as const;

const LINUX_EXAMPLES = [
  "Super+Shift+Space",
  "Control+Shift+K",
  "Alt+F7",
  "Shift+F9",
] as const;

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

export const VALIDATION_RULES = [
  "Uses a modifier + key combination (e.g., Ctrl+Space) or Globe/Fn key",
  "Single keys alone are not allowed (except function keys F1-F24)",
  "Uses three keys or fewer",
  "Does not mix left and right versions of the same modifier",
  "Is not already used by another PPQ Whisper shortcut",
  "Is not a reserved system shortcut",
] as const;
