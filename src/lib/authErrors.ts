/**
 * Maps a FirebaseError (code and/or message) to a user-actionable i18n key
 * for the Email/Password auth flows. Firebase merges "unknown email" and
 * "wrong password" into `auth/invalid-credential` (older builds surface
 * `auth/wrong-password` / `auth/user-not-found` instead), and every variant
 * must render the same neutral message so the form never leaks which half
 * was wrong.
 */
export function authErrorKey(error: string): string {
  const value = error.toLowerCase();
  if (
    value.includes('invalid-credential') ||
    value.includes('wrong-password') ||
    value.includes('user-not-found') ||
    value.includes('invalid-login-credentials')
  ) {
    return 'login.invalidCredentials';
  }
  if (
    value.includes('email-already-in-use') ||
    value.includes('already-in-use') ||
    value.includes('already in use')
  ) {
    return 'login.emailInUse';
  }
  if (value.includes('invalid-email')) return 'login.invalidEmail';
  if (value.includes('weak-password')) return 'login.weakPassword';
  if (value.includes('missing-password')) return 'login.missingPassword';
  if (value.includes('too-many-requests') || value.includes('too many attempts')) {
    return 'login.tooManyAttempts';
  }
  if (value.includes('unauthorized-domain')) return 'login.unauthorizedDomain';
  if (value.includes('guest-provider-disabled')) return 'login.guestProviderDisabled';
  if (
    value.includes('operation-not-allowed') ||
    value.includes('configuration-not-found') ||
    value.includes('admin-restricted-operation')
  ) {
    return 'login.providerDisabled';
  }
  if (value.includes('network') || value.includes('offline')) return 'err.network';
  return 'err.generic';
}
