const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
]);

interface GoogleSignInFlow {
  useRedirect: boolean;
  popup: () => Promise<unknown>;
  redirect: () => Promise<unknown>;
}

export async function runGoogleSignInFlow({ useRedirect, popup, redirect }: GoogleSignInFlow): Promise<void> {
  if (useRedirect) {
    await redirect();
    return;
  }
  try {
    await popup();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (!REDIRECT_FALLBACK_CODES.has(code ?? '')) throw error;
    await redirect();
  }
}
