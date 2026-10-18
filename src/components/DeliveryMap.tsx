import { lazy, Suspense } from 'react';
import type { Coordinates } from '@/lib/deliveryLocation';

const MapLibreDestinationMap = lazy(() => import('./MapLibreDestinationMap'));

export function DeliveryMap({
  coordinates,
  onChange,
  interactive = false,
  height = 240,
  label,
}: {
  coordinates: Coordinates | null;
  onChange?: (coordinates: Coordinates) => void;
  interactive?: boolean;
  height?: number;
  label: string;
}) {
  return (
    <Suspense fallback={<div className="grid place-items-center rounded-2xl border border-brand-border bg-brand-bg text-sm text-brand-subtle" style={{ height }}>{'Loading map…'}</div>}>
      <MapLibreDestinationMap coordinates={coordinates} onChange={onChange} interactive={interactive} height={height} label={label} />
    </Suspense>
  );
}
