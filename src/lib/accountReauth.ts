import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { currentFirebaseUser } from '@/lib/firebase';

/**
 * Fresh password confirmation before an irreversible action (account deletion).
 * Reauthentication refreshes the session's `auth_time`; the delete-account
 * Edge Function rejects tokens minted older than 10 minutes.
 *
 * The returned closure matches requestAccountDeletion's `reauthenticate`
 * contract: it resolves on success and throws (e.g. wrong password) so the
 * caller surfaces the retry state — the user still owns their account.
 */
export function reauthenticateWithPassword(email: string | null, password: string): () => Promise<void> {
  return async () => {
    const user = currentFirebaseUser();
    if (!user) throw new Error('no-session');
    const credential = EmailAuthProvider.credential(email ?? user.email ?? '', password);
    await reauthenticateWithCredential(user, credential);
  };
}
