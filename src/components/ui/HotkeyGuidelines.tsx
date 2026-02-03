import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion";
import {
  type Platform,
  getValidExamples,
  getForbiddenHotkeys,
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

function getPlatformName(platform: Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
  }
}

function getRequirements(platform: Platform): string[] {
  const base = [
    "Use a modifier key (Ctrl, Alt, Shift) combined with another key",
    "Maximum of 3 keys in a combination",
    "Cannot mix left and right versions of the same modifier",
    "Cannot use forbidden system hotkeys",
  ];

  if (platform === "darwin") {
    return [
      "Use a modifier key (Ctrl, Option, Shift) combined with another key, or use the Globe key",
      "Maximum of 3 keys in a combination",
      "Cannot mix left and right versions of the same modifier",
      "Cannot use forbidden system hotkeys",
    ];
  }

  return base;
}

function getFunctionKeyNote(platform: Platform): string | null {
  if (platform === "darwin") {
    return 'On Mac laptops, F1-F12 keys control brightness, volume, etc. by default. To use them as hotkeys, hold the Fn key while pressing, or enable "Use F1, F2, etc. keys as standard function keys" in System Settings > Keyboard.';
  }
  return null;
}

export function HotkeyGuidelines({
  platform,
  currentHotkey,
  onSelect,
  disabled = false,
  className = "",
}: HotkeyGuidelinesProps) {
  const examples = getValidExamples(platform);
  const forbidden = getForbiddenHotkeys(platform);
  const requirements = getRequirements(platform);
  const fnNote = getFunctionKeyNote(platform);
  const platformName = getPlatformName(platform);

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
      <Accordion type="single" collapsible className="w-full">
        {/* Suggested Hotkeys */}
        <AccordionItem value="suggested" className="border-b-0">
          <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-muted/50">
            <span className="font-medium">Suggested hotkeys</span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground mb-3">
              Click to select a hotkey:
            </p>
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
          </AccordionContent>
        </AccordionItem>

        {/* Requirements */}
        <AccordionItem value="requirements" className="border-b-0 border-t">
          <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-muted/50">
            <span className="font-medium">Requirements</span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Your hotkey must meet these requirements:
              </p>
              <ul className="space-y-1.5">
                {requirements.map((req, i) => (
                  <li
                    key={i}
                    className="text-xs text-foreground flex items-start gap-2"
                  >
                    <span className="text-muted-foreground">-</span>
                    <span>{req}</span>
                  </li>
                ))}
              </ul>

              {fnNote && (
                <div className="mt-3 p-2.5 rounded-md bg-amber-50 border border-amber-200">
                  <p className="text-xs text-amber-800">{fnNote}</p>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Forbidden Hotkeys */}
        <AccordionItem value="forbidden" className="border-t">
          <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-muted/50">
            <span className="font-medium">
              Forbidden hotkeys ({forbidden.length})
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                These hotkeys are reserved by {platformName} and cannot be used
                by PPQ Whisper:
              </p>
              <div className="max-h-80 overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {forbidden.map((hotkey, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center px-2 py-1 rounded bg-muted text-muted-foreground text-xs font-mono"
                    >
                      {formatHotkeyLabel(hotkey, { requiresFn })}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
