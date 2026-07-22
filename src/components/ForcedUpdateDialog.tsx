import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "./lib/utils";
import { Button } from "./ui/button";

interface ForcedUpdateDialogProps {
  open: boolean;
  version?: string;
  releaseNotes?: string;
  isDownloading: boolean;
  isInstalling: boolean;
  downloadProgress: number;
  updateDownloaded: boolean;
  onDownload: () => void;
  onInstall: () => void;
}

// Stable handlers to prevent dialog from being closed
const noop = () => {};
const preventDefault = (e: Event) => e.preventDefault();

export function ForcedUpdateDialog({
  open,
  version,
  releaseNotes,
  isDownloading,
  isInstalling,
  downloadProgress,
  updateDownloaded,
  onDownload,
  onInstall,
}: ForcedUpdateDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={noop}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          onEscapeKeyDown={preventDefault}
          onPointerDownOutside={preventDefault}
          onInteractOutside={preventDefault}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border border-border bg-white p-0 shadow-[0_8px_32px_rgba(43,31,20,0.2),0_2px_0_rgba(255,255,255,0.8)_inset] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl overflow-hidden",
          )}
        >
          {/* Header with gradient */}
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div>
                <DialogPrimitive.Title className="text-xl font-semibold text-foreground brand-heading">
                  Update Required
                </DialogPrimitive.Title>
                {version && (
                  <p className="text-sm text-muted-foreground">
                    Version {version} is available
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            <DialogPrimitive.Description className="text-sm text-muted-foreground brand-body leading-relaxed">
              We're constantly improving Private Whisper with new features, better
              performance, and important fixes. To ensure you have the best
              experience, please update to the latest version.
            </DialogPrimitive.Description>

            {releaseNotes && (
              <div className="bg-neutral-50 rounded-lg p-3 border border-neutral-100">
                <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
                  What's New
                </h4>
                <p className="text-sm text-neutral-700 line-clamp-3">
                  {releaseNotes}
                </p>
              </div>
            )}

            {/* Progress indicator */}
            {isDownloading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Downloading...</span>
                  <span className="font-medium text-foreground">
                    {downloadProgress}%
                  </span>
                </div>
                <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {updateDownloaded && !isInstalling && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4" />
                <span>Download complete! Ready to install.</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-2">
            {updateDownloaded ? (
              <Button
                onClick={onInstall}
                disabled={isInstalling}
                className="w-full h-11 text-base font-medium"
              >
                {isInstalling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Install Update & Restart
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={onDownload}
                disabled={isDownloading}
                className="w-full h-11 text-base font-medium"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Downloading... {downloadProgress}%
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download Update
                  </>
                )}
              </Button>
            )}

            <p className="text-xs text-center text-muted-foreground mt-3">
              The app will restart automatically after installation.
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
