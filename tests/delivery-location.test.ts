import { describe, expect, it, vi } from 'vitest';
import { describeGeolocationError, formatCoordinates, getCurrentLocation, googleMapsDirectionsUrl, isGoodLocationAccuracy, isValidCoordinates } from '@/lib/deliveryLocation';

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

describe('customer geolocation', () => {
  it('requests one high-accuracy position with finite timeout and no cached GPS', async () => {
    const position = { coords: { latitude: 12, longitude: 77, accuracy: 10 } } as GeolocationPosition;
    const getCurrentPosition = vi.fn((...args: Parameters<Geolocation['getCurrentPosition']>) => args[0](position));
    await expect(getCurrentLocation({ getCurrentPosition })).resolves.toBe(position);
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  it.each([[1, 'permission_denied'], [2, 'unavailable'], [3, 'timeout'], [0, 'unknown']] as const)(
    'distinguishes geolocation error %s as %s', (code, expected) => {
      expect(describeGeolocationError({ code } as GeolocationPositionError)).toBe(expected);
    },
  );

  it('flags poor accuracy without discarding the selected point', () => {
    expect(isGoodLocationAccuracy(45)).toBe(true);
    expect(isGoodLocationAccuracy(101)).toBe(false);
    expect(isGoodLocationAccuracy(-1)).toBe(false);
  });
});
