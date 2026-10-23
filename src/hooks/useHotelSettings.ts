import { useCallback, useEffect, useState } from 'react';
import type { HotelSettings } from '@/types/db';
import { supabase } from '@/lib/supabase';

let cached: HotelSettings | null = null;

/** Cross-screen sync: when any screen writes + refetches settings (e.g. the
 * Settings page flips the fulfillment mode), every other mounted hook mirrors
 * the new row immediately instead of serving its own stale snapshot. */
type SettingsListener = (row: HotelSettings) => void;
const listeners = new Set<SettingsListener>();
function publish(row: HotelSettings) {
  cached = row;
  for (const listener of listeners) listener(row);
}

/**
 * Business settings (hours, fees, minimum order). Cached for the session, but
 * every screen can `retry()` — a failed fetch must never dead-end checkout.
 */
export function useHotelSettings() {
  const [data, setData] = useState<HotelSettings | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cached) setData(cached);
    const listener: SettingsListener = (row) => setData(row);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setError('SETTINGS_TIMEOUT');
      setLoading(false);
    }, 12000);

    async function load() {
      try {
        const { data: row, error: err } = await supabase
          .from('hotel_settings')
          .select('*')
          .eq('id', 1)
          .abortSignal(controller.signal)
          .single<HotelSettings>();
        if (!active) return;
        if (err || !row) {
          setError(err?.message ?? 'Settings unavailable');
        } else {
          publish(row);
          setData(row);
        }
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        window.clearTimeout(timer);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { data, error, loading, retry };
}
