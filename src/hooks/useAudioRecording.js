import { useState, useEffect, useRef } from "react";
import AudioManager from "../helpers/audioManager";

export const useAudioRecording = (toast, settings = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const audioManagerRef = useRef(null);

  useEffect(() => {
    // Initialize AudioManager with settings
    audioManagerRef.current = new AudioManager(settings);

    // Set up callbacks
    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
      },
      onError: (error) => {
        toast({
          title: error.title,
          description: error.description,
          variant: "destructive",
        });
      },
      onTranscriptionComplete: async (result) => {
        if (result.success) {
          setTranscript(result.text);

          // Paste immediately
          await audioManagerRef.current.safePaste(result.text);

          // Save to database in parallel
          audioManagerRef.current.saveTranscription(result.text);

        }
      },
    });

    // Set up hotkey listener
    let recording = false;
    const handleToggle = () => {
      const currentState = audioManagerRef.current.getState();

      if (
        !recording &&
        !currentState.isRecording &&
        !currentState.isProcessing
      ) {
        audioManagerRef.current.startRecording();
        recording = true;
      } else if (currentState.isRecording) {
        audioManagerRef.current.stopRecording();
        recording = false;
      }
    };

    window.electronAPI.onToggleDictation(handleToggle);

    // Cleanup
    return () => {
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [toast, settings.useReasoningModel, settings.reasoningModel, settings.preferredLanguage]);

  // Update settings when they change without recreating the AudioManager
  useEffect(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.updateSettings(settings);
    }
  }, [settings.useReasoningModel, settings.reasoningModel, settings.preferredLanguage]);

  const startRecording = async () => {
    if (audioManagerRef.current) {
      return await audioManagerRef.current.startRecording();
    }
    return false;
  };

  const stopRecording = () => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.stopRecording();
    }
    return false;
  };

  const toggleListening = () => {
    if (!isRecording && !isProcessing) {
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  };

  return {
    isRecording,
    isProcessing,
    transcript,
    startRecording,
    stopRecording,
    toggleListening,
  };
};
