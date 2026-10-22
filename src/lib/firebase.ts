import { initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  linkWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  type User,
} from 'firebase/auth';

// Firebase web config (public by design — these keys identify the project, they are not secrets).
const firebaseConfig = {
  apiKey: 'AIzaSyDsv8xuZTiZm174dwazQ01l0HgRI5kyLm0',
  authDomain: 'krishna-vilas.firebaseapp.com',
  projectId: 'krishna-vilas',
  storageBucket: 'krishna-vilas.firebasestorage.app',
  messagingSenderId: '305867236383',
  appId: '1:305867236383:web:dce195d388abb960c1e12a',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

// Session survives refreshes; private-mode browsers keep it in memory instead.
void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
  /* storage unavailable (private mode) — session stays in memory */
});

/** Email/password sign-in. Throws the raw FirebaseError — the UI maps its code. */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(firebaseAuth, email, password);
}

/**
 * Guest session (Firebase anonymous auth). Same JWT shape, same `sub` claim —
 * so orders, RLS and order history work without any schema or policy change;
 * orders simply attach to this device's session.
 */
export async function signInAsGuest(): Promise<void> {
  if (isGuestSession()) return; // already a guest — reuse the live UID
  try {
    await signInAnonymously(firebaseAuth);
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    // The Anonymous provider is off in Firebase Console (the Identity Toolkit
    // API answers banned-identity for a provider that is disabled entirely).
    // Give it its own marker so the UI shows guest-specific guidance instead
    // of email/password copy.
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      throw Object.assign(
        new Error('Firebase: guest-provider-disabled (auth/operation-not-allowed).'),
        { code },
      );
    }
    throw e;
  }
}

/** True when the current session is an anonymous (guest) Firebase user. */
export function isGuestSession(): boolean {
  return firebaseAuth.currentUser?.isAnonymous ?? false;
}

/**
 * Email/password registration. When the visitor is currently a guest, the
 * anonymous account is *upgraded* in place (linkWithCredential): the UID stays
 * the same, so any orders placed as a guest carry over to the new account.
 *
 * A verification email is always sent: the backend matches admin/agent roles
 * on the verified-token email claim, so an unverified mailbox must never be
 * treated as proof of identity (see 0003_firebase_identity.is_allowed_issuer).
 */
export async function registerWithEmail(email: string, password: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (user?.isAnonymous) {
    const { user: linked } = await linkWithCredential(user, EmailAuthProvider.credential(email, password));
    if (linked && linked.email && !linked.emailVerified) {
      await sendEmailVerification(linked);
    }
    return;
  }
  const { user: created } = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  await sendEmailVerification(created);
}

/**
 * Sends the email-verification message again for the current session. Used by
 * both the “verify your email” step after signing up and the resend action.
 * The caller (UI) maps Firebase errors — e.g. too-many-requests throttling.
 */
export async function sendVerificationEmail(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user || user.isAnonymous || user.emailVerified) return;
  await sendEmailVerification(user);
}

/** Sends Firebase's password-reset email for an existing account. */
export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth, email);
}

export function currentFirebaseUser(): User | null {
  return firebaseAuth.currentUser;
}
