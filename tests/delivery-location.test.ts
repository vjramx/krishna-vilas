import { describe, expect, it } from 'vitest';
import { formatCoordinates, googleMapsDirectionsUrl, isValidCoordinates } from '@/lib/deliveryLocation';

describe('delivery destination coordinates', () => {
  it('validates finite latitude/longitude ranges, including boundaries', () => {
    expect(isValidCoordinates({ latitude: 90, longitude: -180 })).toBe(true);
    expect(isValidCoordinates({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isValidCoordinates({ latitude: 90.001, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: -180.001 })).toBe(false);
    expect(isValidCoordinates({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: null })).toBe(false);
    expect(isValidCoordinates(null)).toBe(false);
  });

  it('builds Google Maps directions to the exact saved destination coordinates', () => {
    expect(googleMapsDirectionsUrl({ latitude: 12.9716, longitude: 77.5946 }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=12.9716%2C77.5946');
  });

  it('uses the real address if coordinates are missing and returns null without any destination', () => {
    expect(googleMapsDirectionsUrl({ address: '12 Main Street', area: 'Mysuru' }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=12%20Main%20Street%2C%20Mysuru');
    expect(googleMapsDirectionsUrl({ latitude: null, longitude: null })).toBeNull();
  });

  it('formats valid coordinates for display/copy and rejects invalid ones', () => {
    expect(formatCoordinates({ latitude: 12.5, longitude: 77 })).toBe('12.500000, 77.000000');
    expect(() => formatCoordinates({ latitude: 91, longitude: 0 })).toThrow(RangeError);
  });
});
