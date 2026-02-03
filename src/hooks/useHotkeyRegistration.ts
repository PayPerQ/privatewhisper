import { useState, useCallback } from "react";
import { useToast } from "../components/ui/Toast";
import { formatHotkeyLabel } from "../utils/hotkeys";

interface UseHotkeyRegistrationOptions {
  onSuccess?: (key: string) => void;
}

interface UseHotkeyRegistrationReturn {
  registerHotkey: (key: string) => Promise<boolean>;
  isRegistering: boolean;
  hasError: boolean;
  clearError: () => void;
}

/**
 * Shared hook for registering hotkeys with consistent error handling and toast feedback.
 * Used by both OnboardingFlow and SettingsPage to eliminate duplication.
 */
export function useHotkeyRegistration(
  options: UseHotkeyRegistrationOptions = {},
): UseHotkeyRegistrationReturn {
  const [isRegistering, setIsRegistering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const { toast } = useToast();

  const clearError = useCallback(() => {
    setHasError(false);
  }, []);

  const registerHotkey = useCallback(
    async (newKey: string): Promise<boolean> => {
      setIsRegistering(true);
      try {
        const result = await window.electronAPI?.updateHotkey(newKey);

        if (!result?.success) {
          setHasError(true);
          toast({
            title: "Hotkey Not Registered",
            description:
              result?.message ||
              "This key could not be registered. Please try a different key.",
            variant: "destructive",
          });
          return false;
        }

        setHasError(false);
        toast({
          title: "Hotkey Saved",
          description: `Now using ${formatHotkeyLabel(newKey)} for dictation`,
          variant: "success",
          duration: 2000,
        });

        options.onSuccess?.(newKey);
        return true;
      } catch (error) {
        console.error("Failed to register hotkey:", error);
        setHasError(true);
        toast({
          title: "Error",
          description: "Failed to register hotkey. Please try again.",
          variant: "destructive",
        });
        return false;
      } finally {
        setIsRegistering(false);
      }
    },
    [toast, options],
  );

  return { registerHotkey, isRegistering, hasError, clearError };
}
