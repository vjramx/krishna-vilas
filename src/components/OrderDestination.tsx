import { useState } from 'react';
import { ExternalLink, MapPin, Navigation, Copy, Check } from 'lucide-react';
import type { Order } from '@/types/db';
import { formatCoordinates, googleMapsDirectionsUrl, isValidCoordinates } from '@/lib/deliveryLocation';
import { DeliveryMap } from '@/components/DeliveryMap';
import { useLanguage } from '@/context/LanguageContext';

export function OrderDestination({ order, audience }: { order: Order; audience: 'customer' | 'admin' | 'agent' }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  // PostgREST serializes PostgreSQL numeric columns as decimal strings.
  const coordinates = {
    latitude: order.delivery_latitude === null || order.delivery_latitude === undefined ? null : Number(order.delivery_latitude),
    longitude: order.delivery_longitude === null || order.delivery_longitude === undefined ? null : Number(order.delivery_longitude),
  };
  const hasPin = isValidCoordinates(coordinates);
  const address = [order.delivery_house, order.delivery_street, order.address_line, order.delivery_locality, order.area, order.delivery_city, order.delivery_pincode].filter(Boolean).join(', ');
  const mapsUrl = googleMapsDirectionsUrl({
    ...(hasPin ? coordinates : {}),
    address,
  });

  async function copyCoordinates() {
    if (!hasPin) return;
    try {
      await navigator.clipboard.writeText(formatCoordinates(coordinates));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* Clipboard is optional; coordinates remain visible for selection. */ }
  }

  return (
    <section className="grid gap-2 rounded-2xl border border-brand-border bg-white p-3" aria-labelledby={`destination-${audience}-${order.id}`}>
      <h3 id={`destination-${audience}-${order.id}`} className="flex items-center gap-2 font-bold">
        <MapPin size={18} className="text-brand-primary" aria-hidden="true" /> {t('delivery.destination')}
      </h3>
      <p className="text-sm">{address}</p>
      {order.landmark && <p className="text-sm text-brand-subtle"><b>{t('checkout.landmark')}:</b> {order.landmark}</p>}
      {order.delivery_floor && <p className="text-sm text-brand-subtle"><b>{t('checkout.floorEntrance')}:</b> {order.delivery_floor}</p>}
      {order.instructions && <p className="text-sm text-brand-subtle"><b>{t('checkout.instructions')}:</b> {order.instructions}</p>}
      {audience !== 'customer' && order.location_source && <p className="text-xs text-brand-subtle">{t(`delivery.source.${order.location_source}`)}</p>}
      {hasPin ? (
        <>
          <DeliveryMap coordinates={coordinates} height={190} label={t('delivery.destinationMap')} />
          <p className="selectable text-xs tabular-nums text-brand-subtle">{formatCoordinates(coordinates)}</p>
          {audience !== 'customer' && (
            <button type="button" className="btn-secondary w-full" onClick={() => void copyCoordinates()}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('delivery.copied') : t('delivery.copyCoordinates')}
            </button>
          )}
        </>
      ) : (
        <p className="rounded-xl bg-brand-warnBg p-3 text-sm text-brand-warn" role="status">{t('delivery.noPrecisePin')}</p>
      )}
      {mapsUrl ? (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full" onClick={(event) => {
          // User-initiated URL navigation; target blank is safe with noopener.
          if (!mapsUrl.startsWith('https://www.google.com/maps/dir/?api=1&destination=')) event.preventDefault();
        }}>
          {audience === 'customer' ? <ExternalLink size={16} /> : <Navigation size={16} />}
          {audience === 'customer' ? t('delivery.viewOnMap') : t('delivery.navigate')}
        </a>
      ) : <p className="text-sm text-brand-subtle">{t('delivery.noAddressForNavigation')}</p>}
    </section>
  );
}
