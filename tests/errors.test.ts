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

  it('identifies only missing-function schema-cache errors for the expected RPC', () => {
    expect(isMissingRpcFunction({ code: 'PGRST202', message: 'Function not found', details: 'admin_dashboard_summary not in schema cache' }, 'admin_dashboard_summary')).toBe(true);
    expect(isMissingRpcFunction({ code: 'PGRST202', message: 'Function not found', details: 'admin_user_directory not in schema cache' }, 'admin_dashboard_summary')).toBe(false);
    expect(isMissingRpcFunction({ code: '42501', message: 'permission denied', details: 'admin_dashboard_summary' }, 'admin_dashboard_summary')).toBe(false);
  });
});
