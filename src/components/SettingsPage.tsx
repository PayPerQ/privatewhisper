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
  Copy,
  FileText,
  CheckCircle,
} from "lucide-react";
import ApiKeyInput from "./ui/ApiKeyInput";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useSettings, type ReasoningProvider } from "../hooks/useSettings";
import { ProviderRadio } from "./settings/ProviderRadio";
import gemmaModelsCatalog from "../models/gemmaModels.json";
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
  | "models"
  | "transcription"
  | "dictionary"
  | "logs";

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
    llmCleanupEnabled,
    mipOptOut,
    reasoningProvider,
    gemmaModel,
    gemmaIdleShutdownEnabled,
    setPreferredLanguage,
    setPpqApiKey,
    setDictationKey,
    setHotkeyMode,
    setAudioCuesEnabled,
    setAlwaysUseBuiltInMic,
    setPreferredMicrophoneId,
    setShowIconOnlyWhenActive,
    setLlmCleanupEnabled,
    setMipOptOut,
    setPrivateModel,
    setGemmaIdleShutdownEnabled,
    updateReasoningSettings,
    updateTranscriptionSettings,
    updateApiKeys,
    transcriptionProvider,
    parakeetModel,
    setTranscriptionProvider,
    setParakeetModel,
  } = useSettings();

  // Parakeet local transcription state
  const [parakeetInstalled, setParakeetInstalled] = useState(false);
  const [parakeetModelStatus, setParakeetModelStatus] = useState<{
    downloaded: boolean;
    size_mb?: number;
  }>({ downloaded: false });
  const [parakeetDownloading, setParakeetDownloading] = useState(false);
  const [parakeetDownloadProgress, setParakeetDownloadProgress] = useState(0);
  const [parakeetServerRunning, setParakeetServerRunning] = useState(false);
  const [sherpaInstalling, setSherpaInstalling] = useState(false);
  const [sherpaInstallProgress, setSherpaInstallProgress] = useState(0);

  // Local Gemma (llama.cpp) state
  const gemmaInfo = (gemmaModelsCatalog as any).gemmaModels[gemmaModel] || null;
  const [llamaServerInstalled, setLlamaServerInstalled] = useState(false);
  const [llamaServerSupported, setLlamaServerSupported] = useState(true);
  const [llamaServerInstalling, setLlamaServerInstalling] = useState(false);
  const [llamaServerInstallProgress, setLlamaServerInstallProgress] = useState(0);
  const [gemmaModelStatus, setGemmaModelStatus] = useState<{
    downloaded: boolean;
    size_mb?: number;
  }>({ downloaded: false });
  const [gemmaDownloading, setGemmaDownloading] = useState(false);
  const [gemmaDownloadProgress, setGemmaDownloadProgress] = useState(0);
  const [gemmaStatus, setGemmaStatus] = useState<{
    ready: boolean;
    starting: boolean;
    running: boolean;
    error: string | null;
  }>({ ready: false, starting: false, running: false, error: null });

  // Check Parakeet installation and model status on mount
  useEffect(() => {
    const checkParakeet = async () => {
      try {
        const installation = await (window as any).electronAPI?.checkParakeetInstallation?.();
        setParakeetInstalled(installation?.installed ?? false);

        const status = await (window as any).electronAPI?.checkParakeetModelStatus?.(parakeetModel);
        if (status) setParakeetModelStatus(status);

        const serverStatus = await (window as any).electronAPI?.parakeetServerStatus?.();
        setParakeetServerRunning(serverStatus?.running ?? false);
      } catch {
        // Parakeet not available
      }
    };
    checkParakeet();

    // Listen for server status changes (start/stop/crash)
    const cleanup = (window as any).electronAPI?.onParakeetServerStatusChanged?.(
      (status: any) => {
        setParakeetServerRunning(status?.running ?? false);
      },
    );
    return () => cleanup?.();
  }, [parakeetModel]);

  // Check Local Gemma installation, model status, and server status on mount
  useEffect(() => {
    const checkGemma = async () => {
      try {
        const installation = await (window as any).electronAPI?.checkLlamaServerStatus?.();
        setLlamaServerInstalled(Boolean(installation?.installed));
        setLlamaServerSupported(installation?.supported !== false);

        const status = await (window as any).electronAPI?.checkGemmaModelStatus?.(gemmaModel);
        if (status) setGemmaModelStatus(status);

        const serverStatus = await (window as any).electronAPI?.gemmaServerStatus?.();
        if (serverStatus) {
          setGemmaStatus({
            ready: Boolean(serverStatus.ready),
            starting: Boolean(serverStatus.starting),
            running: Boolean(serverStatus.running),
            error: serverStatus.error ?? null,
          });
        }
      } catch {
        // Gemma not available
      }
    };
    checkGemma();

    const cleanup = (window as any).electronAPI?.onGemmaServerStatusChanged?.(
      (status: any) => {
        setGemmaStatus({
          ready: Boolean(status?.ready),
          starting: Boolean(status?.starting),
          running: Boolean(status?.running),
          error: status?.error ?? null,
        });
      },
    );
    return () => cleanup?.();
  }, [gemmaModel]);

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

  // Private proxy status
  const [proxyStatus, setProxyStatus] = useState<{
    running: boolean;
    starting: boolean;
    error: string | null;
  }>({ running: false, starting: false, error: null });

  // Logs state
  const [logFiles, setLogFiles] = useState<
    { name: string; path: string; size: number; modified: string }[]
  >([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const [selectedLogContent, setSelectedLogContent] = useState<string | null>(
    null,
  );
  const [selectedLogName, setSelectedLogName] = useState<string | null>(null);

  const loadLogFiles = useCallback(async () => {
    setLogsLoading(true);
    try {
      const result = await (window as any).electronAPI?.getLogFiles?.();
      setLogFiles(result?.files ?? []);
    } catch {
      setLogFiles([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const copyDiagnosticLogs = useCallback(async () => {
    try {
      const result =
        await (window as any).electronAPI?.collectDiagnosticLogs?.();
      if (result?.content) {
        await navigator.clipboard.writeText(result.content);
        setLogsCopied(true);
        setTimeout(() => setLogsCopied(false), 2000);
      }
    } catch {
      showAlertDialog({
        title: "Copy Failed",
        description: "Could not copy logs to clipboard.",
      });
    }
  }, [showAlertDialog]);

  const viewLogFile = useCallback(async (filePath: string, name: string) => {
    try {
      const result = await (window as any).electronAPI?.readLogFile?.(filePath);
      setSelectedLogContent(result?.content ?? "No content");
      setSelectedLogName(name);
    } catch {
      setSelectedLogContent("Failed to read log file.");
      setSelectedLogName(name);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "logs") {
      void loadLogFiles();
    }
  }, [activeSection, loadLogFiles]);

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
          "Private Whisper didn't restart automatically. Please quit the app manually to finish installing the update.",
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
  // Fetch initial proxy status and listen for changes
  useEffect(() => {
    window.electronAPI?.getPrivateProxyStatus?.().then((status: any) => {
      if (status) setProxyStatus(status);
    });
    const cleanup = window.electronAPI?.onPrivateProxyStatusChanged?.(
      (status: any) => {
        if (status) setProxyStatus(status);
      },
    );
    return () => cleanup?.();
  }, []);

  const handleReasoningProviderChange = useCallback(
    async (next: ReasoningProvider) => {
      const prev = reasoningProvider;
      if (prev === next) return;
      updateReasoningSettings({ reasoningProvider: next });

      // Stop whichever provider we're leaving
      if (prev === "tinfoil" && next !== "tinfoil") {
        await (window as any).electronAPI?.stopPrivateProxy?.();
        setProxyStatus({ running: false, starting: false, error: null });
      }
      if (prev === "local-gemma" && next !== "local-gemma") {
        await (window as any).electronAPI?.gemmaServerStop?.();
      }

      // Start whichever provider we're switching to
      if (next === "tinfoil") {
        setPrivateModel("private/llama3-3-70b");
        setProxyStatus((s) => ({ ...s, starting: true, error: null }));
        const result = await (window as any).electronAPI?.startPrivateProxy?.();
        if (result && !result.success) {
          setProxyStatus((s) => ({
            ...s,
            starting: false,
            error: result.error,
          }));
        }
      } else if (next === "local-gemma") {
        if (gemmaModelStatus.downloaded) {
          setGemmaStatus((s) => ({ ...s, starting: true, error: null }));
          const result = await (window as any).electronAPI?.gemmaServerStart?.(
            gemmaModel,
          );
          if (result && result.success === false) {
            setGemmaStatus((s) => ({
              ...s,
              starting: false,
              error: result.error || result.reason || "Failed to start",
            }));
          }
        }
      }
    },
    [
      reasoningProvider,
      updateReasoningSettings,
      setPrivateModel,
      gemmaModelStatus.downloaded,
      gemmaModel,
    ],
  );

  const handleInstallLlamaServer = useCallback(async () => {
    setLlamaServerInstalling(true);
    setLlamaServerInstallProgress(0);
    const cleanup = (window as any).electronAPI?.onLlamaServerInstallProgress?.(
      (progress: any) => {
        if (typeof progress?.percentage === "number") {
          setLlamaServerInstallProgress(progress.percentage);
        }
        if (progress?.type === "complete") {
          setLlamaServerInstalling(false);
          setLlamaServerInstalled(true);
        }
      },
    );
    try {
      const result = await (window as any).electronAPI?.installLlamaServer?.();
      if (result?.success) {
        setLlamaServerInstalled(true);
      }
    } catch {
      // swallow — fall through to finally
    } finally {
      setLlamaServerInstalling(false);
      cleanup?.();
    }
  }, []);

  const handleDownloadGemma = useCallback(async () => {
    setGemmaDownloading(true);
    setGemmaDownloadProgress(0);
    setGemmaStatus((s) => ({ ...s, error: null }));
    const cleanup = (window as any).electronAPI?.onGemmaDownloadProgress?.(
      (progress: any) => {
        if (typeof progress?.percentage === "number") {
          setGemmaDownloadProgress(progress.percentage);
        }
        if (progress?.type === "complete") {
          setGemmaDownloading(false);
          setGemmaModelStatus({ downloaded: true });
        }
        if (progress?.type === "error") {
          setGemmaDownloading(false);
          setGemmaStatus((s) => ({
            ...s,
            error: progress.error || "Download failed",
          }));
        }
      },
    );
    try {
      const result = await (window as any).electronAPI?.downloadGemmaModel?.(
        gemmaModel,
      );
      if (result && result.success === false) {
        setGemmaStatus((s) => ({
          ...s,
          error: result.error || "Download failed",
        }));
      }
    } catch (err: any) {
      setGemmaStatus((s) => ({
        ...s,
        error: err?.message || "Download failed",
      }));
    } finally {
      setGemmaDownloading(false);
      cleanup?.();
    }
  }, [gemmaModel]);

  const handleDeleteGemma = useCallback(async () => {
    await (window as any).electronAPI?.deleteGemmaModel?.(gemmaModel);
    setGemmaModelStatus({ downloaded: false });
  }, [gemmaModel]);

  const handleGemmaIdleShutdownToggle = useCallback(
    (enabled: boolean) => {
      setGemmaIdleShutdownEnabled(enabled);
      (window as any).electronAPI?.saveSettings?.({
        gemmaIdleShutdownEnabled: enabled,
      });
    },
    [setGemmaIdleShutdownEnabled],
  );

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
            (result as { error?: string } | undefined)?.error ||
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
    const message = `🔄 RESET ACCESSIBILITY PERMISSIONS\n\nIf you've rebuilt or reinstalled Private Whisper and automatic inscription isn't functioning, you may have obsolete permissions from the previous version.\n\n📋 STEP-BY-STEP RESTORATION:\n\n1️⃣ Open System Settings (or System Preferences)\n   • macOS Ventura+: Apple Menu → System Settings\n   • Older macOS: Apple Menu → System Preferences\n\n2️⃣ Navigate to Privacy & Security → Accessibility\n\n3️⃣ Look for obsolete Private Whisper entries:\n   • Any entries named "Private Whisper"\n   • Any entries named "Electron"\n   • Any entries with unclear or generic names\n   • Entries pointing to old application locations\n\n4️⃣ Remove ALL obsolete entries:\n   • Select each old entry\n   • Click the minus (-) button\n   • Enter your password if prompted\n\n5️⃣ Add the current Private Whisper:\n   • Click the plus (+) button\n   • Navigate to and select the CURRENT Private Whisper app\n   • Ensure the checkbox is ENABLED\n\n6️⃣ Restart Private Whisper completely\n\n💡 This is very common during development when rebuilding applications!\n\nClick OK when you're ready to open System Settings.`;

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
                  Keep Private Whisper up to date with the latest features and
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
                                "Private Whisper will restart automatically to finish installing the newest version.",
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
                  About Private Whisper
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  Private Whisper converts your speech to text using AI. Press your
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
                          "This will permanently delete ALL Private Whisper data including:\n\n• Database and transcriptions\n• Local storage settings\n• Cached logs and preferences\n• Environment files\n\nThe app will relaunch after cleanup.\n\nYou will need to manually remove app permissions in System Settings.\n\nThis action cannot be undone. Are you sure?",
                        onConfirm: () => {
                          window.electronAPI
                            ?.cleanupApp()
                            .then((result) => {
                              showAlertDialog({
                                title: "Cleanup Completed",
                                description:
                                  result?.message ||
                                  "✅ Cleanup completed! Relaunching Private Whisper...",
                              });
                            })
                            .catch((error) => {
                              const isOldVersion = error.message?.includes(
                                "No handler registered",
                              );
                              showAlertDialog({
                                title: "Cleanup Failed",
                                description: isOldVersion
                                  ? "This feature requires a newer version of Private Whisper. Please update to the latest version and try again."
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
                    keys. You’ll need to set up Private Whisper again.
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
                          Monitoring and enable Private Whisper.
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
                  Choose which microphone Private Whisper uses for recording.
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

          </div>
        );

      case "models":
        return (
          <div className="space-y-8">
            {/* How Private Whisper Works */}
            <div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                <p className="font-medium mb-2">Private Whisper uses a two-step voice processing pipeline:</p>
                <ol className="list-decimal list-inside space-y-1.5 ml-1">
                  <li>
                    <span className="font-medium">Speech-to-Text (STT)</span> — A
                    transcription provider converts your audio into raw text.
                    Configure the provider below.
                  </li>
                  <li>
                    <span className="font-medium">LLM Cleanup (Optional)</span> — Fixes
                    punctuation, filler words, and formatting. Also applies your
                    custom dictionary.
                  </li>
                </ol>
              </div>
            </div>

            {/* Transcription Provider */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Speech-to-Text (STT) Provider
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Choose between local transcription (Parakeet via sherpa-onnx) or cloud transcription (Deepgram).
                </p>
              </div>

              <div className="space-y-3">
                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    transcriptionProvider === "local"
                      ? "border-orange-300 bg-orange-50"
                      : "border-border bg-accent hover:bg-neutral-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="sttProvider"
                    checked={transcriptionProvider === "local"}
                    onChange={() => setTranscriptionProvider("local")}
                    className="mt-1 accent-orange-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Parakeet (Local) <span className="text-xs font-medium text-green-600 ml-1">Recommended</span></p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Blazing fast and free transcription that runs locally on your device. Requires a one-time model download (~680 MB) and works on most devices.
                    </p>
                  </div>
                </label>

                {/* Parakeet model management (visible when local is selected) */}
                {transcriptionProvider === "local" && (
                  <div className="space-y-3 p-4 rounded-xl border border-border bg-accent">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-foreground">
                          Parakeet TDT 0.6B
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Multilingual ASR (25 languages) &middot; ~680 MB
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {parakeetModelStatus.downloaded ? (
                          <>
                            <span className="text-xs text-green-600 font-medium">
                              Ready
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                await (window as any).electronAPI?.deleteParakeetModel?.(parakeetModel);
                                setParakeetModelStatus({ downloaded: false });
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        ) : parakeetDownloading ? (
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all"
                                style={{
                                  width: `${parakeetDownloadProgress}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {parakeetDownloadProgress}%
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                await (window as any).electronAPI?.cancelParakeetDownload?.();
                                setParakeetDownloading(false);
                                setParakeetDownloadProgress(0);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!parakeetInstalled}
                            onClick={async () => {
                              setParakeetDownloading(true);
                              setParakeetDownloadProgress(0);
                              const cleanup = (window as any).electronAPI?.onParakeetDownloadProgress?.(
                                (progress: any) => {
                                  if (progress.percentage != null) {
                                    setParakeetDownloadProgress(progress.percentage);
                                  }
                                  if (progress.type === "complete") {
                                    setParakeetDownloading(false);
                                    setParakeetModelStatus({ downloaded: true });
                                  }
                                },
                              );
                              try {
                                await (window as any).electronAPI?.downloadParakeetModel?.(parakeetModel);
                              } catch {
                                setParakeetDownloading(false);
                              }
                              if (cleanup) cleanup();
                            }}
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Download
                          </Button>
                        )}
                      </div>
                    </div>

                    {!parakeetInstalled && !sherpaInstalling && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-medium text-amber-800 mb-2">
                          Transcription engine required
                        </p>
                        <p className="text-xs text-amber-700 mb-3">
                          Local transcription requires a one-time setup (~90 MB
                          download).
                        </p>
                        <Button
                          size="sm"
                          onClick={async () => {
                            setSherpaInstalling(true);
                            setSherpaInstallProgress(0);
                            const cleanup = (window as any).electronAPI?.onSherpaOnnxInstallProgress?.(
                              (progress: any) => {
                                if (progress.percentage != null) {
                                  setSherpaInstallProgress(progress.percentage);
                                }
                                if (progress.type === "complete") {
                                  setSherpaInstalling(false);
                                  setParakeetInstalled(true);
                                }
                              },
                            );
                            try {
                              const result = await (window as any).electronAPI?.installSherpaOnnx?.();
                              if (result?.success) {
                                setParakeetInstalled(true);
                              } else if (result?.error) {
                                showAlertDialog({
                                  title: "Setup Failed",
                                  description: result.error,
                                });
                              }
                            } catch (err: any) {
                              showAlertDialog({
                                title: "Setup Failed",
                                description:
                                  err?.message ||
                                  "Could not install the transcription engine.",
                              });
                            } finally {
                              setSherpaInstalling(false);
                              setSherpaInstallProgress(0);
                              if (cleanup) cleanup();
                            }
                          }}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Set Up Parakeet
                        </Button>
                      </div>
                    )}

                    {sherpaInstalling && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <p className="text-sm font-medium text-blue-800 mb-2">
                          Setting up transcription engine...
                        </p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-blue-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{
                                width: `${sherpaInstallProgress}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-blue-700 min-w-[3ch]">
                            {sherpaInstallProgress}%
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              await (window as any).electronAPI?.cancelSherpaOnnxInstall?.();
                              setSherpaInstalling(false);
                              setSherpaInstallProgress(0);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {parakeetModelStatus.downloaded && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            parakeetServerRunning
                              ? "bg-green-500"
                              : "bg-gray-400"
                          }`}
                        />
                        Server{" "}
                        {parakeetServerRunning ? "running" : "stopped (starts on first use)"}
                      </div>
                    )}
                  </div>
                )}

                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    transcriptionProvider === "cloud"
                      ? "border-orange-300 bg-orange-50"
                      : "border-border bg-accent hover:bg-neutral-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="sttProvider"
                    checked={transcriptionProvider === "cloud"}
                    onChange={() => setTranscriptionProvider("cloud")}
                    className="mt-1 accent-orange-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">Deepgram (Cloud)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Transcription via Deepgram. No local setup required. Works on all devices. Small cost.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Privacy Section — only relevant for cloud (Deepgram) provider */}
            {transcriptionProvider === "cloud" && (
              <div className="border-t pt-8">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    STT Provider Privacy
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Voice data is sent to Deepgram.com for processing.
                  </p>
                  <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-neutral-800">
                        Keep audio data from being retained and trained upon.
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
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800 mt-4">
                    <p className="font-medium mb-1">Model Improvement Partnership</p>
                    <p>
                      When enabled (default), your audio stays private and is not trained on or retained by PPQ's speech-to-text provider. Disable this option
                      to allow your audio to be used for model training from our provider and receive a ~45%
                      discount on transcription costs. Lastly, your audio is never trained on or retained by PPQ under any circumstance.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* LLM Text Cleanup Section */}
            <div className="border-t pt-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  LLM Text Cleanup
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Remove filler words,
                  fix grammar, and improve punctuation, and apply dictionary words by using LLM cleanup. When disabled, you
                  get the raw speech-to-text output.
                </p>
                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">
                      LLM Text Cleanup
                    </p>
                  </div>
                  <Toggle
                    checked={llmCleanupEnabled}
                    onChange={(checked) => setLlmCleanupEnabled(checked)}
                  />
                </div>
              </div>
            </div>

            {/* Cleanup Provider Section */}
            {llmCleanupEnabled && (
              <div className="border-t pt-8">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Cleanup Provider
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Choose which provider handles your LLM text cleanup.
                  </p>

                  <div className="space-y-3">
                    <ProviderRadio
                      id="ppq"
                      name="cleanupProvider"
                      label="Groq"
                      description="Fastest cleanup performance. Cheapest. Your anonymous transcription text is sent to Groq for processing."
                      selected={reasoningProvider === "ppq"}
                      onSelect={() => handleReasoningProviderChange("ppq")}
                    />

                    <ProviderRadio
                      id="local-gemma"
                      name="cleanupProvider"
                      label="Local Gemma"
                      description={`Runs fully on your device via llama.cpp — no network, no API costs, works offline. Requires a one-time ~3.5 GB model download and ~4.5 GB of RAM while running.`}
                      selected={reasoningProvider === "local-gemma"}
                      onSelect={() => handleReasoningProviderChange("local-gemma")}
                      disabled={!llamaServerSupported}
                      disabledReason={
                        !llamaServerSupported
                          ? "Local Gemma is not supported on this platform in v1."
                          : undefined
                      }
                      statusDot={
                        gemmaStatus.running
                          ? { color: "green", title: "Local Gemma running" }
                          : gemmaStatus.starting
                            ? { color: "yellow", title: "Local Gemma starting...", pulse: true }
                            : gemmaStatus.error
                              ? { color: "red", title: `Error: ${gemmaStatus.error}` }
                              : { color: "gray", title: "Local Gemma stopped" }
                      }
                    >
                      <div className="space-y-3">
                        {!llamaServerInstalled && !llamaServerInstalling && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-medium text-amber-900 mb-1">
                              Set up local inference engine
                            </p>
                            <p className="text-xs text-amber-900 mb-3">
                              Local Gemma needs a one-time ~40 MB download of the
                              llama.cpp server binary.
                            </p>
                            <Button size="sm" onClick={handleInstallLlamaServer}>
                              Set Up Local Gemma
                            </Button>
                          </div>
                        )}

                        {llamaServerInstalling && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-medium text-amber-900 mb-2">
                              Installing llama.cpp server… {llamaServerInstallProgress}%
                            </p>
                            <div className="h-2 w-full rounded-full bg-amber-200 overflow-hidden">
                              <div
                                className="h-full bg-amber-500 transition-all"
                                style={{ width: `${llamaServerInstallProgress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {llamaServerInstalled && (
                          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-white p-3">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-foreground">
                                {gemmaInfo?.displayName || "Gemma 4 E2B"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {gemmaInfo?.sizeLabel || "~3.5 GB"} download ·
                                uses {gemmaInfo?.runtimeRamLabel || "~4.5 GB"} RAM
                                while enabled · Q4_K_M quantization
                              </p>
                              {gemmaDownloading && (
                                <div className="mt-2">
                                  <p className="text-xs text-muted-foreground mb-1">
                                    Downloading… {gemmaDownloadProgress}%
                                  </p>
                                  <div className="h-2 w-full rounded-full bg-neutral-200 overflow-hidden">
                                    <div
                                      className="h-full bg-orange-500 transition-all"
                                      style={{
                                        width: `${gemmaDownloadProgress}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                            {gemmaModelStatus.downloaded ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleDeleteGemma}
                                disabled={gemmaDownloading}
                              >
                                Delete
                              </Button>
                            ) : !gemmaDownloading ? (
                              <Button
                                size="sm"
                                onClick={handleDownloadGemma}
                                disabled={!llamaServerInstalled}
                              >
                                Download
                              </Button>
                            ) : null}
                          </div>
                        )}

                        {llamaServerInstalled && gemmaModelStatus.downloaded && (
                          <div className="flex items-center justify-between rounded-lg bg-neutral-50 p-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Stop when idle (saves RAM)
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Unloads the model after 10 minutes without cleanup
                                activity. Next cleanup takes ~30 seconds to re-warm.
                              </p>
                            </div>
                            <Toggle
                              checked={gemmaIdleShutdownEnabled}
                              onChange={handleGemmaIdleShutdownToggle}
                            />
                          </div>
                        )}

                        {gemmaStatus.error && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                            <p className="font-medium mb-1">Local Gemma Error</p>
                            <p>{gemmaStatus.error}</p>
                          </div>
                        )}
                      </div>
                    </ProviderRadio>

                    <ProviderRadio
                      id="tinfoil"
                      name="cleanupProvider"
                      label="Tinfoil"
                      description="Your cleanup requests are encrypted on your device before being sent — processing happens inside a hardware-secured enclave so neither PPQ nor any intermediary can read your data. Slightly slower processing and higher cost."
                      selected={reasoningProvider === "tinfoil"}
                      onSelect={() => handleReasoningProviderChange("tinfoil")}
                      statusDot={
                        proxyStatus.running
                          ? { color: "green", title: "Proxy running" }
                          : proxyStatus.starting
                            ? { color: "yellow", title: "Proxy starting...", pulse: true }
                            : proxyStatus.error
                              ? { color: "red", title: `Error: ${proxyStatus.error}` }
                              : { color: "gray", title: "Proxy stopped" }
                      }
                    >
                      {proxyStatus.error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                          <p className="font-medium mb-1">Tinfoil Error</p>
                          <p>{proxyStatus.error}</p>
                        </div>
                      )}
                    </ProviderRadio>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case "transcription":
        return (
          <div className="space-y-6">
            {/* API Key */}
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

      case "logs":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Diagnostic Logs
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Copy logs to share with the PPQ support team for
                troubleshooting.
              </p>
            </div>

            {/* One-click copy all */}
            <Button onClick={copyDiagnosticLogs} className="w-full">
              {logsCopied ? (
                <>
                  <CheckCircle size={16} className="mr-2" />
                  Copied to Clipboard
                </>
              ) : (
                <>
                  <Copy size={16} className="mr-2" />
                  Copy Diagnostic Logs
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500">
              Copies app version, system info, and recent log entries to your
              clipboard. Paste into an email or support chat.
            </p>

            {/* Log files list */}
            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-800">
                  Log Files
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadLogFiles}
                  disabled={logsLoading}
                >
                  <RefreshCw
                    size={14}
                    className={logsLoading ? "animate-spin" : ""}
                  />
                </Button>
              </div>

              {logFiles.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  <p className="font-medium mb-1">No log files yet</p>
                  <p className="text-xs">
                    Logs are collected automatically and retained for one hour.
                    If the app just started, try again shortly.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => viewLogFile(file.path, file.name)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedLogName === file.name
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-gray-400" />
                          <span className="text-sm font-medium text-gray-800">
                            {file.name}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 ml-6">
                        {new Date(file.modified).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Log content viewer */}
            {selectedLogContent !== null && selectedLogName && (
              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-800">
                    {selectedLogName}
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(selectedLogContent);
                        showAlertDialog({
                          title: "Copied",
                          description:
                            "Log file contents copied to clipboard.",
                        });
                      }}
                    >
                      <Copy size={14} className="mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedLogContent(null);
                        setSelectedLogName(null);
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </div>
                <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-80 whitespace-pre-wrap break-all font-mono">
                  {selectedLogContent || "(empty)"}
                </pre>
              </div>
            )}
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
