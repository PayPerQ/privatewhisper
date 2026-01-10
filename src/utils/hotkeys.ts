/**
 * Formats a hotkey string for display.
 * Handles modifier combinations like "CommandOrControl+N" -> "Ctrl+N" or "Cmd+N"
 */
export function formatHotkeyLabel(hotkey?: string | null): string {
  if (!hotkey || hotkey.trim() === "") {
    return "`";
  }

  if (hotkey === "GLOBE") {
    return "🌐 Globe";
  }

  // Check if it's a modifier combination
  if (hotkey.includes("+")) {
    const isMac =
      typeof navigator !== "undefined" && /Mac|Darwin/.test(navigator.platform);
    const parts = hotkey.split("+");

    const formattedParts = parts.map((part) => {
      switch (part) {
        case "CommandOrControl":
          return isMac ? "Cmd" : "Ctrl";
        case "Alt":
          return isMac ? "Option" : "Alt";
        case "Shift":
          return "Shift";
        case "Space":
          return "Space";
        default:
          return part;
      }
    });

    return formattedParts.join("+");
  }

  return hotkey;
}
