export function isCancelledAuthError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

export function mapLoginErrorMessage(message: string): string | null {
  const value = message.toLowerCase();
  if (value.includes('unauthorized-domain')) return 'login.unauthorizedDomain';
  if (
    value.includes('operation-not-allowed') ||
    value.includes('configuration-not-found') ||
    value.includes('provider is not enabled') ||
    value.includes('unsupported provider') ||
    value.includes('admin-restricted-operation')
  ) {
    return 'login.providerDisabled';
  }
  if (value.includes('popup-blocked') || value.includes('operation-not-supported-in-this-environment')) {
    return 'login.popupBlocked';
  }
  if (value.includes('popup-closed-by-user') || value.includes('cancelled-popup-request') || value.includes('canceled')) {
    return null;
  }
  if (value.includes('popup')) return 'login.googleUnavailable';
  return 'err.network';
}
