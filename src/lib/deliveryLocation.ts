export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Validate a potentially raw/possibly-null PostgREST coordinate pair.
 * Still used by customer live tracking and by the saved pin chip. */
export function isValidCoordinates(value: { latitude?: number | null; longitude?: number | null } | null | undefined): value is Coordinates {
  return !!value && typeof value.latitude === 'number' && typeof value.longitude === 'number'
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.latitude >= -90 && value.latitude <= 90
    && value.longitude >= -180 && value.longitude <= 180;
}
