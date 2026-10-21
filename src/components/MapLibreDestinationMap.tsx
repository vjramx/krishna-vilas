import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import type { Coordinates } from '@/lib/deliveryLocation';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin } from 'lucide-react';
import { isValidCoordinates } from '@/lib/deliveryLocation';

setWorkerUrl(maplibreWorker);
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Restaurant service area: Karatagi, Koppal district, Karnataka (PIN 583229).
 * The map opens here when no pin is confirmed yet so the picker always starts
 * on the delivery town instead of a generic country view.
 */
const SERVICE_AREA_CENTER: [number, number] = [76.6589, 15.6055]; // [lng, lat]
const TOWN_ZOOM = 16.5;

export default function MapLibreDestinationMap({
  coordinates,
  onChange,
  onMovingChange,
  interactive = false,
  height = 240,
  label,
}: {
  coordinates: Coordinates | null;
  onChange?: (coordinates: Coordinates) => void;
  onMovingChange?: (moving: boolean) => void;
  interactive?: boolean;
  height?: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestRef = useRef({ coordinates, onChange, onMovingChange });
  const programmaticCenterRef = useRef<[number, number] | null>(null);
  const initialCoordinatesRef = useRef(coordinates);
  const [mapError, setMapError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { latestRef.current = { coordinates, onChange, onMovingChange }; }, [coordinates, onChange, onMovingChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const initialCoordinates = initialCoordinatesRef.current;
    const initial = initialCoordinates && isValidCoordinates(initialCoordinates) ? [initialCoordinates.longitude, initialCoordinates.latitude] as [number, number] : SERVICE_AREA_CENTER;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: initial,
      zoom: interactive ? (initialCoordinates ? 17 : TOWN_ZOOM) : 15,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      dragPan: interactive,
      scrollZoom: interactive,
      doubleClickZoom: interactive,
      touchZoomRotate: interactive,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    let styleLoaded = false;
    map.on('load', () => { if (!disposed) { styleLoaded = true; setReady(true); } });
    map.on('styledata', () => { if (!disposed && map.isStyleLoaded()) styleLoaded = true; });
    map.on('error', () => {
      if (!disposed && !styleLoaded) {
        setMapError(true);
        map.remove();
        mapRef.current = null;
      }
    });
    if (interactive) {
      // The pin stays fixed at the visual center. Report the map center after
      // each completed pan/zoom, so persisted coordinates match the pin tip.
      map.on('movestart', () => latestRef.current.onMovingChange?.(true));
      map.on('moveend', () => {
        latestRef.current.onMovingChange?.(false);
        const center = map.getCenter();
        const programmatic = programmaticCenterRef.current;
        if (programmatic
          && Math.abs(center.lng - programmatic[0]) < 0.00001
          && Math.abs(center.lat - programmatic[1]) < 0.00001) {
          programmaticCenterRef.current = null;
          return;
        }
        programmaticCenterRef.current = null;
        const current = latestRef.current.coordinates;
        if (current && Math.abs(current.latitude - center.lat) < 0.0000001 && Math.abs(current.longitude - center.lng) < 0.0000001) return;
        latestRef.current.onChange?.({ latitude: center.lat, longitude: center.lng });
      });
      // A tap centers the map directly under the fixed pin. jumpTo completes
      // synchronously, so the center is sent to checkout before Confirm can fire.
      map.on('click', (event: MapMouseEvent) => {
        map.jumpTo({ center: event.lngLat });
        latestRef.current.onChange?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
    }
    return () => {
      disposed = true;
      latestRef.current.onMovingChange?.(false);
      map.remove();
      mapRef.current = null;
    };
    // The map instance is created once per mode and initialCoordinatesRef
    // supplies the first center. Current pin updates are applied below.
  }, [interactive]);

  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof latitude !== 'number' || typeof longitude !== 'number' || !isValidCoordinates({ latitude, longitude })) return;
    const center = map.getCenter();
    const moved = Math.abs(center.lat - latitude) > 0.00001 || Math.abs(center.lng - longitude) > 0.00001;
    if (moved) {
      // A changed coordinate arriving from GPS/reopen is an explicit recenter;
      // do not reinterpret that controlled camera movement as a customer pan.
      programmaticCenterRef.current = interactive ? [longitude, latitude] : null;
      map.easeTo({ center: [longitude, latitude], duration: interactive ? 350 : 0 });
    }
  }, [latitude, longitude, interactive]);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-brand-bg">
      <div className="relative w-full">
        <div ref={containerRef} role="application" aria-label={label} className="w-full" style={{ height }} />
        {interactive && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 drop-shadow-lg" style={{ transform: 'translate(-50%, -100%)' }} aria-hidden="true">
            <MapPin size={42} fill="#C83E24" className="text-white" strokeWidth={1.8} />
          </div>
        )}
      </div>
      {mapError && <p className="flex items-center gap-2 p-3 text-xs text-brand-warn" role="status"><MapPin size={15} aria-hidden="true" /> Map tiles could not load. The saved destination remains available as coordinates and address.</p>}
      {!ready && !mapError && <p className="sr-only" role="status">Loading map</p>}
      {interactive && ready && <p className="border-t border-brand-border bg-white px-3 py-2 text-xs text-brand-subtle">Move the map under the fixed pin, or tap a place to center it under the pin.</p>}
    </div>
  );
}
