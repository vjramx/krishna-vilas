import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/**
 * Connectivity strip, sitting on top of the tab bar so it never covers content
 * or the navigation. Android apps keep this visible until the network returns.
 */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useLanguage();
  if (online) return null;
  return (
    <div
      className="fixed inset-x-0 z-[55] border-t border-black/10 bg-brand-warnBg px-3 py-2 text-brand-warn"
      style={{ bottom: 'calc(var(--tabbar-h) + var(--safe-bottom))' }}
      role="status"
      aria-live="polite"
    >
      <p className="mx-auto flex w-full max-w-app items-center justify-center gap-2 text-center text-[12px] font-semibold">
        <WifiOff size={14} aria-hidden="true" />
        {t('common.offline')}
      </p>
    </div>
  );
}
