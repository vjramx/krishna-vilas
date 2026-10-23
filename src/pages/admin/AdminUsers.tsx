import { useEffect, useState } from 'react';
import { Search, Users, UserRound, ShoppingBag, Clock3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { isMissingRpcFunction, parseKvError } from '@/lib/errors';
import { Spinner } from '@/components/ui';

interface DirectoryUser {
  user_id: string;
  email: string;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  order_count: number;
  /** Surfaced by the directory RPC since 0023: null for customers,
   * 'admin' | 'super_admin' for staff (staff never appear in activity, so
   * the role chip is the only way the owner shows up as Super admin here). */
  admin_role?: 'admin' | 'super_admin' | null;
}
interface DirectoryResult {
  total_users: number;
  active_today: number;
  active_7_days: number;
  new_today: number;
  total_results: number;
  users: DirectoryUser[];
}
const PAGE_SIZE = 25;

export default function AdminUsers() {
  const { t, locale } = useLanguage();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'new' | 'active'>('all');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error: requestError } = await supabase.rpc('admin_user_directory', {
            p_search: search.trim() || null,
            p_filter: filter,
            p_limit: PAGE_SIZE,
            p_offset: offset,
          });
          if (!active) return;
          if (requestError) {
            const missingDirectoryRpc = isMissingRpcFunction(requestError, 'admin_user_directory');
            if (import.meta.env.DEV) console.error('[admin users] directory RPC failed', requestError);
            setError(t(missingDirectoryRpc ? 'admin.users.migrationRequired' : parseKvError(requestError).key));
          }
          else {
            setResult(data as DirectoryResult);
            setError(null);
          }
        } catch (requestError) {
          if (!active) return;
          setError(t(parseKvError(requestError).key));
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filter, offset, search, t]);

  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const filters = [
    { key: 'all' as const, label: t('admin.users.filterAll') },
    { key: 'new' as const, label: t('admin.users.filterNew') },
    { key: 'active' as const, label: t('admin.users.filterActive') },
  ];

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('admin.users.title')}</h1>
        <p className="text-sm text-brand-subtle">{t('admin.users.scope')}</p>
      </header>
      {result && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('admin.users.analytics')}>
          {[
            { label: t('admin.users.totalObserved'), value: result.total_users, Icon: Users },
            { label: t('admin.users.activeToday'), value: result.active_today, Icon: UserRound },
            { label: t('admin.users.activeSevenDays'), value: result.active_7_days, Icon: Clock3 },
            { label: t('admin.users.newToday'), value: result.new_today, Icon: ShoppingBag },
          ].map(({ label, value, Icon }) => (
            <article key={label} className="card grid gap-2 p-3"><Icon size={18} className="text-brand-primary" aria-hidden="true" /><p className="text-xs text-brand-subtle">{label}</p><p className="text-2xl font-extrabold tabular-nums">{value}</p></article>
          ))}
        </section>
      )}
      <p className="text-xs text-brand-subtle" title={t('admin.users.activeDefinition')}>{t('admin.users.activeDefinition')}</p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('admin.filter')}>
        {filters.map((item) => <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={`badge border px-3 py-2 ${filter === item.key ? 'border-brand-primary bg-brand-primary text-white' : 'border-brand-border bg-white'}`} onClick={() => { setFilter(item.key); setOffset(0); }}>{item.label}</button>)}
      </div>
      <label className="relative block">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-subtle" aria-hidden="true" />
        <input className="input pl-9" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder={t('admin.users.search')} aria-label={t('admin.users.search')} />
      </label>
      {error && <p className="text-sm text-brand-error" role="alert">{error}</p>}
      {loading ? <Spinner label={t('common.loading')} /> : result?.users.length ? (
        <ul className="grid gap-2">
          {result.users.map((user) => <li key={user.user_id} className="card grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0"><p className="truncate font-semibold">{user.display_name || user.email}</p><p className="truncate text-xs text-brand-subtle">{user.email}</p><p className="mt-1 text-xs text-brand-subtle">{t('admin.users.firstSeen')}: {date(user.first_seen_at)}</p><p className="text-xs text-brand-subtle">{t('admin.users.lastActive')}: {date(user.last_seen_at)}</p></div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <span className="badge w-fit bg-brand-bg text-brand-text"><ShoppingBag size={14} aria-hidden="true" /> {t('admin.users.orders', { count: user.order_count })}</span>
              {user.admin_role === 'super_admin' && <span className="badge w-fit bg-brand-primary/10 text-brand-primary">{t('admin.access.roleSuper')}</span>}
              {user.admin_role === 'admin' && <span className="badge w-fit bg-brand-border/40 text-brand-subtle">{t('admin.access.roleAdmin')}</span>}
            </div>
          </li>)}
        </ul>
      ) : <p className="card p-5 text-sm text-brand-subtle" role="status">{t('admin.users.empty')}</p>}
      {result && result.total_results > PAGE_SIZE && <nav className="flex items-center justify-between gap-3" aria-label={t('admin.users.pagination')}>
        <button type="button" className="btn-secondary flex-1" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('admin.users.previous')}</button>
        <span className="text-xs tabular-nums text-brand-subtle">{offset + 1}–{Math.min(offset + PAGE_SIZE, result.total_results)} / {result.total_results}</span>
        <button type="button" className="btn-secondary flex-1" disabled={offset + PAGE_SIZE >= result.total_results || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('admin.users.next')}</button>
      </nav>}
    </div>
  );
}
