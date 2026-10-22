import { initializeApp } from 'firebase/app';
import { runGoogleSignInFlow } from '@/lib/googleSignInFlow';
import { isNativeGoogleBridgeAvailable, requestNativeGoogleSignIn } from '@/lib/nativeAuthBridge';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithCredential,
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
/**
 * Native-bridge cancellation (system account chooser dismissed / Back pressed)
 * reuses Firebase's cancelled error shape so LoginPage treats it identically:
 * quiet busy-state reset, no error banner.
 */
const cancelledAuthError = (): Error => Object.assign(new Error('sign-in cancelled'), { code: 'auth/user-cancelled' });

export async function startGoogleSignIn(): Promise<void> {
  if (import.meta.env.DEV) {
    console.log(`[auth] starting ${usesRedirectFlow ? 'redirect' : 'popup'} flow${usesRedirectFlow ? ' (embedded WebView)' : ''}`);
  }
  // In the Android WebView the native bridge sign-in in directly (Credential
  // Manager → ID token → signInWithCredential): no OAuth navigation, so the
  // wrapper never hands the Google/`firebaseapp.com` URLs to Chrome. Chrome
  // cannot return an OAuth result across the app boundary, and Google blocks
  // OAuth in embedded WebView user agents — the bridge is the only reliable
  // in-app flow.
  if (isNativeGoogleBridgeAvailable()) {
    const result = await requestNativeGoogleSignIn();
    if (result.status === 'ok') {
      await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(result.token));
      return;
    }
    if (result.status === 'cancelled') throw cancelledAuthError();
    if (result.status === 'no-credentials') {
      throw Object.assign(new Error('no Google account available on this device'), {
        code: 'auth/no-google-account',
      });
    }
    throw Object.assign(new Error(`native sign-in failed (${result.status})`), {
      code: 'auth/native-bridge-failure',
    });
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
