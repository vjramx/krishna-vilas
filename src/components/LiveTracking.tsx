import { lazy, Suspense } from 'react';
import { Bike, Radio } from 'lucide-react';
import type { Order } from '@/types/db';
import { isValidCoordinates, type Coordinates } from '@/lib/deliveryLocation';
import { useLanguage } from '@/context/LanguageContext';

const MapLibreTrackingMap = lazy(() => import('./MapLibreTrackingMap'));

function toCoordinates(latitude: Order['agent_latitude'], longitude: Order['agent_longitude']): Coordinates | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  const coordinates = { latitude: Number(latitude), longitude: Number(longitude) };
  return isValidCoordinates(coordinates) ? coordinates : null;
}

/** Shown only while the order is out for delivery; the customer sees the rider move on the map. */
export function LiveTracking({ order }: { order: Order }) {
  const { t, lang } = useLanguage();
  if (order.status !== 'out_for_delivery') return null;

  const agent = toCoordinates(order.agent_latitude, order.agent_longitude);
  const destination = toCoordinates(order.delivery_latitude, order.delivery_longitude);
  const updatedAt = order.agent_location_at
    ? new Date(order.agent_location_at).toLocaleTimeString(lang === 'kn' ? 'kn-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section className="card mt-3 p-4" aria-labelledby="live-tracking-title">
      <h2 id="live-tracking-title" className="mb-1 flex items-center gap-2 font-bold">
        <Bike size={18} className="text-brand-primary" aria-hidden="true" /> {t('delivery.liveTitle')}
      </h2>
      {agent && destination ? (
        <>
          <Suspense fallback={<div className="grid place-items-center rounded-2xl border border-brand-border bg-brand-bg text-sm text-brand-subtle" style={{ height: 240 }}>Loading map…</div>}>
            <MapLibreTrackingMap destination={destination} agent={agent} height={240} label={t('delivery.agentLocation')} />
          </Suspense>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-subtle" role="status">
            <Radio size={13} className="text-brand-success" aria-hidden="true" />
            {updatedAt ? t('delivery.agentUpdatedAt', { time: updatedAt }) : t('delivery.agentNearby')}
          </p>
        </>
      ) : (
        <p className="text-sm text-brand-subtle" role="status">{t('delivery.agentWaiting')}</p>
      )}
    </section>
  );
}
