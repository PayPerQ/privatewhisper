import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Trash2,
  Settings,
  FileText,
  Mic,
  X,
  Download,
  Loader2,
} from "lucide-react";
import SettingsModal from "./SettingsModal";
import TitleBar from "./TitleBar";
import SupportDropdown from "./ui/SupportDropdown";
import TranscriptionItem from "./ui/TranscriptionItem";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { ForcedUpdateDialog } from "./ForcedUpdateDialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import ChatwootWidget from "./ChatwootWidget";

export default function ControlPanel() {
  const { items: history, isLoading } = useTranscriptionStore();
  const [showSettings, setShowSettings] = useState(false);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const [updateStatus, setUpdateStatus] = useState({
    updateAvailable: false,
    updateDownloaded: false,
    isDevelopment: false,
  });
  const [updateInfo, setUpdateInfo] = useState<{
    version?: string;
    releaseNotes?: string;
  }>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const isWindows =
    typeof window !== "undefined" &&
    window.electronAPI?.getPlatform?.() === "win32";

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const handleClose = () => {
    void window.electronAPI.windowClose();
  };

  useEffect(() => {
    // Initialize update status
    const initializeUpdateStatus = async () => {
      try {
        const status = await window.electronAPI.getUpdateStatus();
        setUpdateStatus(status);
        // If an update is already available, fetch its info
        if (status.updateAvailable || status.updateDownloaded) {
          const updateData = await window.electronAPI.getUpdateInfo();
          if (updateData) {
            setUpdateInfo({
              version: updateData.version,
              releaseNotes: updateData.releaseNotes,
            });
          }
        }
      } catch (_error) {
        // Update status not critical for app function
      }
    };

    initializeUpdateStatus();

    // Set up update event listeners
    const handleUpdateAvailable = async (_event: any, info: any) => {
      setUpdateStatus((prev) => ({ ...prev, updateAvailable: true }));
      // Capture version and release notes from the event
      if (info?.version) {
        setUpdateInfo({
          version: info.version,
          releaseNotes: info.releaseNotes,
        });
      } else {
        // Fallback: fetch from IPC if not in event payload
        try {
          const updateData = await window.electronAPI.getUpdateInfo();
          if (updateData) {
            setUpdateInfo({
              version: updateData.version,
              releaseNotes: updateData.releaseNotes,
            });
          }
        } catch (_e) {
          // Update info not critical
        }
      }
    };

    const handleUpdateDownloaded = (_event: any, _info: any) => {
      setUpdateStatus((prev) => ({ ...prev, updateDownloaded: true }));
      setIsDownloading(false);
      setDownloadProgress(100);
    };

    const handleUpdateError = (_event: any, _error: any) => {
      setIsDownloading(false);
      setIsInstalling(false);
    };

    const handleDownloadProgress = (_event: any, progress: any) => {
      setDownloadProgress(Math.round(progress.percent || 0));
    };

    const handleInstallTimeout = (_event: any, info: any) => {
      setIsInstalling(false);
      showAlertDialog({
        title: "Still Running",
        description:
          info?.message ||
          "PPQ Whisper didn't restart automatically. Please quit the app manually to finish installing the update.",
      });
    };

    window.electronAPI.onUpdateAvailable(handleUpdateAvailable);
    window.electronAPI.onUpdateDownloaded(handleUpdateDownloaded);
    window.electronAPI.onUpdateError(handleUpdateError);
    window.electronAPI.onUpdateDownloadProgress(handleDownloadProgress);
    window.electronAPI.onUpdateInstallTimeout?.(handleInstallTimeout);

    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners?.("update-available");
      window.electronAPI.removeAllListeners?.("update-downloaded");
      window.electronAPI.removeAllListeners?.("update-error");
      window.electronAPI.removeAllListeners?.("update-download-progress");
      window.electronAPI.removeAllListeners?.("update-install-timeout");
    };
  }, [showAlertDialog]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "Text copied to your clipboard",
        variant: "success",
        duration: 2000,
      });
    } catch (_error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy text to clipboard",
        variant: "destructive",
      });
    }
  };

  const clearHistory = async () => {
    showConfirmDialog({
      title: "Clear History",
      description:
        "Are you certain you wish to clear all inscribed records? This action cannot be undone.",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.clearTranscriptions();
          showAlertDialog({
            title: "History Cleared",
            description: `Successfully cleared ${result.cleared} transcriptions from your chronicles.`,
          });
        } catch (_error) {
          showAlertDialog({
            title: "Error",
            description: "Failed to clear history. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const deleteTranscription = async (id: number) => {
    showConfirmDialog({
      title: "Delete Transcription",
      description:
        "Are you certain you wish to remove this inscription from your records?",
      onConfirm: async () => {
        try {
          const result = await window.electronAPI.deleteTranscription(id);
          if (!result.success) {
            showAlertDialog({
              title: "Delete Failed",
              description:
                "Failed to delete transcription. It may have already been removed.",
            });
          }
        } catch (_error) {
          showAlertDialog({
            title: "Delete Failed",
            description: "Failed to delete transcription. Please try again.",
          });
        }
      },
      variant: "destructive",
    });
  };

  const handleInstallUpdate = async () => {
    if (updateStatus.updateDownloaded) {
      showConfirmDialog({
        title: "Install Update",
        description:
          "The app will restart to install the update. Any unsaved work will be lost.",
        onConfirm: async () => {
          try {
            setIsInstalling(true);
            const result = await window.electronAPI.installUpdate();
            if (!result?.success) {
              setIsInstalling(false);
              showAlertDialog({
                title: "Install Failed",
                description:
                  result?.message ||
                  "Failed to start the installer. Please try again.",
              });
              return;
            }
          } catch (_error) {
            setIsInstalling(false);
            toast({
              title: "Update Failed",
              description: "Failed to install update. Please try again.",
              variant: "destructive",
            });
          }
        },
      });
    } else if (updateStatus.updateAvailable) {
      try {
        setIsDownloading(true);
        setDownloadProgress(0);
        await window.electronAPI.downloadUpdate();
      } catch (_error) {
        setIsDownloading(false);
        toast({
          title: "Download Failed",
          description: "Failed to download update. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const handleForcedDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      await window.electronAPI.downloadUpdate();
    } catch (_error) {
      setIsDownloading(false);
      toast({
        title: "Download Failed",
        description: "Failed to download update. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleForcedInstall = async () => {
    try {
      setIsInstalling(true);
      const result = await window.electronAPI.installUpdate();
      if (!result?.success) {
        setIsInstalling(false);
        toast({
          title: "Install Failed",
          description:
            result?.message ||
            "Failed to start the installer. Please try again.",
          variant: "destructive",
        });
      }
    } catch (_error) {
      setIsInstalling(false);
      toast({
        title: "Update Failed",
        description: "Failed to install update. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Show forced update dialog when update is available (production only)
  const showForcedUpdate =
    !updateStatus.isDevelopment &&
    (updateStatus.updateAvailable || updateStatus.updateDownloaded);

  return (
    <div className="min-h-screen bg-white">
      <ChatwootWidget />
      <ForcedUpdateDialog
        open={showForcedUpdate}
        version={updateInfo.version}
        releaseNotes={updateInfo.releaseNotes}
        isDownloading={isDownloading}
        isInstalling={isInstalling}
        downloadProgress={downloadProgress}
        updateDownloaded={updateStatus.updateDownloaded}
        onDownload={handleForcedDownload}
        onInstall={handleForcedInstall}
      />
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      <TitleBar
        actions={
          <>
            {/* Update button - shows when update is available or downloaded */}
            {!updateStatus.isDevelopment &&
              (updateStatus.updateAvailable ||
                updateStatus.updateDownloaded) && (
                <Button
                  variant={
                    updateStatus.updateDownloaded ? "default" : "outline"
                  }
                  size="sm"
                  onClick={handleInstallUpdate}
                  disabled={isDownloading || isInstalling}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isInstalling ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Installing...
                    </>
                  ) : isDownloading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {downloadProgress}%
                    </>
                  ) : updateStatus.updateDownloaded ? (
                    <>
                      <Download size={14} />
                      Install Update
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      Update Available
                    </>
                  )}
                </Button>
              )}
            <SupportDropdown />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings size={16} />
            </Button>
            {isWindows && (
              <div className="flex items-center gap-1 ml-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleClose}
                  aria-label="Close window"
                >
                  <X size={14} />
                </Button>
              </div>
            )}
          </>
        }
      />

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />

      {/* Main content */}
      <div className="p-6">
        <div className="space-y-6 max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-primary" />
                  Recent Transcriptions
                </CardTitle>
                <div className="flex gap-2">
                  {history.length > 0 && (
                    <Button
                      onClick={clearHistory}
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 mx-auto mb-3 bg-primary rounded-lg flex items-center justify-center">
                    <span className="text-primary-foreground text-sm">📝</span>
                  </div>
                  <p className="text-neutral-600">Loading transcriptions...</p>
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 bg-neutral-100 rounded-full flex items-center justify-center">
                    <Mic className="w-8 h-8 text-neutral-400" />
                  </div>
                  <h3 className="text-lg font-medium text-neutral-900 mb-2">
                    No transcriptions yet
                  </h3>
                  <p className="text-neutral-600 mb-4 max-w-sm mx-auto">
                    Press your hotkey to start recording and create your first
                    transcription.
                  </p>
                  <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 max-w-md mx-auto">
                    <h4 className="font-medium text-neutral-800 mb-2">
                      Quick Start:
                    </h4>
                    <ol className="text-sm text-neutral-600 text-left space-y-1">
                      <li>1. Click in any text field</li>
                      <li>
                        2. Press{" "}
                        <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-neutral-300">
                          {hotkey}
                        </kbd>{" "}
                        to start recording
                      </li>
                      <li>3. Speak your text</li>
                      <li>
                        4. Press{" "}
                        <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-neutral-300">
                          {hotkey}
                        </kbd>{" "}
                        again to stop
                      </li>
                      <li>5. Your text will appear automatically!</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {history.map((item, index) => (
                    <TranscriptionItem
                      key={item.id}
                      item={item}
                      index={index}
                      total={history.length}
                      onCopy={copyToClipboard}
                      onDelete={deleteTranscription}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
