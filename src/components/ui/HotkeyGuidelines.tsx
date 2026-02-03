import {
  type Platform,
  getValidExamples,
  normalizeHotkey,
} from "../../utils/hotkeyValidator";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { useFnKeyMode } from "../../hooks/useFnKeyMode";

interface HotkeyGuidelinesProps {
  platform: Platform;
  currentHotkey: string;
  onSelect: (hotkey: string) => Promise<boolean>;
  disabled?: boolean;
  className?: string;
}

export function HotkeyGuidelines({
  platform,
  currentHotkey,
  onSelect,
  disabled = false,
  className = "",
}: HotkeyGuidelinesProps) {
  const examples = getValidExamples(platform);

  // Check if Fn key is required for function keys on macOS
  const { requiresFn } = useFnKeyMode();

  const normalizedCurrent = normalizeHotkey(currentHotkey || "");

  const isActive = (hotkey: string) => {
    return normalizeHotkey(hotkey) === normalizedCurrent;
  };

  return (
    <div
      className={`rounded-lg border border-border bg-muted/20 overflow-hidden ${className}`}
    >
      <div className="px-4 py-3">
        <p className="text-sm font-medium mb-3">Suggested hotkeys</p>
        <div className="flex flex-wrap gap-2">
          {examples.map((example, i) => {
            const active = isActive(example);
            return (
              <button
                key={i}
                type="button"
                disabled={disabled || active}
                onClick={() => void onSelect(example)}
                className={`
                  inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-mono
                  transition-all duration-150
                  ${
                    active
                      ? "bg-primary text-primary-foreground border-2 border-primary shadow-sm"
                      : "bg-background border border-border text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary cursor-pointer"
                  }
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                `}
              >
                {formatHotkeyLabel(example, { requiresFn })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
