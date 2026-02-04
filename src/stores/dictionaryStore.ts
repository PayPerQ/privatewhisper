import { useSyncExternalStore } from "react";
import type { DictionaryTerm } from "../types/electron";
import createDebugLogger from "../utils/debugLoggerRenderer";

const debugLogger = createDebugLogger("dictionary-store");

interface DictionaryStoreState {
  items: DictionaryTerm[];
  isLoading: boolean;
  error?: string;
}

const DEFAULT_STATE: DictionaryStoreState = {
  items: [],
  isLoading: true,
};

type StoreListener = () => void;

class DictionaryStore {
  private state: DictionaryStoreState = DEFAULT_STATE;
  private listeners = new Set<StoreListener>();
  private initialized = false;

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private setState(partial: Partial<DictionaryStoreState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private async hydrate() {
    if (typeof window === "undefined") {
      this.setState({ isLoading: false });
      return;
    }

    try {
      const terms = (await window.electronAPI?.getDictionary?.()) ?? [];
      void debugLogger.log("HYDRATED", {
        termCount: terms.length,
        termsPreview: terms.slice(0, 3).map((t) => t.term),
      });
      this.setState({
        items: terms,
        isLoading: false,
        error: undefined,
      });
    } catch (error) {
      void debugLogger.log("HYDRATE_FAILED", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setState({
        isLoading: false,
        error:
          error instanceof Error ? error.message : "Failed to load dictionary.",
      });
    }
  }

  private attachIpcListeners() {
    if (typeof window === "undefined") {
      return;
    }

    window.electronAPI?.onDictionaryTermAdded?.((term) => {
      this.setState({
        items: [
          term,
          ...this.state.items.filter((entry) => entry.id !== term.id),
        ],
      });
    });

    window.electronAPI?.onDictionaryTermRemoved?.((id) => {
      this.setState({
        items: this.state.items.filter((entry) => entry.id !== id),
      });
    });

    window.electronAPI?.onDictionaryCleared?.(() => {
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

const store = new DictionaryStore();

const subscribe = (listener: StoreListener) => store.subscribe(listener);
const getSnapshot = () => store.getState();

export function useDictionary() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE);
}
