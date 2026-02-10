import React, { useState, useCallback, useEffect } from "react";
import { Button } from "./ui/button";
import {
  RefreshCw,
  Download,
  Mic,
  Shield,
  Keyboard,
  HelpCircle,
  X,
} from "lucide-react";
import ApiKeyInput from "./ui/ApiKeyInput";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { formatHotkeyLabel } from "../utils/hotkeys";
import LanguageSelector from "./ui/LanguageSelector";
import HotkeyInput from "./ui/HotkeyInput";
import { HotkeyGuidelines } from "./ui/HotkeyGuidelines";
import { HotkeyHelpDialog } from "./ui/HotkeyHelpDialog";
import { Toggle } from "./ui/toggle";
import { Input } from "./ui/input";
import type { Platform } from "../utils/hotkeyValidator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type { UpdateInfoResult } from "../types/electron";
import { useDictionary } from "../stores/dictionaryStore";

export type SettingsSectionType =
  | "general"
  | "preferences"
  | "transcription"
  | "dictionary";

const SYSTEM_DEFAULT_DEVICE_ID = "__system_default__";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
}

export default function SettingsPage({
  activeSection = "general",
}: SettingsPageProps) {
  // Use custom hooks
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    preferredLanguage,
    ppqApiKey,
    dictationKey,
    hotkeyMode,
    audioCuesEnabled,
    alwaysUseBuiltInMic,
    preferredMicrophoneId,
    showIconOnlyWhenActive,
    mipOptOut,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    setAlwaysUseBuiltInMic,
    setPreferredMicrophoneId,
    setShowIconOnlyWhenActive,
    setMipOptOut,
    updateTranscriptionSettings,
    updateApiKeys,
  } = useSettings();

  // Update state
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<{
    updateAvailable: boolean;
    updateDownloaded: boolean;
    isDevelopment: boolean;
  }>({ updateAvailable: false, updateDownloaded: false, isDevelopment: false });
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [installInitiated, setInstallInitiated] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{
    version?: string;
    releaseDate?: string;
    releaseNotes?: string;
  }>({});
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [microphoneLoading, setMicrophoneLoading] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const isMacOS = platform === "darwin";
  const { registerHotkey, isRegistering: isSavingHotkey } =
    useHotkeyRegistration({
      onSuccess: setDictationKey,
    });
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(false);
  const openApiDocs = useCallback(() => {
    window.electronAPI?.openExternal?.("https://ppq.ai/api-docs");
  }, []);

  // Dictionary state and handlers
  const { items: dictionaryTerms, isLoading: dictionaryLoading } =
    useDictionary();
  const [newTerm, setNewTerm] = useState("");
  const [isAddingTerm, setIsAddingTerm] = useState(false);

  const handleAddTerm = useCallback(async () => {
    const trimmed = newTerm.trim();
    if (!trimmed || isAddingTerm) return;

    setIsAddingTerm(true);
    try {
      const result = await window.electronAPI?.addDictionaryTerm?.(trimmed);
      if (result?.success) {
        setNewTerm("");
        if (result.duplicate) {
          showAlertDialog({
            title: "Term Exists",
            description: `"${trimmed}" is already in your dictionary.`,
          });
        }
      }
    } catch (error: any) {
      showAlertDialog({
        title: "Failed to Add Term",
        description: error?.message || "Could not add term to dictionary.",
      });
    } finally {
      setIsAddingTerm(false);
    }
  }, [newTerm, isAddingTerm, showAlertDialog]);

  const handleRemoveTerm = useCallback(async (id: number) => {
    try {
      await window.electronAPI?.removeDictionaryTerm?.(id);
    } catch (error) {
      console.error("Failed to remove term:", error);
    }
  }, []);

  const handleClearDictionary = useCallback(() => {
    showConfirmDialog({
      title: "Clear Dictionary",
      description:
        "This will remove all terms from your custom dictionary. This action cannot be undone.",
      confirmText: "Clear All",
      onConfirm: async () => {
        try {
          await window.electronAPI?.clearDictionary?.();
        } catch (error) {
          console.error("Failed to clear dictionary:", error);
        }
      },
      variant: "destructive",
    });
  }, [showConfirmDialog]);

  const isUpdateAvailable =
    !updateStatus.isDevelopment &&
    (updateStatus.updateAvailable || updateStatus.updateDownloaded);

  const permissionsHook = usePermissions(showAlertDialog);
  const hasLabeledMicrophones = microphoneDevices.some(
    (device) => device.label && device.label.trim(),
  );
  const preferredMicrophoneMissing =
    Boolean(preferredMicrophoneId) &&
    microphoneDevices.length > 0 &&
    !microphoneDevices.some(
      (device) => device.deviceId === preferredMicrophoneId,
    );

  const subscribeToUpdates = useCallback(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onUpdateAvailable?.((_event, info) => {
      setUpdateStatus((prev) => ({
        ...prev,
        updateAvailable: true,
        updateDownloaded: false,
      }));
      if (info) {
        setUpdateInfo({
          version: info.version || "unknown",
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes ?? undefined,
        });
      }
    });

    window.electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateStatus((prev) => ({
        ...prev,
        updateAvailable: false,
        updateDownloaded: false,
      }));
      setUpdateInfo({});
      setDownloadingUpdate(false);
      setInstallInitiated(false);
      setUpdateDownloadProgress(0);
    });

    window.electronAPI.onUpdateDownloaded?.((_event, info) => {
      setUpdateStatus((prev) => ({ ...prev, updateDownloaded: true }));
      setDownloadingUpdate(false);
      setInstallInitiated(false);
      if (info) {
        setUpdateInfo({
          version: info.version || "unknown",
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes ?? undefined,
        });
      }
    });

    window.electronAPI.onUpdateDownloadProgress?.((_event, progressObj) => {
      setUpdateDownloadProgress(progressObj.percent || 0);
    });

    window.electronAPI.onUpdateError?.((_event, error) => {
      setCheckingForUpdates(false);
      setDownloadingUpdate(false);
      setInstallInitiated(false);
      console.error("Update error:", error);
      showAlertDialog({
        title: "Update Error",
        description:
          error?.message ||
          "The updater encountered a problem. Please try again or download the latest release manually from ppq.ai.",
      });
    });

    window.electronAPI.onUpdateInstallTimeout?.((_event, info) => {
      setInstallInitiated(false);
      showAlertDialog({
        title: "Still Running",
        description:
          info?.message ||
          "PPQ Whisper didn't restart automatically. Please quit the app manually to finish installing the update.",
      });
    });
  }, [showAlertDialog]);

  const loadMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicrophoneDevices([]);
      setMicrophoneError("Microphone selection isn't supported here.");
      return;
    }

    setMicrophoneLoading(true);
    setMicrophoneError("");

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(
        (device) =>
          device.kind === "audioinput" &&
          device.deviceId !== "default" &&
          device.deviceId !== "communications",
      );
      setMicrophoneDevices(audioInputs);
    } catch (error) {
      console.error("Failed to enumerate audio devices:", error);
      setMicrophoneDevices([]);
      setMicrophoneError(
        "Unable to load microphones. Check your permission settings.",
      );
    } finally {
      setMicrophoneLoading(false);
    }
  }, []);

  // Get platform on mount
  useEffect(() => {
    const detectedPlatform = window.electronAPI?.getPlatform?.() as
      | Platform
      | undefined;
    if (detectedPlatform) {
      setPlatform(detectedPlatform);
    }
  }, []);

  // Update globe key listener mode when hotkey or hotkeyMode changes (macOS only)
  useEffect(() => {
    if (platform !== "darwin") return;
    window.electronAPI?.updateGlobeListenerMode?.(dictationKey, hotkeyMode);
  }, [platform, dictationKey, hotkeyMode]);

  // Check if current settings require Input Monitoring permission
  // Only simple single-key hotkeys (non-compound, non-Globe) require Input Monitoring
  const isCompoundHotkey = dictationKey.includes("+");
  const needsInputMonitoring =
    isMacOS &&
    dictationKey !== "GLOBE" &&
    !isCompoundHotkey &&
    hotkeyMode === "hold";

  // Local state for provider selection (overrides computed value)
  useEffect(() => {
    let mounted = true;

    // Defer version and update checks to improve initial render
    const timer = setTimeout(async () => {
      if (!mounted) return;

      const versionResult = await window.electronAPI?.getAppVersion();
      if (versionResult && mounted) setCurrentVersion(versionResult.version);

      const statusResult = await window.electronAPI?.getUpdateStatus();
      if (statusResult && mounted) {
        setUpdateStatus((prev) => ({
          ...prev,
          ...statusResult,
          updateAvailable: prev.updateAvailable || statusResult.updateAvailable,
          updateDownloaded:
            prev.updateDownloaded || statusResult.updateDownloaded,
        }));
        if (
          (statusResult.updateAvailable || statusResult.updateDownloaded) &&
          window.electronAPI?.getUpdateInfo
        ) {
          const info = await window.electronAPI.getUpdateInfo();
          if (info) {
            setUpdateInfo({
              version: info.version || "unknown",
              releaseDate: info.releaseDate,
              releaseNotes: info.releaseNotes ?? undefined,
            });
          }
        }
      }

      subscribeToUpdates();
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
      // Always clean up update listeners if they exist
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners?.("update-available");
        window.electronAPI.removeAllListeners?.("update-not-available");
        window.electronAPI.removeAllListeners?.("update-downloaded");
        window.electronAPI.removeAllListeners?.("update-error");
        window.electronAPI.removeAllListeners?.("update-download-progress");
        window.electronAPI.removeAllListeners?.("update-install-timeout");
      }
    };
  }, [subscribeToUpdates]);

  useEffect(() => {
    if (alwaysUseBuiltInMic) return;

    void loadMicrophones();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    mediaDevices.addEventListener("devicechange", loadMicrophones);
    return () => {
      mediaDevices.removeEventListener("devicechange", loadMicrophones);
    };
  }, [alwaysUseBuiltInMic, loadMicrophones]);

  const saveApiKey = useCallback(async () => {
    try {
      const trimmed = ppqApiKey.trim();
      if (!trimmed) {
        showAlertDialog({
          title: "Missing API Key",
          description: "Add your PPQ API key before saving.",
        });
        return;
      }

      // Require the IPC handler to be available
      if (!window.electronAPI?.savePPQKey) {
        showAlertDialog({
          title: "Save Failed",
          description: "Unable to save settings. Please restart the app.",
        });
        return;
      }

      const result = await window.electronAPI.savePPQKey(trimmed);

      // Check if the save operation succeeded
      if (!result?.success) {
        showAlertDialog({
          title: "Save Failed",
          description:
            result?.error ||
            "We couldn't persist your API key. Please try again.",
        });
        return;
      }

      // Only update localStorage after .env save succeeds
      updateApiKeys({ ppqApiKey: trimmed });

      showAlertDialog({
        title: "API Key Saved",
        description: "Your PPQ key is stored securely on this device.",
      });
    } catch (error: any) {
      console.error("Failed to save API key:", error);
      showAlertDialog({
        title: "Save Failed",
        description:
          error?.message ||
          "We couldn't persist your API key. Please try again.",
      });
    }
  }, [ppqApiKey, updateApiKeys, showAlertDialog]);

  const resetAccessibilityPermissions = () => {
    const message = `🔄 RESET ACCESSIBILITY PERMISSIONS\n\nIf you've rebuilt or reinstalled PPQ Whisper and automatic inscription isn't functioning, you may have obsolete permissions from the previous version.\n\n📋 STEP-BY-STEP RESTORATION:\n\n1️⃣ Open System Settings (or System Preferences)\n   • macOS Ventura+: Apple Menu → System Settings\n   • Older macOS: Apple Menu → System Preferences\n\n2️⃣ Navigate to Privacy & Security → Accessibility\n\n3️⃣ Look for obsolete PPQ Whisper entries:\n   • Any entries named "PPQ Whisper"\n   • Any entries named "Electron"\n   • Any entries with unclear or generic names\n   • Entries pointing to old application locations\n\n4️⃣ Remove ALL obsolete entries:\n   • Select each old entry\n   • Click the minus (-) button\n   • Enter your password if prompted\n\n5️⃣ Add the current PPQ Whisper:\n   • Click the plus (+) button\n   • Navigate to and select the CURRENT PPQ Whisper app\n   • Ensure the checkbox is ENABLED\n\n6️⃣ Restart PPQ Whisper completely\n\n💡 This is very common during development when rebuilding applications!\n\nClick OK when you're ready to open System Settings.`;

    showConfirmDialog({
      title: "Reset Accessibility Permissions",
      description: message,
      onConfirm: () => {
        showAlertDialog({
          title: "Opening System Settings",
          description:
            "Opening System Settings... Look for the Accessibility section under Privacy & Security.",
        });

        window.open(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          "_blank",
        );
      },
    });
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-8">
            {/* App Updates Section */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  App Updates
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Keep PPQ Whisper up to date with the latest features and
                  improvements.
                </p>
              </div>
              <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-neutral-800">
                    Current Version
                  </p>
                  <p className="text-xs text-neutral-600">
                    {currentVersion || "Loading..."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {updateStatus.isDevelopment ? (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full">
                      Development Mode
                    </span>
                  ) : updateStatus.updateAvailable ? (
                    <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
                      Update Available
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-600 bg-neutral-100 px-2 py-1 rounded-full">
                      Up to Date
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={async () => {
                    setCheckingForUpdates(true);
                    try {
                      const result =
                        await window.electronAPI?.checkForUpdates();
                      if (result?.updateAvailable) {
                        setUpdateInfo({
                          version: result.version || "unknown",
                          releaseDate: result.releaseDate,
                          releaseNotes: result.releaseNotes,
                        });
                        setUpdateStatus((prev) => ({
                          ...prev,
                          updateAvailable: true,
                          updateDownloaded: false,
                        }));
                        showAlertDialog({
                          title: "Update Available",
                          description: `Update available: v${result.version || "new version"}`,
                        });
                      } else {
                        showAlertDialog({
                          title: "No Updates",
                          description:
                            result?.message || "No updates available",
                        });
                      }
                    } catch (error: any) {
                      showAlertDialog({
                        title: "Update Check Failed",
                        description:
                          error?.message ||
                          "The updater encountered a problem. Please try again or download the latest release manually from ppq.ai.",
                      });
                    } finally {
                      setCheckingForUpdates(false);
                    }
                  }}
                  disabled={checkingForUpdates || updateStatus.isDevelopment}
                  className="w-full"
                >
                  {checkingForUpdates ? (
                    <>
                      <RefreshCw size={16} className="animate-spin mr-2" />
                      Checking for Updates...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} className="mr-2" />
                      Check for Updates
                    </>
                  )}
                </Button>

                {isUpdateAvailable && !updateStatus.updateDownloaded && (
                  <div className="space-y-2">
                    <Button
                      onClick={async () => {
                        setDownloadingUpdate(true);
                        setUpdateDownloadProgress(0);
                        try {
                          await window.electronAPI?.downloadUpdate();
                        } catch (error: any) {
                          setDownloadingUpdate(false);
                          showAlertDialog({
                            title: "Download Failed",
                            description: `Failed to download update: ${error.message}`,
                          });
                        }
                      }}
                      disabled={downloadingUpdate}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      {downloadingUpdate ? (
                        <>
                          <Download size={16} className="animate-pulse mr-2" />
                          Downloading... {Math.round(updateDownloadProgress)}%
                        </>
                      ) : (
                        <>
                          <Download size={16} className="mr-2" />
                          Download Update
                          {updateInfo.version ? ` v${updateInfo.version}` : ""}
                        </>
                      )}
                    </Button>

                    {downloadingUpdate && (
                      <div className="space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                          <div
                            className="h-full bg-green-600 transition-all duration-200"
                            style={{
                              width: `${Math.min(100, Math.max(0, updateDownloadProgress))}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-neutral-600 text-right">
                          {Math.round(updateDownloadProgress)}% downloaded
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {updateStatus.updateDownloaded && (
                  <Button
                    onClick={() => {
                      showConfirmDialog({
                        title: "Install Update",
                        description: `Ready to install update${updateInfo.version ? ` v${updateInfo.version}` : ""}. The app will restart to complete installation.`,
                        confirmText: "Install & Restart",
                        onConfirm: async () => {
                          try {
                            setInstallInitiated(true);
                            const result =
                              await window.electronAPI?.installUpdate?.();
                            if (!result?.success) {
                              setInstallInitiated(false);
                              showAlertDialog({
                                title: "Install Failed",
                                description:
                                  result?.message ||
                                  "Failed to start the installer. Please try again.",
                              });
                              return;
                            }

                            showAlertDialog({
                              title: "Installing Update",
                              description:
                                "PPQ Whisper will restart automatically to finish installing the newest version.",
                            });
                          } catch (error: any) {
                            setInstallInitiated(false);
                            showAlertDialog({
                              title: "Install Failed",
                              description: `Failed to install update: ${error.message}`,
                            });
                          }
                        },
                      });
                    }}
                    disabled={installInitiated}
                    className="w-full"
                  >
                    {installInitiated ? (
                      <>
                        <RefreshCw size={16} className="animate-spin mr-2" />
                        Restarting to Finish Update...
                      </>
                    ) : (
                      <>
                        <span className="mr-2">🚀</span>
                        Quit & Install Update
                      </>
                    )}
                  </Button>
                )}

                {updateInfo.version && (
                  <div className="p-4 bg-accent border border-border rounded-lg">
                    <h4 className="font-medium text-foreground mb-2">
                      Update v{updateInfo.version}
                    </h4>
                    {updateInfo.releaseDate && (
                      <p className="text-sm text-muted-foreground mb-2">
                        Released:{" "}
                        {new Date(updateInfo.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                    {updateInfo.releaseNotes && (
                      <div className="text-sm text-foreground">
                        <p className="font-medium mb-1">What's New:</p>
                        <div className="whitespace-pre-wrap">
                          {updateInfo.releaseNotes}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Permissions Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Permissions
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  Test and manage app permissions for microphone
                  {isMacOS ? " and accessibility" : ""}.
                </p>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={permissionsHook.requestMicPermission}
                  variant="outline"
                  className="w-full"
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Test Microphone Permission
                </Button>
                {/* Accessibility permissions are only relevant on macOS */}
                {isMacOS && (
                  <>
                    <Button
                      onClick={permissionsHook.testAccessibilityPermission}
                      variant="outline"
                      className="w-full"
                    >
                      <Shield className="mr-2 h-4 w-4" />
                      Test Accessibility Permission
                    </Button>
                    <Button
                      onClick={resetAccessibilityPermissions}
                      variant="secondary"
                      className="w-full"
                    >
                      <span className="mr-2">⚙️</span>
                      Fix Permission Issues
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* About Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  About PPQ Whisper
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  PPQ Whisper converts your speech to text using AI. Press your
                  hotkey, speak, and we'll type what you said wherever your
                  cursor is.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-6">
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-primary rounded-lg flex items-center justify-center">
                    <Keyboard className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <p className="font-medium text-gray-800 mb-1">
                    Default Hotkey
                  </p>
                  <p className="text-gray-600 font-mono text-xs">
                    {formatHotkeyLabel(dictationKey)}
                  </p>
                </div>
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-emerald-600 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">🏷️</span>
                  </div>
                  <p className="font-medium text-gray-800 mb-1">Version</p>
                  <p className="text-gray-600 text-xs">
                    {currentVersion || "0.1.0"}
                  </p>
                </div>
                <div className="text-center p-4 border border-gray-200 rounded-xl bg-white">
                  <div className="w-8 h-8 mx-auto mb-2 bg-green-600 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="font-medium text-gray-800 mb-1">Status</p>
                  <p className="text-green-600 text-xs font-medium">Active</p>
                </div>
              </div>

              {/* System Actions */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <Button
                    onClick={() => {
                      showConfirmDialog({
                        title: "⚠️ DANGER: Cleanup App Data",
                        description:
                          "This will permanently delete ALL PPQ Whisper data including:\n\n• Database and transcriptions\n• Local storage settings\n• Cached logs and preferences\n• Environment files\n\nThe app will relaunch after cleanup.\n\nYou will need to manually remove app permissions in System Settings.\n\nThis action cannot be undone. Are you sure?",
                        onConfirm: () => {
                          window.electronAPI
                            ?.cleanupApp()
                            .then((result) => {
                              showAlertDialog({
                                title: "Cleanup Completed",
                                description:
                                  result?.message ||
                                  "✅ Cleanup completed! Relaunching PPQ Whisper...",
                              });
                            })
                            .catch((error) => {
                              const isOldVersion = error.message?.includes(
                                "No handler registered",
                              );
                              showAlertDialog({
                                title: "Cleanup Failed",
                                description: isOldVersion
                                  ? "This feature requires a newer version of PPQ Whisper. Please update to the latest version and try again."
                                  : `❌ Cleanup failed: ${error.message}`,
                              });
                            });
                        },
                        variant: "destructive",
                      });
                    }}
                    variant="outline"
                    className="w-full text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                  >
                    <span className="mr-2">🗑️</span>
                    Clean Up All App Data
                  </Button>
                  <p className="text-xs text-gray-500">
                    Full reset: wipes transcriptions, settings, logs, and saved
                    keys. You’ll need to set up PPQ Whisper again.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case "preferences":
        return (
          <div className="space-y-8">
            {/* Hotkey Section */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Dictation Hotkey
                  </h3>
                  {platform && (
                    <button
                      type="button"
                      onClick={() => setHotkeyHelpOpen(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Hotkey help"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Click below and press any key combination to set your hotkey.
                </p>
              </div>
              <div className="space-y-4">
                <HotkeyInput
                  value={dictationKey}
                  onSave={registerHotkey}
                  isSaving={isSavingHotkey}
                  showGlobeOption={isMacOS}
                />

                {/* Hotkey guidelines - platform specific */}
                {platform && (
                  <HotkeyGuidelines
                    platform={platform}
                    currentHotkey={dictationKey}
                    onSelect={registerHotkey}
                    disabled={isSavingHotkey}
                  />
                )}

                {/* Hotkey mode - Mac only */}
                {isMacOS && (
                  <div className="space-y-3 pt-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Hotkey Activation Style
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setHotkeyMode("hold");
                          window.electronAPI?.updateHotkeyMode?.("hold");
                        }}
                        className={`
                          relative p-4 rounded-xl border-2 transition-all duration-200 text-left
                          ${
                            hotkeyMode === "hold"
                              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                              : "border-border bg-muted/30 hover:border-primary/50"
                          }
                        `}
                      >
                        {hotkeyMode === "hold" && (
                          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                        )}
                        <div
                          className={`font-semibold ${hotkeyMode === "hold" ? "text-primary" : "text-foreground"}`}
                        >
                          Hold to talk
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Hold while speaking, release to stop
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHotkeyMode("toggle");
                          window.electronAPI?.updateHotkeyMode?.("toggle");
                        }}
                        className={`
                          relative p-4 rounded-xl border-2 transition-all duration-200 text-left
                          ${
                            hotkeyMode === "toggle"
                              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                              : "border-border bg-muted/30 hover:border-primary/50"
                          }
                        `}
                      >
                        {hotkeyMode === "toggle" && (
                          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                        )}
                        <div
                          className={`font-semibold ${hotkeyMode === "toggle" ? "text-primary" : "text-foreground"}`}
                        >
                          Press once
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Tap to start, tap again to stop
                        </div>
                      </button>
                    </div>

                    {/* Warning for non-Globe + hold mode requiring Input Monitoring */}
                    {needsInputMonitoring && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <div className="font-medium mb-1">
                          Input Monitoring Required
                        </div>
                        <p className="text-xs">
                          "Hold to talk" with non-Globe keys requires Input
                          Monitoring permission to detect key release. Go to
                          System Settings → Privacy & Security → Input
                          Monitoring and enable PPQ Whisper.
                        </p>
                        <p className="text-xs mt-2">
                          <strong>Tip:</strong> Use the Globe key (🌐) for
                          hold-to-talk without this extra permission.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Language Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Language
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Set your preferred language for transcription.
                </p>
              </div>
              <div className="space-y-4 p-4 bg-neutral-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-neutral-800 mb-2">
                    Preferred Language
                  </p>
                  <LanguageSelector
                    value={preferredLanguage}
                    onChange={(value) => {
                      setPreferredLanguage(value);
                      updateTranscriptionSettings({ preferredLanguage: value });
                    }}
                    className="w-full"
                  />
                </div>
                <p className="text-xs text-neutral-600">
                  Whisper will bias toward this language for faster, more
                  accurate transcripts. Leave on Auto for multilingual
                  workflows.
                </p>
              </div>
            </div>

            {/* Audio Cues Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Play Sound
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Play audio cues when recording starts and stops.
                </p>
                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      Recording Sounds
                    </p>
                    <p className="text-xs text-neutral-600">
                      Toggle start/stop indicator sounds.
                    </p>
                  </div>
                  <Toggle
                    checked={audioCuesEnabled}
                    onChange={(checked) => setAudioCuesEnabled(checked)}
                  />
                </div>
              </div>
            </div>

            {/* Appearance Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Floating Icon Appearance
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Customize how the floating icon appears on your screen.
                </p>
                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      Hide icon when inactive
                    </p>
                    <p className="text-xs text-neutral-600">
                      Only show the icon when the transcription is happening.
                    </p>
                  </div>
                  <Toggle
                    checked={showIconOnlyWhenActive}
                    onChange={(checked) => setShowIconOnlyWhenActive(checked)}
                  />
                </div>
              </div>
            </div>

            {/* Microphone Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Microphone
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Choose which microphone PPQ Whisper uses for recording.
                </p>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      Always default to built-in microphone
                    </p>
                    <p className="text-xs text-neutral-600">
                      Built-in microphone strongly recommended for best
                      experience
                    </p>
                  </div>
                  <Toggle
                    checked={alwaysUseBuiltInMic}
                    onChange={(checked) => setAlwaysUseBuiltInMic(checked)}
                  />
                </div>
                {!alwaysUseBuiltInMic && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-neutral-800">
                          Preferred microphone
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={loadMicrophones}
                          disabled={microphoneLoading}
                        >
                          <RefreshCw
                            className={microphoneLoading ? "animate-spin" : ""}
                            size={14}
                          />
                          Refresh
                        </Button>
                      </div>
                      <div className="mt-2">
                        <Select
                          value={
                            preferredMicrophoneId || SYSTEM_DEFAULT_DEVICE_ID
                          }
                          onValueChange={(value) =>
                            setPreferredMicrophoneId(
                              value === SYSTEM_DEFAULT_DEVICE_ID ? "" : value,
                            )
                          }
                        >
                          <SelectTrigger className="w-full bg-white">
                            <SelectValue
                              placeholder={
                                microphoneLoading
                                  ? "Loading microphones..."
                                  : "Select a microphone"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SYSTEM_DEFAULT_DEVICE_ID}>
                              System default
                            </SelectItem>
                            {microphoneDevices.length === 0 ? (
                              <SelectItem value="no-mics" disabled>
                                No microphones found
                              </SelectItem>
                            ) : (
                              microphoneDevices.map((device, index) => (
                                <SelectItem
                                  key={device.deviceId}
                                  value={device.deviceId}
                                >
                                  {device.label?.trim() ||
                                    `Microphone ${index + 1}`}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      {microphoneError && (
                        <p className="text-xs text-rose-600 mt-2">
                          {microphoneError}
                        </p>
                      )}
                      {!microphoneError &&
                        microphoneDevices.length > 0 &&
                        !hasLabeledMicrophones && (
                          <p className="text-xs text-neutral-500 mt-2">
                            Grant microphone permission to see device names.
                          </p>
                        )}
                      {!microphoneError && preferredMicrophoneMissing && (
                        <p className="text-xs text-neutral-500 mt-2">
                          The selected microphone isn't available. We'll use the
                          system default instead.
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      External microphones may introduce latency or reduce audio
                      quality.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Privacy Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Privacy
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Control how your audio data is used.
                </p>
                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      Keep audio data private
                    </p>
                    <p className="text-xs text-neutral-600">
                      When enabled, your audio is not used for AI model training.
                    </p>
                  </div>
                  <Toggle
                    checked={mipOptOut}
                    onChange={(checked) => setMipOptOut(checked)}
                  />
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 mt-4">
                  <p className="font-medium mb-1">Model Improvement Partnership</p>
                  <p>
                    When enabled (default), your audio stays private and is not trained on or retained by PPQ's speech-to-text provider. Disable this option
                    to allow your audio to be used for model training from our provider and receive a ~45%
                    discount on transcription costs. Lastly, your audio is never trained on or retained by PPQ under any circumstance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case "transcription":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                API Key
              </h3>
              <p className="text-sm text-gray-600">
                Manage your PPQ API key here.
              </p>
            </div>

            <div className="space-y-4 p-4 bg-accent border border-border rounded-xl">
              <h4 className="font-medium text-foreground">PPQ API Key</h4>
              <ApiKeyInput
                apiKey={ppqApiKey}
                setApiKey={setPpqApiKey}
                helpText={
                  <span>
                    Need a key?{" "}
                    <button
                      type="button"
                      onClick={openApiDocs}
                      className="text-link underline hover:opacity-80"
                    >
                      Get it from ppq.ai
                    </button>
                    .
                  </span>
                }
              />
              <Button onClick={saveApiKey} className="w-full">
                Save API Key
              </Button>
            </div>
          </div>
        );

      case "dictionary":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Custom Dictionary
              </h3>
              <p className="text-sm text-gray-600">
                Add words, names, and phrases that the transcription should
                recognize. These terms improve accuracy for brand names,
                technical jargon, and proper nouns.
              </p>
            </div>

            <div className="space-y-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
              {/* Add term input */}
              <div className="flex gap-2">
                <Input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Add a term (e.g., company name, jargon)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTerm();
                    }
                  }}
                  disabled={isAddingTerm || dictionaryTerms.length >= 100}
                  className="flex-1"
                />
                <Button
                  onClick={handleAddTerm}
                  disabled={
                    !newTerm.trim() ||
                    isAddingTerm ||
                    dictionaryTerms.length >= 100
                  }
                >
                  {isAddingTerm ? "Adding..." : "Add"}
                </Button>
              </div>

              {/* Term list */}
              {dictionaryLoading ? (
                <p className="text-sm text-gray-500">Loading dictionary...</p>
              ) : dictionaryTerms.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No terms added yet. Add words and phrases to improve
                  transcription accuracy.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {dictionaryTerms.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-sm text-gray-700"
                    >
                      {item.term}
                      <button
                        type="button"
                        onClick={() => handleRemoveTerm(item.id)}
                        className="ml-0.5 text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label={`Remove ${item.term}`}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {dictionaryTerms.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    {dictionaryTerms.length}/100 terms
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearDictionary}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    Clear All
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <p className="font-medium mb-1">How it works</p>
              <p className="text-xs">
                Dictionary terms are sent to the transcription API as hints,
                improving recognition of uncommon words. They're also included
                in the post-processing prompt to preserve exact spelling.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {platform && (
        <HotkeyHelpDialog
          open={hotkeyHelpOpen}
          onOpenChange={setHotkeyHelpOpen}
          platform={platform}
        />
      )}

      {renderSectionContent()}
    </>
  );
}
