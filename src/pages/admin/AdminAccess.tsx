import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { EmptyState, ErrorState, Sheet, Spinner } from '@/components/ui';
import { MailPlus, Search, ShieldCheck, ShieldX, Trash2, UserPlus } from 'lucide-react';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

interface AdminRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

/** Row of the Add-admin picker: every registered account, with the staff role
 * surfaced by admin_user_directory (0023) so current admins are obvious. */
interface DirectoryUserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  order_count: number;
  admin_role?: 'admin' | 'super_admin' | null;
}

const STATUS_ACTIONS: Record<string, string> = {
  NOT_SUPER_ADMIN: 'admin.access.errNotSuper',
  FIELD_EMAIL: 'admin.access.errEmail',
  FIELD_ROLE: 'admin.access.errRole',
  CANNOT_INVITE_SELF: 'admin.access.errSelf',
  ALREADY_ADMIN: 'admin.access.errAlready',
  ADMIN_INVITATION_CONFLICT: 'admin.access.errConflict',
  AUTH_REQUIRED: 'admin.access.noManagementAccess',
  CANNOT_REMOVE_SELF: 'admin.access.errRemoveSelf',
  USER_NOT_SIGNED_UP: 'admin.access.userNotSignedUp',
  LAST_SUPER_ADMIN: 'admin.access.errLastSuper',
};

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function AdminAccess() {
  const { t, lang } = useLanguage();
  // Own email (lower-cased once) so the super admin's row never shows the
  // delete action — staff_remove_admin refuses self-removal server-side.
  const meEmail = useAuth().email?.toLowerCase();
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuper, setIsSuper] = useState(false);
  const [accessData, setAccessData] = useState({ admins: false, invitations: false });
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [roleSel, setRoleSel] = useState<'admin' | 'super_admin'>('admin');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Add-admin picker: the searchable list of every registered account.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUsers, setPickerUsers] = useState<DirectoryUserRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerError, setPickerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [superRes, adminsRes, invitesRes] = await Promise.all([
        supabase.rpc('is_current_super_admin'),
        supabase.from('admin_users').select('id, email, role, created_at').order('created_at'),
        supabase.from('admin_invitations').select('*').order('created_at', { ascending: false }),
      ]);
      if (superRes.error) {
        setErrorMsg(superRes.error.message);
        setState('error');
        return;
      }
      const isSuperAdmin = superRes.data === true;
      setIsSuper(isSuperAdmin);
      setAccessData({ admins: !adminsRes.error, invitations: !invitesRes.error });
      if (adminsRes.error && isSuperAdmin) throw adminsRes.error;
      if (invitesRes.error && isSuperAdmin) throw invitesRes.error;
      setAdmins(adminsRes.data ?? []);
      setInvites(invitesRes.data ?? []);
      setState('ready');
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : t('common.somethingWrong'));
      setState('error');
    }
  }, [t]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  function rpcErrorKey(error: unknown): string {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? [
            'message' in error ? String(error.message) : '',
            'code' in error ? String(error.code) : '',
            'status' in error ? String(error.status) : '',
          ].join(' ')
        : String(error ?? '');
    for (const [code, key] of Object.entries(STATUS_ACTIONS)) {
      if (message.includes(code)) return key;
    }
    if (/401|403|42501|permission denied/i.test(message)) return 'admin.access.noManagementAccess';
    return 'common.somethingWrong';
  }

  async function invite() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFormError(null);
    try {
      const { error } = await supabase.rpc('staff_invite_admin', { p_email: email.trim(), p_role: roleSel });
      if (error) throw error;
      setEmail('');
      setRoleSel('admin');
      setNotice(t('admin.access.invited'));
      void load();
    } catch (error: unknown) {
      setFormError(rpcErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const { error } = await supabase.rpc('staff_revoke_invitation', { p_id: id });
      if (error) throw error;
      void load();
    } catch (error: unknown) {
      setFormError(rpcErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  /** Debounced, searchable directory-over-auth.users (0023). Backed by the
   * same RPC the Users page uses, so both surfaces stay consistent. */
  const loadPickerUsers = useCallback(async (searchTerm: string) => {
    setPickerLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_user_directory', {
        p_search: searchTerm.trim() || null,
        p_filter: 'all',
        p_limit: 50,
        p_offset: 0,
      });
      if (error) {
        setPickerError(rpcErrorKey(error));
        return;
      }
      setPickerUsers(((data as { users?: DirectoryUserRow[] }).users ?? []));
      setPickerError(null);
    } catch (error: unknown) {
      setPickerError(rpcErrorKey(error));
    } finally {
      setPickerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const timer = window.setTimeout(() => void loadPickerUsers(pickerSearch), 250);
    return () => window.clearTimeout(timer);
  }, [pickerOpen, pickerSearch, loadPickerUsers]);

  function closePicker() {
    setPickerOpen(false);
    setPickerSearch('');
    setPickerUsers([]);
    setPickerError(null);
  }

  /** Direct grant for an already registered account (invitation covers the
   * rest). Success closes the picker and refreshes the admins list; errors
   * surface inside the sheet so the admin never loses their search context. */
  async function grantAccess(emailTarget: string, role: 'admin' | 'super_admin') {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFormError(null);
    setPickerError(null);
    try {
      const { error } = await supabase.rpc('staff_grant_admin', { p_email: emailTarget, p_role: role });
      if (error) throw error;
      closePicker();
      setNotice(t('admin.access.granted'));
      void load();
    } catch (error: unknown) {
      setPickerError(rpcErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccess(emailTarget: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFormError(null);
    try {
      const { error } = await supabase.rpc('staff_remove_admin', { p_email: emailTarget });
      if (error) throw error;
      setNotice(t('admin.access.removed'));
      void load();
    } catch (error: unknown) {
      setFormError(rpcErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <Spinner />;
  if (state === 'error') return <ErrorState message={errorMsg} onRetry={() => void load()} />;

  const pending = invites.filter((i) => i.status === 'pending');
  const settled = invites.filter((i) => i.status !== 'pending');

  return (
    <div className="grid gap-3 content-start">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{t('admin.access')}</h1>
        {isSuper && (
          <button type="button" className="btn-primary min-h-11 gap-2" onClick={() => setPickerOpen(true)}>
            <UserPlus size={17} aria-hidden="true" />
            {t('admin.access.addAdmin')}
          </button>
        )}
      </div>

      {!isSuper && (
        <div className="card p-4" role="note">
          <p className="flex items-center gap-2 text-sm text-brand-subtle">
            <ShieldX size={16} className="shrink-0 text-brand-primary" aria-hidden="true" />
            {t('admin.access.viewOnly')}
          </p>
        </div>
      )}

      {notice && (
        <div className="card border-brand-success/30 p-3" role="status">
          <p className="text-sm text-brand-success">{notice}</p>
        </div>
      )}
      {formError && (
        <div className="card border-brand-error/25 p-3" role="alert">
          <p className="text-sm text-brand-error">{t(formError)}</p>
        </div>
      )}

      {/* Invite form (super admin only — backend enforces regardless) */}
      {isSuper && (
        <section className="card grid gap-3 p-4" aria-labelledby="acc-invite">
          <h2 id="acc-invite" className="flex items-center gap-2 font-bold">
            <MailPlus size={16} className="text-brand-primary" aria-hidden="true" />
            {t('admin.access.inviteTitle')}
          </h2>
          <p className="text-xs text-brand-subtle">{t('admin.access.inviteHint')}</p>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <div>
              <label className="label" htmlFor="inv-email">{t('admin.access.email')}</label>
              <input
                id="inv-email"
                type="email"
                className="input"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <span className="label">{t('admin.access.role')}</span>
              <div className="mt-1 flex gap-2" role="radiogroup" aria-label={t('admin.access.role')}>
                {(['admin', 'super_admin'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={roleSel === r}
                    onClick={() => setRoleSel(r)}
                    className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${
                      roleSel === r
                        ? 'border-brand-primary bg-brand-primary text-white'
                        : 'border-brand-border bg-white text-brand-text'
                    }`}
                  >
                    {r === 'admin' ? t('admin.access.roleAdmin') : t('admin.access.roleSuper')}
                  </button>
                ))}
              </div>
            </div>
            <button type="submit" className="btn-primary w-fit px-6" disabled={busy || email.trim() === ''}>
              {t('admin.access.send')}
            </button>
          </form>
        </section>
      )}

      {/* Pending invitations */}
      {!isSuper && (!accessData.admins || !accessData.invitations) && (
        <p className="card p-3 text-sm text-brand-warn" role="status">
          {t('admin.access.noManagementAccess')}
        </p>
      )}

      <section className="card overflow-hidden" aria-labelledby="acc-pending">
        <h2 id="acc-pending" className="border-b border-brand-border px-4 py-3 font-bold">
          {t('admin.access.pending')} ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-brand-subtle">{t('admin.access.noPending')}</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{inv.email}</p>
                  <p className="text-xs text-brand-subtle">
                    {inv.role === 'super_admin' ? t('admin.access.roleSuper') : t('admin.access.roleAdmin')}
                    {' · '}{t('admin.access.expires')} {fmtDate(inv.expires_at, lang === 'kn' ? 'kn-IN' : 'en-IN')}
                    {' · '}{t('admin.access.invitedBy')} {inv.invited_by}
                  </p>
                </div>
                {isSuper && (
                  <button
                    type="button"
                    className="btn-secondary shrink-0 px-3 text-sm text-brand-error"
                    disabled={busy}
                    onClick={() => void revoke(inv.id)}
                  >
                    <ShieldX size={16} aria-hidden="true" />
                    {t('admin.access.revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Admins with access */}
      <section className="card overflow-hidden" aria-labelledby="acc-admins">
        <h2 id="acc-admins" className="flex items-center gap-2 border-b border-brand-border px-4 py-3 font-bold">
          <ShieldCheck size={16} className="text-brand-primary" aria-hidden="true" />
          {t('admin.access.admins')} ({admins.length})
        </h2>
        {admins.length === 0 ? (
          <div className="px-2 py-2">
            <EmptyState
              icon={<ShieldCheck size={28} aria-hidden="true" />}
              title={t('admin.access.noAdmins')}
              hint={t('admin.access.inviteHint')}
            />
          </div>
        ) : (
          <ul className="divide-y divide-brand-border">
            {admins.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-secondary to-brand-primary text-xs font-bold text-white"
                  aria-hidden="true"
                >
                  {a.email.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.email}</p>
                  <p className="text-xs text-brand-subtle">{t('admin.access.since')} {fmtDate(a.created_at, lang === 'kn' ? 'kn-IN' : 'en-IN')}</p>
                </div>
                <span
                  className={`badge shrink-0 ${
                    a.role === 'super_admin' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-border/40 text-brand-subtle'
                  }`}
                >
                  {a.role === 'super_admin' ? t('admin.access.roleSuper') : t('admin.access.roleAdmin')}
                </span>
                {isSuper && a.email.toLowerCase() !== meEmail && (
                  <button
                    type="button"
                    className="grid h-11 w-11 place-items-center rounded-lg text-brand-error active:bg-brand-errorBg"
                    aria-label={`${t('admin.access.remove')} ${a.email}`}
                    disabled={busy}
                    onClick={() => void removeAccess(a.email)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* History of settled invitations */}
      {settled.length > 0 && (
        <section className="card overflow-hidden" aria-labelledby="acc-history">
          <h2 id="acc-history" className="border-b border-brand-border px-4 py-3 text-sm font-bold text-brand-subtle">
            {t('admin.access.history')}
          </h2>
          <ul className="divide-y divide-brand-border">
            {settled.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <p className="min-w-0 flex-1 truncate">{inv.email}</p>
                <span
                  className={`badge shrink-0 ${
                    inv.status === 'accepted'
                      ? 'bg-brand-successBg text-brand-success'
                      : inv.status === 'expired'
                        ? 'bg-brand-warnBg text-brand-warn'
                        : 'bg-brand-errorBg text-brand-error'
                  }`}
                >
                  {inv.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card grid gap-3 p-4" aria-labelledby="acc-role-differences">
        <h2 id="acc-role-differences" className="font-bold">{t('admin.access.roleDifferences')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-xl border border-brand-border bg-white p-3">
            <h3 className="text-sm font-bold">{t('admin.access.roleAdmin')}</h3>
            <p className="mt-1 text-sm text-brand-subtle">{t('admin.access.roleAdminDetails')}</p>
          </article>
          <article className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-3">
            <h3 className="text-sm font-bold text-brand-primary">{t('admin.access.roleSuper')}</h3>
            <p className="mt-1 text-sm text-brand-subtle">{t('admin.access.roleSuperDetails')}</p>
          </article>
        </div>
      </section>

      {/* Add-admin picker: every registered account, searchable, with direct
          role grants (no invitation round trip). Bottom sheet on phones,
          centered dialog on desktop via desktopDialog. */}
      <Sheet
        open={pickerOpen}
        onClose={closePicker}
        title={t('admin.access.addAdmin')}
        desktopDialog
        headerIcon={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-primary/10 text-brand-primary"><UserPlus size={18} aria-hidden="true" /></span>}
      >
        <div className="grid content-start gap-3 px-4 pb-4">
          <p className="text-xs text-brand-subtle">{t('admin.access.pickHint')}</p>
          {pickerError && (
            <p className="card border-brand-error/25 p-3 text-sm text-brand-error" role="alert">{t(pickerError)}</p>
          )}
          <label className="relative block">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-subtle" aria-hidden="true" />
            <input
              className="input pl-9"
              type="search"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder={t('admin.users.search')}
              aria-label={t('admin.users.search')}
            />
          </label>
          {pickerLoading ? (
            <div className="grid place-items-center py-8"><Spinner /></div>
          ) : pickerUsers.length === 0 ? (
            <p className="card p-5 text-center text-sm text-brand-subtle">{t('admin.access.noUsersFound')}</p>
          ) : (
            <ul className="grid gap-2">
              {pickerUsers.map((u) => (
                <li key={u.user_id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-brand-border bg-white p-2.5">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-secondary to-brand-primary text-xs font-bold text-white"
                    aria-hidden="true"
                  >
                    {(u.display_name || u.email).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{u.display_name || u.email}</p>
                    <p className="truncate text-xs text-brand-subtle">{u.email}</p>
                  </div>
                  {u.admin_role && (
                    <span
                      className={`badge shrink-0 ${
                        u.admin_role === 'super_admin' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-border/40 text-brand-subtle'
                      }`}
                    >
                      {u.admin_role === 'super_admin' ? t('admin.access.roleSuper') : t('admin.access.roleAdmin')}
                    </span>
                  )}
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                    {!u.admin_role && (
                      <button
                        type="button"
                        className="btn-secondary min-h-[44px] px-3 text-sm"
                        disabled={busy}
                        onClick={() => void grantAccess(u.email, 'admin')}
                      >
                        {t('admin.access.grantAdmin')}
                      </button>
                    )}
                    {u.admin_role !== 'super_admin' && (
                      <button
                        type="button"
                        className="btn-secondary min-h-[44px] px-3 text-sm text-brand-primary"
                        disabled={busy}
                        onClick={() => void grantAccess(u.email, 'super_admin')}
                        aria-label={`${u.email}: ${t('admin.access.makeSuper')}`}
                      >
                        {t('admin.access.makeSuper')}
                      </button>
                    )}
                    {u.admin_role === 'super_admin' && (
                      <button
                        type="button"
                        className="btn-secondary min-h-[44px] px-3 text-sm"
                        disabled={busy}
                        onClick={() => void grantAccess(u.email, 'admin')}
                        aria-label={`${u.email}: ${t('admin.access.makeAdmin')}`}
                      >
                        {t('admin.access.makeAdmin')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </div>
  );
}
