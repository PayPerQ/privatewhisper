import { useState, useCallback, useEffect } from "react";

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
  },
) {
  const serialize = options?.serialize || JSON.stringify;
  const deserialize = options?.deserialize || JSON.parse;

  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        // Persist the default value immediately so it's consistent across windows/sessions
        localStorage.setItem(key, serialize(defaultValue));
        return defaultValue;
      }
      return deserialize(item);
    } catch {
      return defaultValue;
    }
  });

  // Listen for storage changes from other windows
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.newValue !== null) {
        try {
          setState(deserialize(event.newValue));
        } catch {
          // Ignore deserialization errors
        }
      } else if (event.key === key && event.newValue === null) {
        setState(defaultValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [key, defaultValue, deserialize]);

  const setValue = useCallback(
    (value: T | ((prevState: T) => T)) => {
      try {
        setState((prevState) => {
          const valueToStore =
            value instanceof Function ? value(prevState) : value;
          localStorage.setItem(key, serialize(valueToStore));
          return valueToStore;
        });
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, serialize],
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setState(defaultValue);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  return [state, setValue, remove] as const;
}
