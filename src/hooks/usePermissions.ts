import { useState, useCallback } from "react";

export interface UsePermissionsReturn {
  // State
  micPermissionGranted: boolean;
  accessibilityPermissionGranted: boolean;

  requestMicPermission: () => Promise<void>;
  testAccessibilityPermission: () => Promise<void>;
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

  const requestMicPermission = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
    } catch (err) {
      console.error("Microphone permission denied:", err);
      if (showAlertDialog) {
        showAlertDialog({
          title: "Microphone Permission Required",
          description:
            "Please grant microphone permissions to use voice dictation.",
        });
      } else {
        alert("Please grant microphone permissions to use voice dictation.");
      }
    }
  }, [showAlertDialog]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      await window.electronAPI.pasteText("PPQ Voice accessibility test");
      setAccessibilityPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ Accessibility Test Successful",
          description:
            "Accessibility permissions working! Check if the test text appeared in another app.",
        });
      } else {
        alert(
          "✅ Accessibility permissions working! Check if the test text appeared in another app.",
        );
      }
    } catch (err) {
      console.error("Accessibility permission test failed:", err);
      if (isMacOS && window.electronAPI?.openAccessibilitySettings) {
        window.electronAPI.openAccessibilitySettings();
      }
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ Accessibility Permissions Needed",
          description:
            "Opening System Settings... Please add PPQ Voice to the Accessibility list and enable it, then try again.",
        });
      } else {
        alert(
          "❌ Accessibility permissions needed! Please grant them in System Settings.",
        );
      }
    }
  }, [showAlertDialog]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
