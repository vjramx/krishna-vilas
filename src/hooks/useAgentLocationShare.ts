import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseKvError } from '@/lib/errors';
import { shouldSendLocation } from '@/lib/agentLocation';

const CHECK_INTERVAL_MS = 5_000;

interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/**
 * Shares the agent's live position with the customer for each order id given.
 * Callers pass only orders that are out for delivery and in the agent's hands;
 * the server re-checks this on every upload.
 */
export function useAgentLocationShare(orderIds: string[]): { sharing: boolean; error: string | null } {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = orderIds.join(',');
  const latestFix = useRef<Fix | null>(null);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setSharing(false);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('agent.shareDenied');
      setSharing(false);
      return;
    }
    let disposed = false;
    let lastSentAt: number | null = null;
    setError(null);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (disposed) return;
        latestFix.current = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        };
        setSharing(true);
        setError(null);
      },
      () => {
        if (disposed) return;
        setSharing(false);
        setError('agent.shareDenied');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    const timer = window.setInterval(() => {
      const fix = latestFix.current;
      if (!fix || !shouldSendLocation(lastSentAt, Date.now())) return;
      lastSentAt = Date.now();
      for (const id of ids) {
        void supabase
          .rpc('agent_report_location', {
            p_order_id: id,
            p_latitude: fix.latitude,
            p_longitude: fix.longitude,
            p_accuracy_meters: fix.accuracy,
          })
          .then(({ error: rpcError }) => {
            if (disposed || !rpcError) return;
            // Only surface problems the agent can act on; a stale order simply stops receiving fixes.
            const { key: errKey } = parseKvError(rpcError);
            if (errKey !== 'err.notDispatched') setError(errKey);
          });
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      latestFix.current = null;
    };
  }, [key]);

  return { sharing, error };
}
