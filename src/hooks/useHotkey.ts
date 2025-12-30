import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

type UseHotkeyResult = {
  hotkey: string;
  setHotkey: Dispatch<SetStateAction<string>>;
};

export const useHotkey = (): UseHotkeyResult => {
  const [hotkey, setHotkey] = useState<string>("`");

  useEffect(() => {
    const savedHotkey = localStorage.getItem("dictationKey");
    if (savedHotkey) {
      setHotkey(savedHotkey);
    }
  }, []);

  return {
    hotkey,
    setHotkey,
  };
};
