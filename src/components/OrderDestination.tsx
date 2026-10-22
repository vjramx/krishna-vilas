import { MapPin } from 'lucide-react';
import type { Order } from '@/types/db';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Destination card — ADDRESS ONLY (map navigation removed everywhere).
 * Saved address parts, landmark, floor/entrance and the customer's own
 * instructions are kept verbatim; the map tile, "Navigate"/"View on map"
 * launchers, coordinate strip/copy button and map-location explanatory
 * messages are not rendered. No map pin, geocoding or directions API is
 * consulted, and no address data in the database changed.
 */
export function OrderDestination({ order, audience }: { order: Order; audience: 'customer' | 'admin' | 'agent' }) {
  const { t } = useLanguage();
  const address = [order.delivery_house, order.delivery_street, order.address_line, order.delivery_locality, order.area, order.delivery_city, order.delivery_pincode].filter(Boolean).join(', ');

  return (
    <section className="grid gap-2 rounded-2xl border border-brand-border bg-white p-3" aria-labelledby={`destination-${audience}-${order.id}`}>
      <h3 id={`destination-${audience}-${order.id}`} className="flex items-center gap-2 font-bold">
        <MapPin size={18} className="text-brand-primary" aria-hidden="true" /> {t('delivery.destination')}
      </h3>
      {/* break-words so long addresses wrap naturally on the narrowest phones */}
      <p className="break-words text-sm">{address}</p>
      {order.landmark && <p className="break-words text-sm text-brand-subtle"><b>{t('checkout.landmark')}:</b> {order.landmark}</p>}
      {order.delivery_floor && <p className="break-words text-sm text-brand-subtle"><b>{t('checkout.floorEntrance')}:</b> {order.delivery_floor}</p>}
      {order.instructions && <p className="break-words text-sm text-brand-subtle"><b>{t('checkout.instructions')}:</b> {order.instructions}</p>}
      {audience === 'agent' && (
        // The agent comparison sheet (Assigned tab) shows this instead of the
        // handover dialog: flag what's missing without ever inventing values.
        <p className="text-xs text-brand-subtle">
          {!order.landmark && <span className="block">{t('checkout.landmark')}: {t('agent.notProvided')}</span>}
          {!order.instructions && <span className="block">{t('checkout.instructions')}: {t('agent.notProvided')}</span>}
        </p>
      )}
    </section>
  );
}
