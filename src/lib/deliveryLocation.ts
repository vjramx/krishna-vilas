export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ConfirmedDeliveryLocation extends Coordinates {
  accuracyMeters: number | null;
  source: 'browser_geolocation' | 'map_pin' | 'manual_address';
  confirmedAt: string;
}

export function isValidCoordinates(value: { latitude?: number | null; longitude?: number | null } | null | undefined): value is Coordinates {
  return !!value && typeof value.latitude === 'number' && typeof value.longitude === 'number'
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.latitude >= -90 && value.latitude <= 90
    && value.longitude >= -180 && value.longitude <= 180;
}

export function formatCoordinates(coordinates: Coordinates): string {
  if (!isValidCoordinates(coordinates)) throw new RangeError('Invalid destination coordinates');
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}

/** Build the free, user-initiated Google Maps directions URL. */
export function googleMapsDirectionsUrl(destination: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  area?: string | null;
}): string | null {
  const coordinates = { latitude: destination.latitude, longitude: destination.longitude };
  let target: string;
  if (isValidCoordinates(coordinates)) {
    target = `${coordinates.latitude},${coordinates.longitude}`;
  } else {
    const address = [destination.address, destination.area].filter((part) => typeof part === 'string' && part.trim()).join(', ');
    if (!address) return null;
    target = address;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}`;
}

export function describeGeolocationError(error: Pick<GeolocationPositionError, 'code'>): 'permission_denied' | 'unavailable' | 'timeout' | 'unknown' {
  switch (error.code) {
    case 1: return 'permission_denied';
    case 2: return 'unavailable';
    case 3: return 'timeout';
    default: return 'unknown';
  }
}

export function isGoodLocationAccuracy(accuracyMeters: number): boolean {
  return Number.isFinite(accuracyMeters) && accuracyMeters >= 0 && accuracyMeters <= 100;
}

export function getCurrentLocation(geolocation: Pick<Geolocation, 'getCurrentPosition'>): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}
