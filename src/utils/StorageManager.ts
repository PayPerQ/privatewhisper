class StorageManager {
  static getLocalStorageValue<T>(
    key: string,
    defaultValue: T,
    parser?: (value: string) => T
  ): T {
    if (typeof window === "undefined" || !window.localStorage) {
      return defaultValue;
    }

    const value = window.localStorage.getItem(key);
    if (!value) {
      return defaultValue;
    }

    if (parser) {
      try {
        return parser(value);
      } catch (error) {
        return defaultValue;
      }
    }

    return value as unknown as T;
  }

  static setLocalStorageValue(key: string, value: string) {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
      return true;
    }
    return false;
  }

  static removeLocalStorageValue(key: string) {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
      return true;
    }
    return false;
  }
}

export default StorageManager;
