import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import { getRedirectResult, onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';

export type Role = 'customer' | 'admin' | 'agent' | 'anon';

interface AuthValue {
  session: User | null; // firebase user (identity source)
  userId: string | null; // firebase uid — matches RLS `sub` claim
  email: string | null;
  role: Role;
  /** Error from the role-resolution RPCs, if one failed (dev diagnostics). */
  roleError: string | null;
  /** Re-run role resolution with a freshly minted Firebase ID token (claim
   * changes only land in newly issued tokens, so stale sessions need this). */
  refreshRole: () => Promise<void>;
  loading: boolean;
  /** FirebaseError code (or message) from a failed Google redirect, if any. */
  redirectError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Role resolution is authoritative on the backend (RLS functions read the
 * Firebase JWT claims); this only routes UI — never grants access.
 * RPC errors are surfaced, not swallowed — an anon-grade 401/403 (e.g. a JWT
 * rejection by the third-party auth integration) must be diagnosable. */
interface RoleResolution {
  role: Role;
  roleError: string | null;
}
async function resolveRole(user: User | null): Promise<RoleResolution> {
  if (!user) return { role: 'anon', roleError: null };
  try {
    const [adminRes, agentRes] = await Promise.all([
      supabase.rpc('is_current_admin'),
      supabase.rpc('is_current_agent'),
    ]);
    if (adminRes.error || agentRes.error) {
      const msg =
        [adminRes.error?.message, agentRes.error?.message].filter(Boolean).join(' | ') ||
        'role RPC failed without message';
      if (import.meta.env.DEV) console.error('[auth] role error:', msg);
      return { role: 'customer', roleError: msg };
    }
    if (adminRes.data === true) return { role: 'admin', roleError: null };
    if (agentRes.data === true) return { role: 'agent', roleError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (import.meta.env.DEV) console.error('[auth] role error:', msg);
    return { role: 'customer', roleError: msg }; // claim-less or network hiccup — safe default
  }
  return { role: 'customer', roleError: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => firebaseAuth.currentUser);
  const [role, setRole] = useState<Role>('anon');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirectError, setRedirectError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const apply = async (next: User | null) => {
      if (!active) return;
      setUser(next);
      const r = await resolveRole(next);
      if (!active) return;
      setRole(r.role);
      setRoleError(r.roleError);
      if (next && r.role === 'customer' && !r.roleError) {
        // One minimal upsert per authenticated app session, keyed by verified
        // Firebase subject; SQL excludes admin/agent identities as defense in depth.
        void (async () => {
          try {
            const { error } = await supabase.rpc('kv_record_user_activity');
            if (error && import.meta.env.DEV) console.warn('[activity] session record failed', error.message);
          } catch (error: unknown) {
            if (import.meta.env.DEV) console.warn('[activity] session record failed', error);
          }
        })();
      }
    };

    const unsub = onAuthStateChanged(firebaseAuth, (next) => {
      if (import.meta.env.DEV) {
        // Diagnostics only: UID prefix, never tokens or full identifiers.
        console.log(
          `[auth] state ${next ? 'signed-in uid=' + next.uid.slice(0, 6) + '…' : 'signed-out'} @ ${window.location.pathname}`,
        );
      }
      setLoading(false);
      void apply(next);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    let active = true;
    // The SDK's automatic redirect handling swallows errors (see
    // tryRedirectSignIn in @firebase/auth); calling getRedirectResult explicitly
    // surfaces them so the Sign In page can show a useful message.
    void getRedirectResult(firebaseAuth)
      .then((result) => {
        if (!active) return;
        if (import.meta.env.DEV) {
          console.log(
            `[auth] redirect result ${result?.user ? 'uid=' + result.user.uid.slice(0, 6) + '…' : 'none'} @ ${window.location.pathname}`,
          );
        }
        return null;
      })
      .catch((e: unknown) => {
        if (!active) return;
        // FirebaseError carries `.code`; be tolerant of wrapped errors too.
        const info =
          e instanceof FirebaseError
            ? e.code
            : e instanceof Error && 'code' in e
              ? String((e as { code: unknown }).code)
              : String(e);
        if (import.meta.env.DEV) {
          const msg = e instanceof FirebaseError ? e.message : '';
          console.error(`[auth] redirect error ${info} ${msg} @ ${window.location.pathname}`);
        }
        setRedirectError(info);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Warm the ID token early so the first Supabase query carries claims.
    if (user) {
      void user
        .getIdToken(false)
        .then(() => undefined)
        .catch(() => undefined);
    }
  }, [user]);

  const signOutFn = useMemo(
    () => async () => {
      await firebaseSignOut(firebaseAuth);
      setUser(null);
      setRole('anon');
      setRoleError(null);
    },
    [],
  );

  const refreshRoleFn = useMemo(
    () => async () => {
      if (!user) {
        setRole('anon');
        setRoleError(null);
        return;
      }
      // Force-mint a token so recently added custom claims (e.g. the
      // `role: 'authenticated'` claim required by third-party auth) apply
      // without a full sign-out cycle.
      try {
        await user.getIdToken(/* forceRefresh */ true);
      } catch {
        /* fall through — the RPC call reports what it sees */
      }
      const r = await resolveRole(user);
      setRole(r.role);
      setRoleError(r.roleError);
    },
    [user],
  );

  const value = useMemo<AuthValue>(
    () => ({
      session: user,
      userId: user?.uid ?? null,
      email: user?.email ?? null,
      role,
      roleError,
      refreshRole: refreshRoleFn,
      loading,
      redirectError,
      signOut: signOutFn,
    }),
    [user, role, roleError, refreshRoleFn, loading, redirectError, signOutFn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
