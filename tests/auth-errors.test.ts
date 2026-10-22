import { describe, expect, it } from 'vitest';
import { authErrorKey } from '@/lib/authErrors';

describe('Firebase email/password error handling', () => {
  it('maps every unknown-user / wrong-password variant to one neutral message', () => {
    // Firebase merges "unknown email" and "wrong password" into
    // auth/invalid-credential on modern SDKs; older builds return the
    // granular codes. All must render identically so the form never leaks
    // which half was wrong.
    expect(authErrorKey('auth/invalid-credential: credentials do not match')).toBe('login.invalidCredentials');
    expect(authErrorKey('auth/wrong-password')).toBe('login.invalidCredentials');
    expect(authErrorKey('auth/user-not-found')).toBe('login.invalidCredentials');
    expect(authErrorKey('auth/invalid-login-credentials')).toBe('login.invalidCredentials');
  });

  it('maps email/password quality problems to their own messages', () => {
    expect(authErrorKey('auth/email-already-in-use')).toBe('login.emailInUse');
    expect(authErrorKey('The email address is already in use')).toBe('login.emailInUse');
    expect(authErrorKey('auth/invalid-email')).toBe('login.invalidEmail');
    expect(authErrorKey('auth/weak-password')).toBe('login.weakPassword');
    expect(authErrorKey('auth/missing-password')).toBe('login.missingPassword');
  });

  it('maps throttling, config and network errors', () => {
    expect(authErrorKey('auth/too-many-requests: too many attempts')).toBe('login.tooManyAttempts');
    expect(authErrorKey('auth/operation-not-allowed')).toBe('login.providerDisabled');
    expect(authErrorKey('auth/configuration-not-found')).toBe('login.providerDisabled');
    expect(authErrorKey('auth/unauthorized-domain')).toBe('login.unauthorizedDomain');
    expect(authErrorKey('A network error occurred')).toBe('err.network');
    // Guest sign-in blocked by a disabled Anonymous provider gets guest-specific guidance.
    expect(authErrorKey('Firebase: guest-provider-disabled (auth/operation-not-allowed).')).toBe('login.guestProviderDisabled');
    expect(authErrorKey('some unexpected failure')).toBe('err.generic');
  });
});
