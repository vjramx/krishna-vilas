import { initializeApp } from 'firebase/app';
import { runGoogleSignInFlow } from '@/lib/googleSignInFlow';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
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
export const googleProvider = new GoogleAuthProvider();

void setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
  /* storage unavailable (private mode) — session stays in memory */
});

/**
 * Standalone WebViews (Android WebView, iOS in-app browser) block popups —
 * those environments may only use the redirect flow.
 */
function isEmbeddedWebview(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/; wv\)/i.test(ua)) return true; // Android WebView
  return /iPhone|iPod|iPad/.test(ua) && !/Safari/.test(ua); // iOS in-app browser
}

export const usesRedirectFlow = isEmbeddedWebview();

/**
 * Google sign-in, platform-appropriate flow:
 *  - Desktop/normal browsers: popup. The credential and Firebase session are
 *    established in one direct call — there is no cross-origin redirect return
 *    handshake whose failures the SDK swallows silently.
 *  - Embedded WebViews: redirect. Popups are blocked there; the return trip is
 *    processed explicitly via getRedirectResult() in AuthContext.
 */
export async function startGoogleSignIn(): Promise<void> {
  if (import.meta.env.DEV) {
    console.log(`[auth] starting ${usesRedirectFlow ? 'redirect' : 'popup'} flow${usesRedirectFlow ? ' (embedded WebView)' : ''}`);
  }
  await runGoogleSignInFlow({
    useRedirect: usesRedirectFlow,
    popup: () => signInWithPopup(firebaseAuth, googleProvider),
    redirect: () => {
      if (import.meta.env.DEV && !usesRedirectFlow) console.info('[auth] popup unavailable; falling back to redirect flow');
      return signInWithRedirect(firebaseAuth, googleProvider);
    },
  });
}

export function currentFirebaseUser(): User | null {
  return firebaseAuth.currentUser;
}
