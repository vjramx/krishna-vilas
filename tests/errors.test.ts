import { describe, expect, it } from 'vitest';
import { isMissingRpcFunction, parseKvError } from '@/lib/errors';

describe('parseKvError', () => {
  it('maps known RPC codes', () => {
    expect(parseKvError(new Error('AUTH_REQUIRED')).key).toBe('err.authRequired');
    expect(parseKvError(new Error('PIN_MISMATCH')).key).toBe('err.pinMismatch');
  });

  it('maps coded errors with detail', () => {
    const e = parseKvError(new Error('ITEM_UNAVAILABLE:Masala Dosa'));
    expect(e.key).toBe('err.itemUnavailable');
    expect(e.detail).toBe('Masala Dosa');
  });

  it('parses PostgREST JSON envelopes', () => {
    expect(parseKvError({ message: 'PHONE_INVALID' }).key).toBe('err.phoneInvalid');
  });

  it('detects network failures', () => {
    expect(parseKvError(new Error('Failed to fetch')).key).toBe('err.network');
  });

  it('translates the delivery-location RPC codes into friendly keys', () => {
    expect(parseKvError(new Error('LOCATION_CONFIRMATION_INVALID')).key).toBe('err.locationInvalid');
    expect(parseKvError(new Error('LATITUDE_INVALID')).key).toBe('err.locationInvalid');
    expect(parseKvError(new Error('LOCATION_ACCURACY_INVALID')).key).toBe('err.locationInvalid');
    expect(parseKvError(new Error('COORDINATES_INCOMPLETE')).key).toBe('err.locationIncomplete');
    expect(parseKvError(new Error('DELIVERY_DETAILS_INVALID')).key).toBe('err.deliveryDetailsInvalid');
  });

  it('keeps every mapped code translatable in both languages', async () => {
    const { KNOWN_KV_CODES } = await import('@/lib/errors');
    const en = (await import('@/i18n/en')).en as Record<string, string>;
    const kn = (await import('@/i18n/kn')).kn as Record<string, string>;
    const missing = KNOWN_KV_CODES.filter((code) => {
      const key = parseKvError(new Error(code)).key;
      return !(key in en) || !(key in kn);
    });
    expect(missing).toEqual([]);
  });

  it('identifies only missing-function schema-cache errors for the expected RPC', () => {
    expect(isMissingRpcFunction({ code: 'PGRST202', message: 'Function not found', details: 'admin_dashboard_summary not in schema cache' }, 'admin_dashboard_summary')).toBe(true);
    expect(isMissingRpcFunction({ code: 'PGRST202', message: 'Function not found', details: 'admin_user_directory not in schema cache' }, 'admin_dashboard_summary')).toBe(false);
    expect(isMissingRpcFunction({ code: '42501', message: 'permission denied', details: 'admin_dashboard_summary' }, 'admin_dashboard_summary')).toBe(false);
  });
});
