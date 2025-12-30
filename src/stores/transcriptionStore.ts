import { useSyncExternalStore } from "react";
import type { TranscriptionItem } from "../types/electron";

interface TranscriptionStoreState {
  items: TranscriptionItem[];
  isLoading: boolean;
  error?: string;
}

const DEFAULT_STATE: TranscriptionStoreState = {
  items: [],
  isLoading: true,
};

type StoreListener = () => void;

class TranscriptionStore {
  private state: TranscriptionStoreState = DEFAULT_STATE;
  private listeners = new Set<StoreListener>();
  private initialized = false;

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private setState(partial: Partial<TranscriptionStoreState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private async hydrate() {
    if (typeof window === "undefined") {
      this.setState({ isLoading: false });
      return;
    }

    try {
      const transcriptions =
        (await window.electronAPI?.getTranscriptions?.(50)) ?? [];
      this.setState({
        items: transcriptions,
        isLoading: false,
        error: undefined,
      });
    } catch (error) {
      this.setState({
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load transcriptions.",
      });
    }
  }

  private attachIpcListeners() {
    if (typeof window === "undefined") {
      return;
    }

    window.electronAPI?.onTranscriptionAdded?.((item) => {
      this.setState({
        items: [
          item,
          ...this.state.items.filter((entry) => entry.id !== item.id),
        ],
      });
    });

    window.electronAPI?.onTranscriptionDeleted?.((id) => {
      this.setState({
        items: this.state.items.filter((entry) => entry.id !== id),
      });
    });

    window.electronAPI?.onTranscriptionsCleared?.(() => {
      this.setState({ items: [] });
    });
  }

  private ensureInitialized() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    void this.hydrate();
    this.attachIpcListeners();
  }

  subscribe(listener: StoreListener) {
    this.ensureInitialized();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }
}

const store = new TranscriptionStore();

const subscribe = (listener: StoreListener) => store.subscribe(listener);
const getSnapshot = () => store.getState();

export function useTranscriptionStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE);
}
