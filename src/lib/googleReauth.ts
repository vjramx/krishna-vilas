import {
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
} from 'firebase/auth';
import { currentFirebaseUser, googleProvider, usesRedirectFlow } from '@/lib/firebase';

/**
 * Fresh Google confirmation before an irreversible action (account deletion).
 * The returned user ID token then carries a brand-new `auth_time`, which the
 * delete-account Edge Function enforces server-side (≤ 10 minutes).
 *
 * - Popup flow resolves in place.
 * - Redirect flow (embedded WebViews): the page unloads and returns via
 *   getRedirectResult; the caller must treat both "resolved here" and
 *   "user returns and retries" as valid fresh-login states.
 */
export function reauthenticateWithGoogle(_email: string | null): () => Promise<void> {
  return async () => {
    const user = currentFirebaseUser();
    if (!user) throw new Error('no-session');
    if (usesRedirectFlow) {
      await reauthenticateWithRedirect(user, googleProvider);
      return;
    }
    await reauthenticateWithPopup(user, googleProvider);
  };
}
