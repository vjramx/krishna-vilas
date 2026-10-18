import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import type { Coordinates } from '@/lib/deliveryLocation';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin } from 'lucide-react';
import { isValidCoordinates } from '@/lib/deliveryLocation';

setWorkerUrl(maplibreWorker);
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export default function MapLibreDestinationMap({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latestRef = useRef({ coordinates, onChange });
  const initialCoordinatesRef = useRef(coordinates);
  const [mapError, setMapError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { latestRef.current = { coordinates, onChange }; }, [coordinates, onChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const initialCoordinates = initialCoordinatesRef.current;
    const initial = initialCoordinates && isValidCoordinates(initialCoordinates) ? [initialCoordinates.longitude, initialCoordinates.latitude] as [number, number] : [78.9629, 20.5937] as [number, number];
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: initial,
      zoom: interactive ? (initialCoordinates ? 17 : 4) : 15,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      dragPan: interactive,
      scrollZoom: interactive,
      doubleClickZoom: interactive,
      touchZoomRotate: interactive,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const marker = new Marker({ color: '#C83E24', draggable: interactive });
    if (initialCoordinates && isValidCoordinates(initialCoordinates)) {
      marker.setLngLat([initialCoordinates.longitude, initialCoordinates.latitude]).addTo(map);
      markerRef.current = marker;
    }
    marker.on('dragend', () => {
      const point = marker.getLngLat();
      latestRef.current.onChange?.({ latitude: point.lat, longitude: point.lng });
    });
    let styleLoaded = false;
    map.on('load', () => { if (!disposed) { styleLoaded = true; setReady(true); } });
    map.on('styledata', () => { if (!disposed && map.isStyleLoaded()) styleLoaded = true; });
    map.on('error', () => {
      if (!disposed && !styleLoaded) {
        setMapError(true);
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    });
    if (interactive) {
      map.on('click', (event: MapMouseEvent) => {
        const next = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
        marker.setLngLat([next.longitude, next.latitude]).addTo(map);
        markerRef.current = marker;
        latestRef.current.onChange?.(next);
      });
    }
    return () => {
      disposed = true;
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
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
    const moved = Math.abs(center.lat - latitude) > 0.000001 || Math.abs(center.lng - longitude) > 0.000001;
    if (moved && !interactive) map.jumpTo({ center: [longitude, latitude] });
    markerRef.current?.setLngLat([longitude, latitude]).addTo(map);
  }, [latitude, longitude, interactive]);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-brand-bg">
      <div ref={containerRef} role="application" aria-label={label} className="w-full" style={{ height }} />
      {mapError && <p className="flex items-center gap-2 p-3 text-xs text-brand-warn" role="status"><MapPin size={15} aria-hidden="true" /> Map tiles could not load. The saved destination remains available as coordinates and address.</p>}
      {!ready && !mapError && <p className="sr-only" role="status">Loading map</p>}
      {interactive && ready && <p className="border-t border-brand-border bg-white px-3 py-2 text-xs text-brand-subtle">Tap the map or drag the pin to adjust the exact delivery point.</p>}
    </div>
  );
}
