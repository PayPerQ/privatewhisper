/**
 * Check if a hotkey string contains a function key (F1-F24)
 */
export function hasFunctionKey(hotkey: string): boolean {
  if (!hotkey) return false;
  const parts = hotkey.split("+");
  return parts.some((part) => /^F([1-9]|1[0-9]|2[0-4])$/.test(part));
}

/**
 * Formats a hotkey string for display.
 * Handles modifier combinations like "CommandOrControl+N" -> "Ctrl+N" or "Cmd+N"
 *
 * @param hotkey - The hotkey string to format
 * @param options.requiresFn - If true, prepend "Fn+" for function key hotkeys (macOS)
 */
export function formatHotkeyLabel(
  hotkey?: string | null,
  options?: { requiresFn?: boolean },
): string {
  if (!hotkey || hotkey.trim() === "") {
    return "`";
  }

  if (hotkey === "GLOBE") {
    return "🌐 Globe";
  }

  const isMac =
    typeof navigator !== "undefined" && /Mac|Darwin/.test(navigator.platform);
  const isWindows =
    typeof navigator !== "undefined" && /Win/.test(navigator.platform);

  // Check if we need to prepend Fn+ for function keys on macOS
  const shouldPrependFn =
    isMac && options?.requiresFn && hasFunctionKey(hotkey);

  // Check if it's a modifier combination
  if (hotkey.includes("+")) {
    const parts = hotkey.split("+");

    const formattedParts = parts.map((part) => {
      switch (part) {
        case "Control":
          return "Ctrl";
        case "Command":
          return isMac ? "Cmd" : "Ctrl";
        case "CommandOrControl":
          return isMac ? "Cmd" : "Ctrl";
        case "Alt":
          return isMac ? "Option" : "Alt";
        case "Shift":
          return "Shift";
        case "Space":
          return "Space";
        case "Super":
          return isWindows ? "Win" : "Super";
        default:
          return part;
      }
    });

    const formatted = formattedParts.join("+");
    return shouldPrependFn ? `Fn+${formatted}` : formatted;
  }

  // Single key (like just "F9")
  return shouldPrependFn ? `Fn+${hotkey}` : hotkey;
}
