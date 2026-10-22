import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { firebaseAuth } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';

export type Role = 'customer' | 'admin' | 'agent' | 'anon';

interface AuthValue {
  session: User | null; // firebase user (identity source)
  userId: string | null; // firebase uid — matches RLS `sub` claim
  /** The STABLE assignment key (agent_users.id, uuid-as-text) for the signed
   * in delivery agent. Resolved server-side via the agent's own RLS-visible
   * row — identical contract to kv_agent_id()/pick_auto_assign_agent(), which
   * is what's actually stored in orders.agent_id. Firebase uid is the identity,
   * NOT the assignment key: matching orders by it silently misses every
   * auto-assigned order (0021/0022 store agent_users.id). */
  agentId: string | null;
  email: string | null;
  role: Role;
  /** Error from the role-resolution RPCs, if one failed (dev diagnostics). */
  roleError: string | null;
  /** Re-run role resolution with a freshly minted Firebase ID token (claim
   * changes only land in newly issued tokens, so stale sessions need this). */
  refreshRole: () => Promise<void>;
  loading: boolean;
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
  const [agentId, setAgentId] = useState<string | null>(null);

  // Agents need their stable agent_users.id to query/filter their own
  // assignments (orders.agent_id holds exactly this value). agents_select_own
  // exposes precisely the caller's row, so an unfiltered single-row read is
  // the RLS-sanctioned lookup — the client never guesses identity by email
  // substring or display name.
  useEffect(() => {
    let active = true;
    if (!user || role !== 'agent') {
      setAgentId((prev) => (prev === null ? prev : null));
      return;
    }
    void supabase
      .from('agent_users')
      .select('id')
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (import.meta.env.DEV) {
          console.log('[auth] agent assignment key resolved:', data ? 'ok' : 'missing');
        }
        setAgentId((data as { id: string } | null)?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, [user, role]);
  const [loading, setLoading] = useState(true);

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
        // Guest (anonymous) sessions are skipped: kv_record_user_activity
        // requires an email and would only raise AUTH_REQUIRED for them.
        if (next.isAnonymous) return;
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
      agentId,
      email: user?.email ?? null,
      role,
      roleError,
      refreshRole: refreshRoleFn,
      loading,
      signOut: signOutFn,
    }),
    [user, role, agentId, roleError, refreshRoleFn, loading, signOutFn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
