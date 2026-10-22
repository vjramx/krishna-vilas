/**
 * Client side of account deletion (Google-Play compliant, self-service).
 *
 * Order of operations (matches supabase/functions/delete-account):
 *   1. Password reauthentication — Firebase refreshes auth_time; the backend
 *      rejects tokens minted older than 10 minutes.
 *   2. Fresh ID token (forceRefresh) is POSTed to the Edge Function, which
 *      verifies it against Firebase's public keys (third-party auth) and runs
 *      the server-side purge + auth-account deletion. Identity NEVER comes
 *      from a client body.
 *   3. Result codes are mapped to friendly i18n message keys here; the raw
 *      backend detail is never rendered to users.
 */

/** Map an Edge Function error payload to a user-actionable i18n key. */
export function mapDeletionError(body: { error?: string } | null): string {
  switch (body?.error) {
    case 'REAUTH_REQUIRED':
      return 'delete.reauthRequired';
    case 'PENDING_ORDERS':
      return 'delete.pendingOrders';
    case 'STAFF_ACCOUNT':
      return 'delete.staffAccount';
    case 'AUTH_DELETE_PENDING':
      return 'delete.authDeletePending';
    case 'CONFIG_MISSING':
      return 'common.somethingWrong';
    case 'EMAIL_NOT_VERIFIED':
      return 'delete.emailNotVerified';
    default:
      return 'delete.failed';
  }
}

export interface DeletionOutcome {
  ok: boolean;
  messageKey: string;
  /** Optional numeric detail (e.g. pending-orders count). */
  detail?: string;
}

/** Run the verified deletion: reauth → fresh token → Edge Function POST. */
export async function requestAccountDeletion(input: {
  /** Forces reauthentication; resolve it (user-visible) before calling. */
  reauthenticate: () => Promise<void>;
  /** Returns the CURRENT Firebase user after reauthentication. */
  currentUser: () => { uid: string } | null;
  url: string;
}): Promise<DeletionOutcome> {
  await input.reauthenticate(); // throws on user-dismissed/failed reauth
  const user = input.currentUser();
  if (!user) return { ok: false, messageKey: 'delete.failed' };

  const token = await (user as unknown as { getIdToken: (r?: boolean) => Promise<string> }).getIdToken(true);
  const res = await fetch(`${input.url}/functions/v1/delete-account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: { error?: string; detail?: string } | null = null;
  try {
    body = (await res.json()) as { error?: string; detail?: string };
  } catch {
    /* network/HTML error body — fall through to generic mapping */
  }
  if (res.ok) return { ok: true, messageKey: 'delete.success' };
  return {
    ok: false,
    messageKey: mapDeletionError(body),
    detail: body?.error === 'PENDING_ORDERS' ? body.detail : undefined,
  };
}

/** Local cleanup after a successful server-side deletion. */
export function clearLocalDataAfterDeletion(): void {
  try {
    // The frontend keeps lang/save-checkout and cart in these stores; they are
    // per-account personal data and must not leak into the next session.
    for (const key of ['kv-delivery-details', 'kv-checkout-draft', 'kv-lang']) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
    window.sessionStorage.removeItem('kv-order-pending');
  } catch {
    /* storage may be unavailable — best effort */
  }
}
