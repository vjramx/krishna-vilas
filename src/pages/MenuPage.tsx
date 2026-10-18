import { useMemo, useRef, useState } from 'react';
import { useMenu, filterMenu, groupByCategory } from '@/hooks/useMenu';
import { ItemCard, ItemSheet } from '@/components/ItemCard';
import { CustomerHeader, BottomNav } from '@/components/nav';
import { EmptyState, ErrorState, SkeletonItem } from '@/components/ui';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useLanguage } from '@/context/LanguageContext';
import { Search, Inbox, X } from 'lucide-react';
import type { MenuItem } from '@/types/db';

export default function MenuPage() {
  const { t, lang } = useLanguage();
  const menu = useMenu();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [dietary, setDietary] = useState<'all' | 'veg' | 'non-veg'>('all');
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => filterMenu(menu.items, query, cat, dietary), [menu.items, query, cat, dietary]);
  const groups = useMemo(() => groupByCategory(filtered, menu.categories), [filtered, menu.categories]);

  return (
    <div className="min-h-dvh bg-brand-bg">
      <CustomerHeader />

      {/* Sticky search + category rail, exactly one toolbar height under the app bar. */}
      <div
        className="sticky z-20 border-b border-brand-border bg-brand-bg/95 backdrop-blur"
        style={{ top: 'var(--app-header)' }}
      >
        <div className="app-col pb-2 pt-2">
          <div className="relative">
            <Search
              size={19}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-subtle"
            />
            <input
              ref={searchRef}
              type="search"
              className="input h-12 rounded-full bg-white pl-10 pr-11 shadow-elev1"
              placeholder={t('menu.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
              aria-label={t('nav.search')}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                className="tap absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-brand-subtle active:bg-brand-bg"
                aria-label={t('common.clear')}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-0.5"
            role="tablist"
            aria-label={t('menu.title')}
          >
            {[{ id: null as string | null, label: t('menu.all') }, ...menu.categories.map((c) => ({
              id: c.id,
              label: lang === 'kn' ? c.name_kn || c.name_en : c.name_en,
            }))].map((chip) => {
              const active = cat === chip.id;
              return (
                <button
                  key={chip.id ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCat(chip.id)}
                  className={`tap shrink-0 rounded-full border px-3.5 text-[13px] font-semibold ${
                    active
                      ? 'border-brand-primary bg-brand-primary text-white shadow-elev1'
                      : 'border-brand-border bg-white text-brand-text active:bg-brand-bg'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2" role="group" aria-label={t('menu.dietaryFilter')}>
            {([
              ['all', 'menu.all'], ['veg', 'menu.veg'], ['non-veg', 'menu.nonVeg'],
            ] as const).map(([value, key]) => <button key={value} type="button" aria-pressed={dietary === value} onClick={() => setDietary(value)} className={`tap min-h-[40px] rounded-full border px-3 text-xs font-semibold ${dietary === value ? 'border-brand-text bg-brand-text text-white' : 'border-brand-border bg-white text-brand-text'}`}>{t(key)}</button>)}
          </div>
        </div>
      </div>

      <main className="app-col pb-nav pt-3">
        <PullToRefresh onRefresh={() => menu.refresh()}>
          {menu.loading && menu.items.length === 0 ? (
            <div className="grid gap-2.5">
              <SkeletonItem />
              <SkeletonItem />
              <SkeletonItem />
              <SkeletonItem />
            </div>
          ) : menu.error && menu.items.length === 0 ? (
            <ErrorState message={t('common.network')} onRetry={menu.retry} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Inbox size={26} />}
              title={query || cat ? t('menu.empty') : t('menu.emptyCategory')}
              action={
                <button type="button" className="btn-secondary mt-1" onClick={menu.retry}>
                  {t('common.retry')}
                </button>
              }
            />
          ) : (
            <div className="grid gap-5">
              {groups.map((g) => (
                <section key={g.cat.id} aria-labelledby={`cat-${g.cat.id}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2
                      id={`cat-${g.cat.id}`}
                      className="text-[13px] font-extrabold uppercase tracking-wider text-brand-subtle"
                    >
                      {lang === 'kn' ? g.cat.name_kn || g.cat.name_en : g.cat.name_en}
                    </h2>
                    <span className="h-px flex-1 bg-brand-border" aria-hidden="true" />
                    <span className="text-[11px] font-semibold text-brand-subtle">{g.items.length}</span>
                  </div>
                  <div className="grid gap-2.5">
                    {g.items.map((item) => (
                      <ItemCard key={item.id} item={item} onOpen={setOpenItem} />
                    ))}
                  </div>
                </section>
              ))}
              <p className="pb-2 text-center text-[11px] text-brand-subtle">{t('app.tagline')}</p>
            </div>
          )}
        </PullToRefresh>
      </main>

      <BottomNav />
      <ItemSheet item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}
