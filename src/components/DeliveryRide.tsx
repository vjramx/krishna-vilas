import { useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import rideSvg from '@/assets/delivery-riding.svg?raw';

/**
 * "Order on its way" ride for the customer's confirmed banner: the branded
 * animated delivery-rider artwork (SMIL animations live inside the file's own
 * groups — wheels, bob, speed lines — so nothing has to be re-authored here).
 *
 * Inlined via Vite's ?raw import instead of <img> so we can access the SVG DOM
 * and pause every SMIL timeline for `prefers-reduced-motion: reduce` users.
 * Decorative only — the caption is visually hidden, the graphic wrapper is
 * aria-hidden, keeping the scene out of the accessibility tree.
 */
export function DeliveryRideAnimation() {
  const { t } = useLanguage();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const svg = host.querySelector('svg');
    if (!svg || typeof svg.pauseAnimations !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      svg.pauseAnimations();
    }
  }, []);

  return (
    <div
      ref={hostRef}
      className="mx-auto mt-3 w-52 shrink-0"
      aria-hidden="true"
      data-testid="delivery-ride"
    >
      <p className="sr-only">{t('order.rideCaption')}</p>
      {/* Static, build-time file content from src/assets/delivery-riding.svg.
          The artwork is a 1:1 viewBox with width/height=100%, so it must sit
          inside an aspect-locked box or its unsized parent collapses it. */}
      <div
        className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        style={{ aspectRatio: '1 / 1' }}
        dangerouslySetInnerHTML={{ __html: rideSvg }}
      />
    </div>
  );
}
