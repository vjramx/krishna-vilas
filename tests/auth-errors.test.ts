import { describe, expect, it } from 'vitest';
import { isCancelledAuthError, mapLoginErrorMessage } from '@/lib/authErrors';

describe('Firebase sign-in error handling', () => {
  it('treats only explicit user dismissal codes as cancellation', () => {
    expect(isCancelledAuthError({ code: 'auth/popup-closed-by-user' })).toBe(true);
    expect(isCancelledAuthError({ code: 'auth/cancelled-popup-request' })).toBe(true);
    // Native Android bridge: system account chooser dismissed / Back pressed.
    expect(isCancelledAuthError({ code: 'auth/user-cancelled' })).toBe(true);
    expect(isCancelledAuthError({ code: 'auth/popup-blocked' })).toBe(false);
    expect(isCancelledAuthError({ code: 'auth/operation-not-supported-in-this-environment' })).toBe(false);
  });

  it('distinguishes popup errors from user cancellation and configuration errors', () => {
    expect(mapLoginErrorMessage('auth/popup-blocked')).toBe('login.popupBlocked');
    expect(mapLoginErrorMessage('auth/operation-not-supported-in-this-environment')).toBe('login.popupBlocked');
    expect(mapLoginErrorMessage('auth/popup-closed-by-user')).toBeNull();
    expect(mapLoginErrorMessage('auth/unauthorized-domain')).toBe('login.unauthorizedDomain');
    expect(mapLoginErrorMessage('auth/operation-not-allowed')).toBe('login.providerDisabled');
    expect(mapLoginErrorMessage('auth/network-request-failed')).toBe('err.network');
    // Native Android bridge error surface
    expect(mapLoginErrorMessage('auth/no-google-account no Google account available on this device')).toBe('login.noGoogleAccount');
  });
});
