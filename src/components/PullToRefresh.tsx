import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { haptic } from '@/lib/haptics';

const THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Native pull-to-refresh for the menu feed. Only engages at the very top of the
 * page and while a single finger drags down, so it never fights normal scrolling.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const begin = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || refreshingRef.current) return;
      startRef.current = e.touches[0].clientY;
    };

    const move = (e: TouchEvent) => {
      if (startRef.current === null) return;
      if (window.scrollY > 0) {
        startRef.current = null;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const dy = e.touches[0].clientY - startRef.current;
      // Rubber-band resistance so the pull feels physical.
      const dist = dy <= 0 ? 0 : Math.min(MAX_PULL, dy * 0.45);
      pullRef.current = dist;
      setPull(dist);
    };

    const end = () => {
      if (startRef.current === null) return;
      startRef.current = null;
      const shouldRefresh = pullRef.current >= THRESHOLD;
      pullRef.current = 0;
      setPull(0);
      if (!shouldRefresh || refreshingRef.current) return;

      refreshingRef.current = true;
      setRefreshing(true);
      haptic(12);
      void Promise.resolve(onRefreshRef.current()).finally(() => {
        window.setTimeout(() => {
          refreshingRef.current = false;
          setRefreshing(false);
        }, 600);
      });
    };

    window.addEventListener('touchstart', begin, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', begin);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  const height = refreshing ? 52 : pull;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div>
      <div
        className="grid place-items-center overflow-hidden"
        style={{ height, transition: pull === 0 ? 'height 180ms ease' : undefined }}
        aria-hidden={!refreshing}
      >
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-brand-primary shadow-elev1"
          style={{
            opacity: refreshing ? 1 : progress,
            transform: `scale(${refreshing ? 1 : 0.6 + progress * 0.4})`,
          }}
        >
          <RefreshCw
            size={18}
            aria-hidden="true"
            className={refreshing ? 'ptr-spinning' : undefined}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </span>
        <span className="sr-only" role="status">
          {refreshing ? 'Refreshing' : ''}
        </span>
      </div>
      {children}
    </div>
  );
}
