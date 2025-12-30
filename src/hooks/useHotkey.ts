import type { Dispatch, SetStateAction } from "react";
import { useSettings } from "./useSettings";

type UseHotkeyResult = {
  hotkey: string;
  setHotkey: Dispatch<SetStateAction<string>>;
};

export const useHotkey = (): UseHotkeyResult => {
  const { dictationKey, setDictationKey } = useSettings();
  const hotkey = dictationKey || "`";

  return {
    hotkey,
    setHotkey: setDictationKey,
  };
};
