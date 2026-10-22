/**
 * Web client of the Android app's native Google sign-in bridge.
 *
 * The Android wrapper injects `window.KrishnaVilasAuth` (androidx.webkit
 * WebMessageListener) pinned to this origin only. Signing in natively —
 * Credential Manager on the Android side — avoids the browser-redirect OAuth
 * hop that previously stranded users in Chrome: the ID token is transferred
 * over this channel alone, never via URL parameters or fragments.
 *
 * The object is only present inside the Krishna Vilas Android WebView; on
 * desktop/normal mobile browsers (and iOS in-app browsers) it never appears,
 * so every consumer of this module falls back to the standard Firebase flows.
 */

/** Name of the injected JS object — must match AUTH_BRIDGE_JS_NAME in the Android app. */
export const KV_BRIDGE_NAME = 'KrishnaVilasAuth';

/** Request message the web page posts to the app. */
const REQUEST_TYPE = 'kv-google-signin';
/** Reply the app posts back. */
const RESULT_TYPE = 'kv-google-signin-result';
/** Deterministic protocol version — bumped together with the Android app. */
const PROTOCOL_VERSION = 1;

/**
 * Google OAuth **web** client ID of the Firebase project `krishna-vilas`.
 * Public by design. The ID token handed over by the app must be issued for
 * this audience — anything else is refused before Firebase ever sees it.
 */
export const WEB_CLIENT_AUDIENCE =
  '305867236383-q7elei4clibaddudru964qohgqcilleb.apps.googleusercontent.com';

/** How long we wait for the app's reply after a request (system account
 * chooser can sit on screen a while; Android may also throttle cold starts). */
const REPLY_TIMEOUT_MS = 120_000;

export interface NativeBridge {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export type NativeSignInStatus =
  | 'ok'
  | 'cancelled'
  | 'no-credentials'
  | 'failed'
  | 'busy'
  | 'timeout'
  | 'invalid-token';

export type NativeSignInResult =
  | { status: 'ok'; token: string }
  | { status: Exclude<NativeSignInStatus, 'ok'>; token?: undefined };

function getBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as Record<string, unknown>)[KV_BRIDGE_NAME];
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as NativeBridge).postMessage === 'function' &&
    typeof (candidate as NativeBridge).addEventListener === 'function'
  ) {
    return candidate as NativeBridge;
  }
  return null;
}

/** True when the native Google sign-in bridge is available (Android WebView). */
export function isNativeGoogleBridgeAvailable(): boolean {
  return getBridge() !== null;
}

interface BridgeReply {
  type?: unknown;
  v?: unknown;
  status?: unknown;
  token?: unknown;
}

function parseReply(raw: unknown): BridgeReply | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as BridgeReply;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as BridgeReply;
  return null;
}

/** Base64url-decode (unpadded or padded) into a UTF-8 string. */
function decodeBase64Url(segment: string): string | null {
  try {
    const cleaned = segment.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export interface IdTokenClaims {
  email: string | null;
}

/**
 * App-side sanity check of a Google ID token before it is used with Firebase:
 * issuer, audience, expiry and a verified email. Firebase repeats full
 * server-side validation (`signInWithCredential` → identitytoolkit
 * verifyAssertion); this guard keeps a tampered or mis-audience token from
 * ever starting a session.
 */
export function checkGoogleIdToken(token: string, nowEpochSeconds = Math.floor(Date.now() / 1000)): IdTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return null;
  try {
    const claims = JSON.parse(payload) as Record<string, unknown>;
    const iss = typeof claims.iss === 'string' ? claims.iss : null;
    if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return null;
    const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : claims.aud != null ? [String(claims.aud)] : [];
    if (!aud.includes(WEB_CLIENT_AUDIENCE)) return null;
    const exp = typeof claims.exp === 'number' ? claims.exp : Number(claims.exp);
    if (!Number.isFinite(exp) || exp <= nowEpochSeconds) return null;
    if (claims.email_verified !== true) return null;
    return { email: typeof claims.email === 'string' ? claims.email : null };
  } catch {
    return null;
  }
}

/**
 * Ask the Android app for a Google ID token (Credential Manager).
 * Resolves `ok` + a claim-checked token, or a structured status the caller
 * maps to UI (cancelled → silent reset, no-credentials → actionable hint).
 */
export function requestNativeGoogleSignIn(): Promise<NativeSignInResult> {
  const bridge = getBridge();
  if (!bridge) {
    return Promise.resolve({ status: 'failed' as const });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: NativeSignInResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      bridge.removeEventListener('message', listener);
      resolve(result);
    };
    const listener = (event: { data: unknown }) => {
      const reply = parseReply(event?.data);
      if (!reply || reply.type !== RESULT_TYPE) return; // other messages on the channel
      const status = reply.status === 'ok' ? 'ok' : String(reply.status);
      const token = typeof reply.token === 'string' ? reply.token : undefined;
      if (status === 'ok') {
        // Finish the handshake first: the claim check is synchronous.
        if (!token) {
          finish({ status: 'invalid-token' as const });
          return;
        }
        finish(checkGoogleIdToken(token) ? { status: 'ok' as const, token } : { status: 'invalid-token' as const });
        return;
      }
      if (
        status === 'cancelled' ||
        status === 'no-credentials' ||
        status === 'failed' ||
        status === 'busy' ||
        status === 'timeout'
      ) {
        // Known statuses pass through as-is (cancelled stays silent in the UI).
        finish({ status: status as Exclude<NativeSignInStatus, 'ok'>, token: undefined });
        return;
      }
      // Unknown/extra statuses degrade to a generic failure, never a hang.
      finish({ status: 'failed' as const });
    };

    bridge.addEventListener('message', listener);
    const timer = window.setTimeout(() => finish({ status: 'timeout' as const }), REPLY_TIMEOUT_MS);
    bridge.postMessage(JSON.stringify({ type: REQUEST_TYPE, v: PROTOCOL_VERSION }));
  });
}
