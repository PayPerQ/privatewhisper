import { useState, useCallback, useEffect } from "react";

export interface UsePermissionsReturn {
  // State
  micPermissionGranted: boolean;
  accessibilityPermissionGranted: boolean;
  isCheckingPermissions: boolean;

  requestMicPermission: () => Promise<void>;
  testAccessibilityPermission: () => Promise<void>;
  checkAccessibilityPermission: () => Promise<void>;
  setMicPermissionGranted: (granted: boolean) => void;
  setAccessibilityPermissionGranted: (granted: boolean) => void;
}

export interface UsePermissionsProps {
  showAlertDialog: (dialog: { title: string; description?: string }) => void;
}

// Platform is constant for the lifetime of the app - compute once
const isMacOS = (window.electronAPI?.getPlatform?.() || "") === "darwin";

export const usePermissions = (
  showAlertDialog?: UsePermissionsProps["showAlertDialog"],
): UsePermissionsReturn => {
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  // Accessibility permissions are only required on macOS
  // On Windows/Linux, pasting works without special permissions - auto-grant
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] =
    useState(!isMacOS);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(false);

  // Check accessibility permissions on mount (macOS only)
  // This allows the UI to reflect the current permission state without user action
  const checkAccessibilityPermission = useCallback(async () => {
    if (!isMacOS) {
      setAccessibilityPermissionGranted(true);
      return;
    }

    setIsCheckingPermissions(true);
    try {
      const result =
        await window.electronAPI?.checkAccessibilityPermissions?.();
      if (result?.granted) {
        setAccessibilityPermissionGranted(true);
      }
    } catch (err) {
      console.error("Failed to check accessibility permissions:", err);
    } finally {
      setIsCheckingPermissions(false);
    }
  }, []);

  // Check permissions on mount
  useEffect(() => {
    void checkAccessibilityPermission();
  }, [checkAccessibilityPermission]);

  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop all tracks immediately after testing - prevents resource leaks
      stream.getTracks().forEach((track) => track.stop());
      setMicPermissionGranted(true);
    } catch (err) {
      console.error("Microphone permission denied:", err);
      const error = err as Error & { name?: string };
      let description =
        "Please grant microphone permissions to use voice dictation.";

      // Provide specific guidance based on error type
      if (error.name === "NotFoundError") {
        description =
          "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotAllowedError") {
        description = isMacOS
          ? "Microphone permission was denied. Please go to System Settings > Privacy & Security > Microphone and enable access for Private Whisper."
          : "Microphone permission was denied. Please allow microphone access in your browser or system settings.";
      } else if (error.name === "NotReadableError") {
        description =
          "Could not access the microphone. It may be in use by another application.";
      }

      if (showAlertDialog) {
        showAlertDialog({
          title: "Microphone Permission Required",
          description,
        });
      } else {
        alert(description);
      }
    }
  }, [showAlertDialog]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      await window.electronAPI.pasteText("Private Whisper accessibility test");
      setAccessibilityPermissionGranted(true);
      // No success dialog - the checkmark in the UI is sufficient feedback
    } catch (err) {
      console.error("Accessibility permission test failed:", err);
      if (isMacOS && window.electronAPI?.openAccessibilitySettings) {
        window.electronAPI.openAccessibilitySettings();
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: "Accessibility Permissions Needed",
          description:
            "Opening System Settings... Please add Private Whisper to the Accessibility list and enable it, then try again.",
        });
      } else {
        alert(
          "Accessibility permissions needed! Please grant them in System Settings.",
        );
      }
    }
  }, [showAlertDialog]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    isCheckingPermissions,
    requestMicPermission,
    testAccessibilityPermission,
    checkAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
