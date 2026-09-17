/**
 * Determines if a microphone device is a built-in device based on its label.
 * Works across macOS, Windows, and Linux platforms.
 * Ported from OpenWhispr (src/utils/audioDeviceUtils.ts).
 */
export function isBuiltInMicrophone(label: string): boolean {
  const lowerLabel = (label || "").toLowerCase();

  // Direct built-in indicators
  if (
    lowerLabel.includes("built-in") ||
    lowerLabel.includes("builtin") ||
    lowerLabel.includes("internal") ||
    lowerLabel.includes("macbook") ||
    lowerLabel.includes("integrated")
  ) {
    return true;
  }

  // Generic "microphone" without external device indicators — covers Windows
  // laptop labels like "Microphone Array on SoundWire Device" or
  // "Microphone (Realtek(R) Audio)". Indicators are matched with the word
  // "microphone" removed so "phone" flags "iPhone"/"Headphones" without
  // matching the "phone" inside "microphone" itself.
  if (lowerLabel.includes("microphone")) {
    const labelWithoutMicrophone = lowerLabel.replace(/microphone/g, " ");
    const externalIndicators = [
      "bluetooth",
      "airpods",
      "wireless",
      "usb",
      "external",
      "headset",
      "webcam",
      "iphone",
      "ipad",
      // Phones connected via Continuity/Bluetooth carry their own name
      // (e.g. "Galaxy Cell Microphone") and must never be treated as built-in.
      "cell",
      "phone",
      "continuity",
    ];
    return !externalIndicators.some((indicator) =>
      labelWithoutMicrophone.includes(indicator),
    );
  }

  return false;
}
