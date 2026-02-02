import { useState, useEffect } from "react";

/**
 * Hook to check if macOS "Use F1, F2, etc. keys as standard function keys" is enabled.
 * Returns whether the Fn key is required to trigger actual function keys.
 *
 * - standardFunctionKeys: true = F-keys work as standard (no Fn needed)
 * - standardFunctionKeys: false = F-keys trigger special features (Fn needed)
 */
export function useFnKeyMode() {
  const [standardFunctionKeys, setStandardFunctionKeys] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkFnKeyMode() {
      try {
        const result = await window.electronAPI?.getFnKeyMode?.();
        if (result) {
          setStandardFunctionKeys(result.standardFunctionKeys);
        }
      } catch {
        // Default to standard function keys on error
        setStandardFunctionKeys(true);
      } finally {
        setLoading(false);
      }
    }

    checkFnKeyMode();
  }, []);

  return { standardFunctionKeys, requiresFn: !standardFunctionKeys, loading };
}
