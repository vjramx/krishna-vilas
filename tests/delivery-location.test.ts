import { describe, expect, it } from 'vitest';
import { isValidCoordinates } from '@/lib/deliveryLocation';

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
});
