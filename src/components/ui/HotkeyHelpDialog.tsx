import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion";
import {
  type Platform,
  getForbiddenHotkeys,
} from "../../utils/hotkeyValidator";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { useFnKeyMode } from "../../hooks/useFnKeyMode";

interface HotkeyHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: Platform;
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
  if (platform === "darwin") {
    return [
      "Use a modifier key (Ctrl, Option, Shift) combined with another key, or use the Globe key",
      "Maximum of 3 keys in a combination",
      "Cannot mix left and right versions of the same modifier",
      "Cannot use forbidden system hotkeys (listed below)",
    ];
  }

  return [
    "Use a modifier key (Ctrl, Alt, Shift) combined with another key",
    "Maximum of 3 keys in a combination",
    "Cannot mix left and right versions of the same modifier",
    "Cannot use forbidden system hotkeys (listed below)",
  ];
}

function getFunctionKeyNote(platform: Platform): string | null {
  if (platform === "darwin") {
    return 'On Mac laptops, F1-F12 keys control brightness, volume, etc. by default. To use them as hotkeys, hold the Fn key while pressing, or enable "Use F1, F2, etc. keys as standard function keys" in System Settings > Keyboard.';
  }
  return null;
}

export function HotkeyHelpDialog({
  open,
  onOpenChange,
  platform,
}: HotkeyHelpDialogProps) {
  const forbidden = getForbiddenHotkeys(platform);
  const requirements = getRequirements(platform);
  const fnNote = getFunctionKeyNote(platform);
  const platformName = getPlatformName(platform);
  const { requiresFn } = useFnKeyMode();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hotkey Help</DialogTitle>
          <DialogDescription>
            Troubleshooting and requirements for setting your dictation hotkey
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">
            If you're having trouble setting a hotkey, check the requirements
            below. Some key combinations are reserved by your operating system
            and can't be used. Try one of the suggested hotkeys, or use a
            modifier key (like Ctrl or Shift) with another key.
          </p>

          <Accordion
            type="single"
            collapsible
            defaultValue="requirements"
            className="w-full"
          >
            {/* Requirements */}
            <AccordionItem value="requirements" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-muted/50 rounded-t-lg">
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
            <AccordionItem value="forbidden" className="border rounded-lg mt-2">
              <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline hover:bg-muted/50 rounded-t-lg">
                <span className="font-medium">
                  Forbidden hotkeys ({forbidden.length})
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    These hotkeys are reserved by {platformName} and cannot be
                    used by PPQ Whisper:
                  </p>
                  <div className="max-h-60 overflow-y-auto">
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
      </DialogContent>
    </Dialog>
  );
}
