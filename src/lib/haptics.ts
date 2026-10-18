/** Android-style haptics — silently no-ops where the device/WebView disallows it. */
export function haptic(ms = 8): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignored */
  }
}
