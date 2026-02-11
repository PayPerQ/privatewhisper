import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Mic,
  Key,
  Shield,
  Keyboard,
  Sparkles,
  Globe,
  ExternalLink,
} from "lucide-react";
import flame2 from "../assets/flame2.png";
import visaMcLogo from "../assets/visa_mc_background_transparent.png";
import cryptoLogos from "../assets/crypto_payment_logos.png";
import TitleBar from "./TitleBar";
import ApiKeyInput from "./ui/ApiKeyInput";
import PermissionCard from "./ui/PermissionCard";
import StepProgress from "./ui/StepProgress";
import { AlertDialog } from "./ui/dialog";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useSettings } from "../hooks/useSettings";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { formatHotkeyLabel } from "../utils/hotkeys";
import LanguageSelector from "./ui/LanguageSelector";
import HotkeyInput from "./ui/HotkeyInput";
import { HotkeyGuidelines } from "./ui/HotkeyGuidelines";
import { PPQ_WEBSITE_URL } from "../config/constants";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep, removeCurrentStep] = useLocalStorage(
    "onboardingCurrentStep",
    0,
    {
      serialize: String,
      deserialize: (value) => parseInt(value, 10),
    },
  );

  const {
    preferredLanguage,
    ppqApiKey,
    dictationKey,
    setDictationKey,
    updateTranscriptionSettings,
    updateApiKeys,
  } = useSettings();

  const [apiKey, setApiKey] = useState(ppqApiKey);
  const detectedPlatform = window.electronAPI?.getPlatform?.() || "";
  const defaultHotkey = detectedPlatform === "darwin" ? "GLOBE" : "Shift+F9";
  const [hotkey, setHotkey] = useState(dictationKey || defaultHotkey);
  const isMacOS = detectedPlatform === "darwin";
  // Accessibility permissions are only required on macOS - auto-granted on Windows/Linux
  const requiresAccessibilityPermission = isMacOS;
  const readableHotkey = formatHotkeyLabel(hotkey);
  const { alertDialog, showAlertDialog, hideAlertDialog } = useDialogs();
  const { registerHotkey, isRegistering: isRegisteringHotkey } =
    useHotkeyRegistration({
      onSuccess: (key) => {
        // Mark that user has manually changed the hotkey - cancels any in-flight auto-register
        userChangedHotkeyRef.current = true;
        setHotkey(key);
      },
    });
  const practiceTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Tracks whether auto-registration is in flight (prevents double-invoke in StrictMode)
  const autoRegisterInFlightRef = useRef(false);
  // Tracks whether user has manually changed the hotkey (cancels auto-register)
  const userChangedHotkeyRef = useRef(false);
  const permissionsHook = usePermissions(showAlertDialog);
  const openApiDocs = useCallback(() => {
    window.electronAPI?.openExternal?.(`${PPQ_WEBSITE_URL}/api-docs`);
  }, []);

  const openWhisperOnboarding = useCallback(() => {
    window.electronAPI?.openExternal?.(`${PPQ_WEBSITE_URL}/whisper-onboarding`);
  }, []);

  const persistApiKey = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return false;

    try {
      // Require the IPC handler to be available
      if (!window.electronAPI?.savePPQKey) {
        showAlertDialog({
          title: "API Key Save Failed",
          description: "Unable to save settings. Please restart the app.",
        });
        return false;
      }

      const result = await window.electronAPI.savePPQKey(trimmedKey);

      // Check if the save operation succeeded
      if (!result?.success) {
        showAlertDialog({
          title: "API Key Save Failed",
          description:
            result?.error || "We couldn't save your key. Please try again.",
        });
        return false;
      }

      // Only update localStorage after .env save succeeds
      updateApiKeys({ ppqApiKey: trimmedKey });
      return true;
    } catch (_error) {
      showAlertDialog({
        title: "API Key Save Failed",
        description: "We couldn't save your key. Please try again.",
      });
      return false;
    }
  }, [apiKey, updateApiKeys, showAlertDialog]);

  const steps = [
    { title: "Welcome", icon: Sparkles },
    { title: "Language", icon: Globe },
    { title: "Permissions", icon: Shield },
    { title: "API Key", icon: Key },
    { title: "Hotkey", icon: Keyboard },
  ];

  useEffect(() => {
    if (currentStep === 4 && practiceTextareaRef.current) {
      practiceTextareaRef.current.focus();
    }
  }, [currentStep]);

  // Auto-register the default hotkey when entering step 4 (hotkey step)
  // This ensures the default Globe key (or any default) works immediately
  // without requiring the user to explicitly select it first
  // Note: This is silent (no toast) - user can still manually change it
  useEffect(() => {
    if (currentStep !== 4) return;
    if (!window.electronAPI?.updateHotkey) return;
    // Prevent double-invoke in React.StrictMode
    if (autoRegisterInFlightRef.current) return;

    // Capture the hotkey at effect start to detect if user changes it mid-flight
    const hotkeyAtStart = hotkey;

    const autoRegisterDefaultHotkey = async () => {
      autoRegisterInFlightRef.current = true;
      try {
        // If user already changed the hotkey, skip auto-registration
        if (userChangedHotkeyRef.current) {
          return;
        }
        const result = await window.electronAPI.updateHotkey(hotkeyAtStart);
        // After await: check again if user changed hotkey while we were waiting
        // If so, don't log success/failure for the stale auto-register
        if (userChangedHotkeyRef.current) {
          return;
        }
        if (!result?.success) {
          console.warn(
            "Auto-registration of default hotkey failed:",
            result?.message,
          );
        }
      } catch (error) {
        if (!userChangedHotkeyRef.current) {
          console.warn("Failed to auto-register default hotkey:", error);
        }
      } finally {
        autoRegisterInFlightRef.current = false;
      }
    };

    void autoRegisterDefaultHotkey();
    // Only run when entering step 4, not when hotkey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Used by saveSettings to ensure hotkey is registered before completing onboarding
  const attemptHotkeyRegistration = useCallback(async () => {
    return registerHotkey(hotkey);
  }, [hotkey, registerHotkey]);

  const saveSettings = useCallback(async () => {
    const hotkeyRegistered = await attemptHotkeyRegistration();
    if (!hotkeyRegistered) {
      return false;
    }

    updateTranscriptionSettings({
      preferredLanguage,
    });
    setDictationKey(hotkey);

    localStorage.setItem(
      "micPermissionGranted",
      permissionsHook.micPermissionGranted.toString(),
    );
    localStorage.setItem(
      "accessibilityPermissionGranted",
      permissionsHook.accessibilityPermissionGranted.toString(),
    );
    localStorage.setItem("onboardingCompleted", "true");

    if (apiKey.trim()) {
      const saved = await persistApiKey();
      if (!saved) {
        return false;
      }
    }

    return true;
  }, [
    attemptHotkeyRegistration,
    hotkey,
    preferredLanguage,
    permissionsHook.micPermissionGranted,
    permissionsHook.accessibilityPermissionGranted,
    apiKey,
    updateTranscriptionSettings,
    updateApiKeys,
    setDictationKey,
    persistApiKey,
  ]);

  const nextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) {
      return;
    }

    if (currentStep === 3) {
      const saved = await persistApiKey();
      if (!saved) {
        return;
      }
    }

    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    // Show dictation panel when moving from API Key step (3) to hotkey step (4)
    if (currentStep === 3 && newStep === 4) {
      if (window.electronAPI?.showDictationPanel) {
        window.electronAPI.showDictationPanel();
      }
    }
  }, [currentStep, persistApiKey, setCurrentStep, steps.length]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
    }
  }, [currentStep, setCurrentStep]);

  const finishOnboarding = useCallback(async () => {
    const saved = await saveSettings();
    if (!saved) {
      return;
    }
    removeCurrentStep();
    onComplete();
  }, [saveSettings, removeCurrentStep, onComplete]);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div
            className="text-center space-y-6"
            style={{ fontFamily: "Noto Sans, sans-serif" }}
          >
            <div className="w-16 h-16 mx-auto bg-accent rounded-full flex items-center justify-center">
              <img src={flame2} alt="" className="w-10 h-10" />
            </div>
            <div>
              <h2
                className="text-2xl font-bold text-stone-900 mb-2"
                style={{ fontFamily: "Noto Sans, sans-serif" }}
              >
                Welcome to PPQ Whisper
              </h2>
              <p
                className="text-stone-600"
                style={{ fontFamily: "Noto Sans, sans-serif" }}
              >
                Let's set up your voice dictation in just a few simple steps.
              </p>
            </div>
            <div className="bg-accent/50 p-4 rounded-lg border border-accent">
              <p
                className="text-sm text-accent-foreground"
                style={{ fontFamily: "Noto Sans, sans-serif" }}
              >
                🎤 Turn your voice into text instantly
                <br />⚡ Works anywhere on your computer
              </p>
            </div>
          </div>
        );

      case 1: // Language
        return (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Choose Your Language
              </h2>
              <p className="text-gray-600">
                Select the language you primarily speak for better transcription
                accuracy.
              </p>
            </div>

            <div className="max-w-md mx-auto">
              <div className="space-y-4 p-6 bg-white border border-stone-200 rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <Globe className="w-8 h-8 text-primary" />
                  <div>
                    <h3 className="font-semibold text-stone-900">
                      Preferred Language
                    </h3>
                  </div>
                </div>
                <p className="text-sm text-stone-600">
                  Transcription is fastest when it knows what to expect. You can
                  change this later in Settings.
                </p>
                <LanguageSelector
                  value={preferredLanguage}
                  onChange={(value) =>
                    updateTranscriptionSettings({ preferredLanguage: value })
                  }
                />
                <p className="text-xs text-stone-500">
                  Leave on Auto-detect if you frequently switch languages
                  mid-dictation.
                </p>
              </div>
            </div>
          </div>
        );

      case 2: // Permissions
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Grant Permissions
              </h2>
              <p className="text-gray-600">
                PPQ Whisper needs{" "}
                {requiresAccessibilityPermission
                  ? "a couple of permissions"
                  : "microphone access"}{" "}
                to work properly
              </p>
            </div>

            <div className="space-y-4">
              <PermissionCard
                icon={Mic}
                title="Microphone Access"
                description="Required to record your voice"
                granted={permissionsHook.micPermissionGranted}
                onRequest={permissionsHook.requestMicPermission}
                buttonText="Grant Access"
              />

              {/* Accessibility permission is only required on macOS */}
              {requiresAccessibilityPermission && (
                <PermissionCard
                  icon={Shield}
                  title="Accessibility Permission"
                  description="Required to paste text automatically"
                  granted={permissionsHook.accessibilityPermissionGranted}
                  onRequest={permissionsHook.testAccessibilityPermission}
                  buttonText="Test & Grant"
                />
              )}
            </div>
          </div>
        );

      case 3: // API Key
        return (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Add Your API Key
              </h2>
              <p className="text-gray-600">
                Enter your PPQ API key to enable voice transcription.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {/* Existing user - Enter key */}
              <div className="space-y-4 p-6 bg-white border border-border rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <Key className="w-8 h-8 text-primary" />
                  <div>
                    <h3 className="font-semibold text-foreground">
                      I have a key
                    </h3>
                  </div>
                </div>
                <ApiKeyInput
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  label="PPQ API Key"
                  helpText={
                    <span className="text-xs text-muted-foreground">
                      Existing PPQ users can retrieve their key{" "}
                      <button
                        type="button"
                        className="text-link underline hover:opacity-80"
                        onClick={openApiDocs}
                      >
                        here
                      </button>
                      .
                    </span>
                  }
                />
              </div>

              {/* New user - Get a key */}
              <div className="space-y-4 p-6 bg-white border border-border rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <img src={flame2} alt="" className="w-8 h-8" />
                  <div>
                    <h3 className="font-semibold text-foreground">
                      I need a key
                    </h3>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-stone-600">
                  <p className="text-sm font-medium text-neutral-700">
                    Pay-as-you-go. No expensive subscriptions.
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>Users spend an average of only ~$2.75/month!</li>
                    <li>Maximum charge in a 30-day window is $6!</li>
                    <li>Automatic topups optional</li>
                  </ul>
                </div>

                <div className="flex items-center justify-center gap-4 py-2">
                  <img
                    src={visaMcLogo}
                    alt="Visa and Mastercard accepted"
                    className="h-6 object-contain"
                  />
                  <img
                    src={cryptoLogos}
                    alt="Crypto payments accepted"
                    className="h-6 object-contain"
                  />
                </div>

                <p className="text-xs text-stone-600 text-center">
                  Deposit as little as $5 with card or 10¢ with crypto
                </p>

                <Button
                  onClick={openWhisperOnboarding}
                  variant="outline"
                  className="w-full"
                >
                  Get a Key
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        );

      case 4: // Choose Hotkey & Practice (combined step)
        return (
          <div
            className="space-y-6"
            style={{ fontFamily: "Noto Sans, sans-serif" }}
          >
            <div className="text-center">
              <h2 className="text-2xl font-bold text-stone-900 mb-2">
                Choose Your Hotkey
              </h2>
              <p className="text-stone-600">
                Click below and press any key or combination (Ctrl+key, Alt+key)
                to set your dictation trigger
              </p>
            </div>

            {/* Hotkey input using shared component */}
            <HotkeyInput
              value={hotkey}
              onSave={registerHotkey}
              isSaving={isRegisteringHotkey}
              showGlobeOption={isMacOS}
            />

            <HotkeyGuidelines
              platform={detectedPlatform as "darwin" | "win32" | "linux"}
              currentHotkey={hotkey}
              onSelect={registerHotkey}
              disabled={isRegisteringHotkey}
            />

            {/* Practice section */}
            <div className="bg-accent/50 p-6 rounded-xl border border-accent">
              <h3 className="font-semibold text-foreground mb-3">
                Try it out!
              </h3>
              <p className="text-sm text-accent-foreground mb-4">
                Click in the text area below, hold{" "}
                <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-border">
                  {readableHotkey}
                </kbd>{" "}
                to start recording, speak, then release it to stop.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-stone-500 text-sm">
                  <Mic className="w-4 h-4" />
                  <span>Your transcribed text will appear below</span>
                </div>
                <Textarea
                  ref={practiceTextareaRef}
                  rows={3}
                  placeholder="Click here, then use your hotkey to dictate..."
                  className="resize-none"
                />
              </div>
            </div>

            {/* Quick tips */}
            <div className="bg-green-50/50 p-4 rounded-lg border border-green-200/60">
              <h4 className="font-medium text-green-900 mb-2">Quick tip</h4>
              <p className="text-sm text-green-800">
                After setup, press{" "}
                <kbd className="bg-white px-2 py-1 rounded text-xs font-mono border border-green-200">
                  {readableHotkey}
                </kbd>{" "}
                from anywhere on your computer to start dictating into any text
                field!
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const canProceed = () => {
    let canAdvance = false;
    switch (currentStep) {
      case 0:
        canAdvance = true;
        break;
      case 1:
        // Language selection - always allow proceeding (auto-detect is valid)
        canAdvance = true;
        break;
      case 2:
        // On macOS, both mic and accessibility permissions are required
        // On Windows/Linux, only mic permission is needed (accessibility is auto-granted)
        canAdvance = requiresAccessibilityPermission
          ? permissionsHook.micPermissionGranted &&
            permissionsHook.accessibilityPermissionGranted
          : permissionsHook.micPermissionGranted;
        break;
      case 3:
        canAdvance = apiKey.trim().length > 0;
        break;
      case 4:
        // Combined hotkey + practice step - just need a valid hotkey
        canAdvance = hotkey.trim() !== "";
        break;
      default:
        canAdvance = false;
    }

    return canAdvance && !isRegisteringHotkey;
  };

  // Load Google Font only in the browser
  React.useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div
      className="h-screen flex flex-col bg-stone-50"
      style={{
        fontFamily: "Noto Sans, sans-serif",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />
      {/* Title Bar */}
      <div className="flex-shrink-0 z-10">
        <TitleBar
          showTitle={true}
          className="bg-white/95 backdrop-blur-xl border-b border-stone-200/60 shadow-sm"
        ></TitleBar>
      </div>

      {/* Progress Bar */}
      <div className="flex-shrink-0 bg-white/90 backdrop-blur-xl border-b border-stone-200/60 p-6 md:px-16 z-10">
        <div className="max-w-4xl mx-auto">
          <StepProgress steps={steps} currentStep={currentStep} />
        </div>
      </div>

      {/* Content - This will grow to fill available space */}
      <div className="flex-1 px-6 md:pl-16 md:pr-6 py-12 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white/95 backdrop-blur-xl border border-stone-200/60 shadow-lg rounded-2xl">
            <CardContent
              className="p-12 md:p-16"
              style={{ fontFamily: "Noto Sans, sans-serif" }}
            >
              <div className="space-y-8">{renderStep()}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer - This will stick to the bottom */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-xl border-t border-stone-200/60 px-6 md:pl-16 md:pr-6 py-8 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Button
            onClick={prevStep}
            variant="outline"
            disabled={currentStep === 0}
            className="px-8 py-3 h-12 text-sm font-medium"
            style={{ fontFamily: "Noto Sans, sans-serif" }}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>

          <div className="flex items-center gap-3">
            {currentStep === steps.length - 1 ? (
              <Button
                onClick={() => void finishOnboarding()}
                disabled={!canProceed()}
                className="bg-green-600 hover:bg-green-700 px-8 py-3 h-12 text-sm font-medium"
                style={{ fontFamily: "Noto Sans, sans-serif" }}
              >
                <Check className="w-4 h-4 mr-2" />
                Finish Setup
              </Button>
            ) : (
              <Button
                onClick={() => void nextStep()}
                disabled={!canProceed()}
                className="px-8 py-3 h-12 text-sm font-medium"
                style={{ fontFamily: "Noto Sans, sans-serif" }}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
