const LETTER_KEYCODES = {
  A: 0,
  S: 1,
  D: 2,
  F: 3,
  H: 4,
  G: 5,
  Z: 6,
  X: 7,
  C: 8,
  V: 9,
  B: 11,
  Q: 12,
  W: 13,
  E: 14,
  R: 15,
  Y: 16,
  T: 17,
  O: 31,
  U: 32,
  I: 34,
  P: 35,
  L: 37,
  J: 38,
  K: 40,
  N: 45,
  M: 46,
};

const NUMBER_KEYCODES = {
  1: 18,
  2: 19,
  3: 20,
  4: 21,
  6: 22,
  5: 23,
  "=": 24,
  9: 25,
  7: 26,
  "-": 27,
  8: 28,
  0: 29,
};

const SYMBOL_KEYCODES = {
  "]": 30,
  "[": 33,
  "\\": 42,
  ";": 41,
  "'": 39,
  ",": 43,
  ".": 47,
  "/": 44,
  "`": 50,
};

const NAMED_KEYCODES = {
  SPACE: 49,
  TAB: 48,
  ENTER: 36,
  RETURN: 36,
  ESCAPE: 53,
  ESC: 53,
};

function macKeyCodeFromHotkey(hotkey) {
  if (!hotkey || typeof hotkey !== "string") return null;
  const trimmed = hotkey.trim();
  if (!trimmed) return null;

  const upper =
    trimmed.length === 1 ? trimmed.toUpperCase() : trimmed.toUpperCase();

  if (LETTER_KEYCODES[upper] !== undefined) return LETTER_KEYCODES[upper];
  if (NUMBER_KEYCODES[upper] !== undefined) return NUMBER_KEYCODES[upper];
  if (SYMBOL_KEYCODES[upper] !== undefined) return SYMBOL_KEYCODES[upper];
  if (NAMED_KEYCODES[upper] !== undefined) return NAMED_KEYCODES[upper];

  return null;
}

function matchesMacKeyCode(hotkey, keyCode) {
  const code = macKeyCodeFromHotkey(hotkey);
  if (code === null || keyCode === undefined || keyCode === null) return false;
  return Number(code) === Number(keyCode);
}

module.exports = {
  macKeyCodeFromHotkey,
  matchesMacKeyCode,
};
