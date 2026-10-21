import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { Coordinates } from '@/lib/deliveryLocation';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(maplibreWorker);
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Keeps both points framed without zooming in closer than street level. */
const MAX_FIT_ZOOM = 16;

export default function MapLibreTrackingMap({
  destination,
  agent,
  height = 240,
  label,
}: {
  destination: Coordinates;
  agent: Coordinates;
  height?: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const agentMarkerRef = useRef<Marker | null>(null);
  // Positions at mount only seed the map; later changes flow through the second effect.
  const initialRef = useRef({ destination, agent });

  useEffect(() => {
    if (!containerRef.current) return;
    const { destination: start, agent: startAgent } = initialRef.current;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: [start.longitude, start.latitude],
      zoom: 15,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    new Marker({ color: '#C83E24' }).setLngLat([start.longitude, start.latitude]).addTo(map);
    // Blue marker = rider, so it is visually distinct from the red destination pin.
    agentMarkerRef.current = new Marker({ color: '#2563EB' }).setLngLat([startAgent.longitude, startAgent.latitude]).addTo(map);
    map.on('load', () => frame(map, start, startAgent));
    return () => {
      map.remove();
      mapRef.current = null;
      agentMarkerRef.current = null;
    };
  }, []);

  const agentLat = agent.latitude;
  const agentLng = agent.longitude;
  const destLat = destination.latitude;
  const destLng = destination.longitude;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    agentMarkerRef.current?.setLngLat([agentLng, agentLat]);
    frame(map, { latitude: destLat, longitude: destLng }, { latitude: agentLat, longitude: agentLng });
  }, [agentLat, agentLng, destLat, destLng]);

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-brand-bg">
      <div ref={containerRef} role="application" aria-label={label} className="w-full" style={{ height }} />
    </div>
  );
}

function frame(map: MapLibreMap, destination: Coordinates, agent: Coordinates) {
  const bounds = new LngLatBounds([destination.longitude, destination.latitude], [destination.longitude, destination.latitude]);
  bounds.extend([agent.longitude, agent.latitude]);
  map.fitBounds(bounds, { padding: 56, maxZoom: MAX_FIT_ZOOM, duration: 700 });
}
