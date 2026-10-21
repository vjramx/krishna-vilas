/** Minimum gap between two location uploads for the same order. */
export const LOCATION_SHARE_INTERVAL_MS = 15_000;

/**
 * Whether a new GPS fix should be uploaded now. The first fix always goes out;
 * after that uploads are spaced by LOCATION_SHARE_INTERVAL_MS to keep battery
 * and database writes low while still looking live on the customer's map.
 */
export function shouldSendLocation(lastSentAt: number | null, now: number, intervalMs = LOCATION_SHARE_INTERVAL_MS): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= intervalMs;
}
