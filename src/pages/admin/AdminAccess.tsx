import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { EmptyState, ErrorState, Spinner } from '@/components/ui';
import { MailPlus, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';

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

const STATUS_ACTIONS: Record<string, string> = {
  NOT_SUPER_ADMIN: 'admin.access.errNotSuper',
  FIELD_EMAIL: 'admin.access.errEmail',
  FIELD_ROLE: 'admin.access.errRole',
  CANNOT_INVITE_SELF: 'admin.access.errSelf',
  ALREADY_ADMIN: 'admin.access.errAlready',
  ADMIN_INVITATION_CONFLICT: 'admin.access.errConflict',
  AUTH_REQUIRED: 'admin.access.noManagementAccess',
  CANNOT_REMOVE_SELF: 'admin.access.errRemoveSelf',
  CANNOT_REMOVE_SUPER_ADMIN: 'admin.access.errRemoveSuper',
};

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function AdminAccess() {
  const { t, lang } = useLanguage();
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
      <h1 className="text-lg font-bold">{t('admin.access')}</h1>

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
                {isSuper && a.role !== 'super_admin' && (
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
    </div>
  );
}
