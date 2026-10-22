import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Proves the routing contract of the auth library:
 *  - register as a guest upgrades the anonymous account in place and sends a
 *    verification email (UID preserved, no duplicate identity);
 *  - plain registration also sends the verification email;
 *  - signInAsGuest reuses an existing anonymous session instead of minting a
 *    second one (the device keeps its UID).
 */

const captures = vi.hoisted(() => ({
  linkedWith: [] as unknown[],
  created: [] as unknown[],
  verificationEmails: 0,
}));

/** Sea of truth: captures mutations without letting a real SDK run. */
const fakeUser = (anonymous: boolean, email: string | null = null) => ({
  isAnonymous: anonymous,
  email,
  uid: anonymous ? 'guest-uid' : 'real-uid',
});

const authModule = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(async (_a, email, _p) => {
    captures.created.push(email);
    return { user: fakeUser(false, email) };
  }),
  signInAnonymously: vi.fn(async () => ({ user: fakeUser(true) })),
  signInWithEmailAndPassword: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendEmailVerification: vi.fn(async () => {
    captures.verificationEmails += 1;
  }),
  linkWithCredential: vi.fn(async (user, cred) => {
    captures.linkedWith.push(user.uid);
    return { user: { ...user, email: (cred as { email?: string })?.email ?? user.email, isAnonymous: false, emailVerified: false } };
  }),
}));

// Seed `currentUser` before firebase.ts runs its module top-level.
let currentUser: object | null = null;

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: (email: string, _p: string) => ({ email }) },
  browserLocalPersistence: 'local',
  createUserWithEmailAndPassword: authModule.createUserWithEmailAndPassword,
  getAuth: vi.fn(() => ({
    get currentUser() {
      return currentUser;
    },
  })),
  initializeApp: vi.fn(() => ({ name: 'test' })),
  linkWithCredential: authModule.linkWithCredential,
  sendEmailVerification: authModule.sendEmailVerification,
  sendPasswordResetEmail: authModule.sendPasswordResetEmail,
  setPersistence: vi.fn(async () => undefined),
  signInAnonymously: authModule.signInAnonymously,
  signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
}));

import {
  isGuestSession,
  registerWithEmail,
  sendVerificationEmail,
  signInAsGuest,
} from '@/lib/firebase';

beforeEach(() => {
  captures.linkedWith.length = 0;
  captures.created.length = 0;
  captures.verificationEmails = 0;
  authModule.linkWithCredential.mockClear();
  authModule.createUserWithEmailAndPassword.mockClear();
  authModule.sendEmailVerification.mockClear();
  authModule.signInAnonymously.mockClear();
  currentUser = null;
});

describe('registration creates a customer account and asks for email verification', () => {
  it('plain registration creates an email/password user then sends the verification email', async () => {
    currentUser = fakeUser(false, 'real@example.com');
    expect(isGuestSession()).toBe(false);
    await registerWithEmail('real@example.com', 'hunter22');
    expect(authModule.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(authModule.linkWithCredential).not.toHaveBeenCalled(); // no account-linking for a real user
    expect(captures.verificationEmails).toBe(1); // the customer must verify before the backend trusts their email claim
  });

  it('guest upgrade links in place (same uid) and sends the verification email', async () => {
    currentUser = fakeUser(true);
    expect(isGuestSession()).toBe(true);
    await registerWithEmail('real@example.com', 'hunter22');
    expect(authModule.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(captures.linkedWith).toEqual(['guest-uid']); // same device identity upgraded in place
    expect(captures.verificationEmails).toBe(1);
  });

  it('mints an anonymous session when the device has none', async () => {
    currentUser = null;
    await signInAsGuest();
    expect(authModule.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reuses the existing guest account instead of minting a second one', async () => {
    currentUser = fakeUser(true);
    await signInAsGuest();
    expect(authModule.signInAnonymously).not.toHaveBeenCalled(); // one device, one guest uid
  });

  it('the verification helper sends to the current unverified user and no-ops otherwise', async () => {
    currentUser = fakeUser(false, 'real@example.com');
    await sendVerificationEmail();
    expect(captures.verificationEmails).toBe(1);

    currentUser = null;
    await sendVerificationEmail(); // silent no-op: nothing to verify
    expect(captures.verificationEmails).toBe(1);
  });
});
