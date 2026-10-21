import { describe, expect, it } from 'vitest';
import { LOCATION_SHARE_INTERVAL_MS, shouldSendLocation } from '@/lib/agentLocation';

describe('agent location upload throttle', () => {
  it('always sends the first fix', () => {
    expect(shouldSendLocation(null, 1_000)).toBe(true);
  });

  it('holds back fixes sent inside the interval', () => {
    expect(shouldSendLocation(10_000, 10_000 + LOCATION_SHARE_INTERVAL_MS - 1)).toBe(false);
  });

  it('sends again once the interval has fully elapsed', () => {
    expect(shouldSendLocation(10_000, 10_000 + LOCATION_SHARE_INTERVAL_MS)).toBe(true);
  });

  it('honours a custom interval', () => {
    expect(shouldSendLocation(0, 500, 1_000)).toBe(false);
    expect(shouldSendLocation(0, 1_000, 1_000)).toBe(true);
  });
});
