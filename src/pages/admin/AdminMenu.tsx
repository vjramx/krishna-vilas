import { useEffect, useMemo, useRef, useState } from 'react';
import { publicImageUrl, supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import { ErrorState, Sheet, Spinner } from '@/components/ui';
import { parseKvError } from '@/lib/errors';
import type { Category, MenuItem } from '@/types/db';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { menuDiscountPercent, menuPriceNumber, validateMenuPrice } from '@/lib/menuItemForm';
import { BadgeCheck, Eye, EyeOff, ImagePlus, Leaf, Pencil, Plus, Save, Star, Upload, Utensils } from 'lucide-react';

interface Draft {
  id?: string;
  category_id: string;
  name_en: string;
  name_kn: string;
  description_en: string;
  description_kn: string;
  price: string;
  original_price: string;
  is_available: boolean;
  is_active: boolean;
  is_featured: boolean;
  is_vegetarian: boolean;
  image_file: File | null;
  image_path: string | null;
}

const emptyDraft = (catId: string): Draft => ({
  category_id: catId,
  name_en: '',
  name_kn: '',
  description_en: '',
  description_kn: '',
  price: '',
  original_price: '',
  is_available: true,
  is_active: true,
  is_featured: false,
  is_vegetarian: true,
  image_file: null,
  image_path: null,
});

export default function AdminMenu() {
  const { t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibilityBusyId, setVisibilityBusyId] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const originalDraft = useRef<Draft | null>(null);

  useEffect(() => {
    if (!draft?.image_file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(draft.image_file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.image_file]);

  const discountPercent = useMemo(() => draft ? menuDiscountPercent(draft.price, draft.original_price) : null, [draft]);

  useEffect(() => {
    // Each effect run owns its lifetime; Strict Mode cleanup must not disable
    // the next run, nor may an old request overwrite a newer retry.
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setLoadError('err.network');
      setLoading(false);
    }, 12000);

    async function load() {
      try {
        const [mi, mc] = await Promise.all([
          supabase.from('menu_items').select('*').order('created_at').abortSignal(controller.signal),
          supabase.from('categories').select('*').order('display_order').abortSignal(controller.signal),
        ]);
        if (!active) return;
        if (mi.error || mc.error) throw mi.error ?? mc.error;
        setItems((mi.data as MenuItem[]) ?? []);
        setCats((mc.data as Category[]) ?? []);
      } catch (error: unknown) {
        if (active) setLoadError(parseKvError(error).key);
      } finally {
        window.clearTimeout(timer);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  async function toggleCustomerVisibility(item: MenuItem) {
    if (visibilityBusyId) return;
    const isActive = !item.is_active;
    setVisibilityBusyId(item.id);
    setErr(null);
    try {
      const { data, error } = await supabase.from('menu_items')
        .update({ is_active: isActive }).eq('id', item.id).select('id, is_active');
      if (error) throw error;
      if (!data?.length) throw new Error('MENU_ITEM_NOT_UPDATED');
      setItems((prev) => prev.map((menuItem) => menuItem.id === item.id ? { ...menuItem, is_active: isActive } : menuItem));
      setNotice(t(isActive ? 'admin.itemShown' : 'admin.itemHidden'));
    } catch (error: unknown) {
      setErr(t(parseKvError(error).key));
    } finally {
      setVisibilityBusyId(null);
    }
  }

  function openNew() {
    const first = cats[0]?.id;
    if (first) {
      const next = emptyDraft(first);
      originalDraft.current = next;
      setDraft(next);
      setErr(null);
      setImageError(null);
    }
  }

  function openEdit(item: MenuItem) {
    const next: Draft = {
      id: item.id,
      category_id: item.category_id,
      name_en: item.name_en,
      name_kn: item.name_kn,
      description_en: item.description_en ?? '',
      description_kn: item.description_kn ?? '',
      // PostgREST returns numeric columns as JSON numbers; the draft feeds text
      // inputs, so normalize to a string at this boundary.
      price: item.price === null || item.price === undefined ? '' : String(item.price),
      original_price: item.original_price === null || item.original_price === undefined ? '' : String(item.original_price),
      is_available: item.is_available,
      is_active: item.is_active,
      is_featured: item.is_featured,
      is_vegetarian: item.is_vegetarian,
      image_file: null,
      image_path: item.image_path,
    };
    originalDraft.current = next;
    setDraft(next);
    setErr(null);
    setImageError(null);
  }

  function closeEditor() {
    if (busy) return;
    const original = originalDraft.current;
    const changed = draft && original && JSON.stringify({ ...draft, image_file: draft.image_file?.name ?? null }) !== JSON.stringify({ ...original, image_file: null });
    if (changed && !window.confirm(t('admin.discardChanges'))) return;
    setDraft(null);
    originalDraft.current = null;
    setErr(null);
    setImageError(null);
  }

  function chooseImage(file: File | undefined) {
    if (!file || !draft) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setImageError(t('admin.imageTypeError')); return; }
    if (file.size > 5 * 1024 * 1024) { setImageError(t('admin.imageSizeError')); return; }
    setImageError(null);
    setDraft({ ...draft, image_file: file });
  }

  async function save() {
    if (!draft || busy) return;
    const validation = validateMenuPrice(draft);
    if (validation) { setErr(t(`admin.menuValidation.${validation}`)); return; }
    setBusy(true);
    setErr(null);
    setImageError(null);
    try {
      let image_path = draft.image_path;
      if (draft.image_file) {
        if (draft.image_file.size > 5 * 1024 * 1024) throw new Error('IMAGE_SIZE');
        setImageUploading(true);
        const ext = draft.image_file.type === 'image/jpeg' ? 'jpg' : draft.image_file.type.split('/')[1];
        const path = `menu/${draft.id ?? crypto.randomUUID()}-${Date.now()}.${ext}`;
        const up = await supabase.storage.from('food-images').upload(path, draft.image_file, { upsert: false, contentType: draft.image_file.type });
        if (up.error) throw up.error;
        image_path = path;
        setImageUploading(false);
      }
      const row = {
        category_id: draft.category_id,
        name_en: draft.name_en.trim(),
        name_kn: draft.name_kn.trim() || draft.name_en.trim(),
        description_en: draft.description_en.trim() || null,
        description_kn: draft.description_kn.trim() || null,
        price: menuPriceNumber(draft.price),
        original_price: draft.original_price.trim() ? menuPriceNumber(draft.original_price) : null,
        is_available: draft.is_available,
        is_active: draft.is_active,
        is_featured: draft.is_featured,
        is_vegetarian: draft.is_vegetarian,
        image_path,
      };
      const res = draft.id
        ? await supabase.from('menu_items').update(row).eq('id', draft.id).select()
        : await supabase.from('menu_items').insert(row).select();
      if (res.error) throw res.error;
      setNotice(t('admin.itemSaved'));
      setDraft(null);
      originalDraft.current = null;
      setAttempt((value) => value + 1);
    } catch (e) {
      const kv = parseKvError(e);
      const msg = e instanceof Error && e.message === 'IMAGE_TYPE' ? t('admin.imageTypeError')
        : e instanceof Error && e.message === 'IMAGE_SIZE' ? t('admin.imageSizeError')
        : t(kv.key);
      setErr(msg);
    } finally {
      setBusy(false);
      setImageUploading(false);
    }
  }

  if (loading) return <Spinner label={t('common.loading')} />;
  if (loadError) return <ErrorState message={t(loadError)} onRetry={() => setAttempt((value) => value + 1)} />;
  if (cats.length === 0) {
    return (
      <div className="card p-4 text-sm text-brand-subtle">
        <p>{t('menu.emptyCategory')}</p>
        <button type="button" className="btn-secondary mt-3" onClick={() => setAttempt((value) => value + 1)}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <button type="button" className="btn-primary w-fit" onClick={openNew}><Plus size={16} aria-hidden="true" /> {t('admin.addMenuItem')}</button>
      {notice && <p className="text-xs text-brand-success" role="status">{notice}</p>}
      {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}

      {items.length === 0 && <p className="card p-4 text-sm text-brand-subtle">{t('menu.emptyCategory')}</p>}
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="card flex min-w-0 flex-wrap items-center gap-3 p-3">
            <button type="button" className="btn-secondary h-11 w-11 shrink-0 p-0" onClick={() => openEdit(item)} aria-label={`${t('admin.editItem')}: ${item.name_en}`}>
              <Pencil size={16} aria-hidden="true" />
            </button>
            {publicImageUrl(item.image_path) ? <img src={publicImageUrl(item.image_path)!} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-bg text-brand-subtle"><Utensils size={18} /></span>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{item.name_en}</p>
              <p className="truncate text-xs text-brand-subtle">{formatRupee(rupeesToPaise(item.price))} · {cats.find((c) => c.id === item.category_id)?.name_en ?? '—'}</p>
              <p className="text-xs font-semibold" aria-label={t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}>
                {item.is_vegetarian ? '🟢' : '🔴'} {t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={item.is_active}
                title={t(item.is_active ? 'admin.hideFromMenu' : 'admin.showInMenu')}
                className={`grid h-11 w-11 place-items-center rounded-xl border ${item.is_active ? 'border-brand-success/30 bg-brand-successBg text-brand-success' : 'border-brand-border bg-white text-brand-subtle'}`}
                disabled={visibilityBusyId !== null}
                onClick={() => void toggleCustomerVisibility(item)}
                aria-label={`${item.name_en}: ${t(item.is_active ? 'admin.hideFromMenu' : 'admin.showInMenu')}`}
              >
                {item.is_active ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!draft} onClose={closeEditor} title={draft?.id ? t('admin.editItem') : t('admin.addMenuItem')} desktopDialog headerIcon={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-primary/10 text-brand-primary"><Utensils size={18} aria-hidden="true" /></span>}>
        {draft && (
          <div className="grid gap-4 pb-3 lg:grid-cols-[minmax(0,1fr)_250px]" aria-busy={busy}>
            <div className="grid content-start gap-4">
              <section className="grid gap-3 rounded-2xl border border-brand-border bg-brand-bg/50 p-3" aria-labelledby="me-identity-heading">
                <h3 id="me-identity-heading" className="text-sm font-bold">{t('admin.itemIdentity')}</h3>
                <div className="flex items-center gap-3">
                  {previewUrl || publicImageUrl(draft.image_path) ? <img src={previewUrl ?? publicImageUrl(draft.image_path) ?? ''} alt={t('admin.imagePreview')} className="h-20 w-20 rounded-2xl border border-brand-border object-cover" /> : <span className="grid h-20 w-20 place-items-center rounded-2xl border border-dashed border-brand-border bg-white text-brand-subtle"><ImagePlus size={22} /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-brand-subtle">{t('admin.imageLimit')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary min-h-[42px] px-3 text-sm" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> {t('admin.uploadImage')}</button>
                      {(previewUrl || draft.image_path) && <button type="button" className="btn-ghost min-h-[42px] px-3 text-sm" onClick={() => { setDraft({ ...draft, image_file: null, image_path: null }); if (fileRef.current) fileRef.current.value = ''; }} disabled={busy}>{t('common.remove')}</button>}
                    </div>
                  </div>
                  <input ref={fileRef} id="me-img" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => chooseImage(e.target.files?.[0])} />
                </div>
                {imageError && <p className="text-xs text-brand-error" role="alert">{imageError}</p>}
                {imageUploading && <p className="text-xs text-brand-primary" role="status">{t('admin.uploading')}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label" htmlFor="me-name-en">{t('admin.nameEn')} <span className="text-brand-error">*</span></label><input id="me-name-en" className="input" required maxLength={80} value={draft.name_en} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} /></div>
                  <div><label className="label" htmlFor="me-name-kn">{t('admin.nameKn')}</label><input id="me-name-kn" className="input" lang="kn" maxLength={80} value={draft.name_kn} onChange={(e) => setDraft({ ...draft, name_kn: e.target.value })} /></div>
                </div>
              </section>

              <section className="grid gap-3 rounded-2xl border border-brand-border p-3" aria-labelledby="me-pricing-heading">
                <h3 id="me-pricing-heading" className="text-sm font-bold">{t('admin.pricing')}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label" htmlFor="me-price">{t('admin.price')} <span className="text-brand-error">*</span></label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-subtle">₹</span><input id="me-price" className="input tabular-nums pl-8" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></div></div>
                  <div><label className="label" htmlFor="me-orig">{t('admin.originalPrice')} <span className="font-normal text-brand-subtle">{t('common.optional')}</span></label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-subtle">₹</span><input id="me-orig" className="input tabular-nums pl-8" type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.original_price} onChange={(e) => setDraft({ ...draft, original_price: e.target.value })} /></div></div>
                </div>
                {discountPercent !== null && <p className="flex items-center gap-2 rounded-xl bg-brand-successBg px-3 py-2 text-sm font-semibold text-brand-success"><BadgeCheck size={17} /> {t('admin.discountPreview', { percent: discountPercent })} · {formatRupee(rupeesToPaise(draft.price))}</p>}
              </section>

              <section className="grid gap-3 rounded-2xl border border-brand-border p-3" aria-labelledby="me-category-heading">
                <h3 id="me-category-heading" className="text-sm font-bold">{t('admin.categoryDietary')}</h3>
                <div><label className="label" htmlFor="me-cat">{t('admin.category')}</label><select id="me-cat" className="input" value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name_en} / {c.name_kn}</option>)}</select></div>
                <fieldset><legend className="label">{t('admin.dietaryType')}</legend><div className="grid grid-cols-2 gap-2">
                  <button type="button" aria-pressed={draft.is_vegetarian} onClick={() => setDraft({ ...draft, is_vegetarian: true })} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${draft.is_vegetarian ? 'border-brand-success bg-brand-successBg text-brand-success' : 'border-brand-border bg-white'}`}><Leaf size={17} /> {t('admin.vegetarian')}</button>
                  <button type="button" aria-pressed={!draft.is_vegetarian} onClick={() => setDraft({ ...draft, is_vegetarian: false })} className={`flex min-h-[52px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${!draft.is_vegetarian ? 'border-brand-error bg-brand-errorBg text-brand-error' : 'border-brand-border bg-white'}`}><Utensils size={17} /> {t('admin.nonVegetarian')}</button>
                </div></fieldset>
              </section>

              <section className="grid gap-3 rounded-2xl border border-brand-border p-3" aria-labelledby="me-description-heading">
                <h3 id="me-description-heading" className="text-sm font-bold">{t('admin.description')}</h3>
                <div><label className="label" htmlFor="me-desc-en">{t('admin.descEn')}</label><textarea id="me-desc-en" className="input min-h-20" maxLength={250} value={draft.description_en} onChange={(e) => setDraft({ ...draft, description_en: e.target.value })} /><p className="mt-1 text-right text-xs text-brand-subtle">{draft.description_en.length}/250</p></div>
                <div><label className="label" htmlFor="me-desc-kn">{t('admin.descKn')}</label><textarea id="me-desc-kn" className="input min-h-20" lang="kn" maxLength={250} value={draft.description_kn} onChange={(e) => setDraft({ ...draft, description_kn: e.target.value })} /><p className="mt-1 text-right text-xs text-brand-subtle">{draft.description_kn.length}/250</p></div>
              </section>

              <section className="grid gap-2 rounded-2xl border border-brand-border p-3" aria-labelledby="me-status-heading">
                <h3 id="me-status-heading" className="text-sm font-bold">{t('admin.availabilityVisibility')}</h3>
                <p className="text-xs text-brand-subtle">{t('admin.availabilityHelp')}</p>
                {([
                  ['is_available', 'admin.available', 'admin.availableHelp'],
                  ['is_active', 'admin.active', 'admin.activeHelp'],
                  ['is_featured', 'admin.featured', 'admin.featuredHelp'],
                ] as const).map(([field, labelKey, helpKey]) => (
                  <label key={field} className="flex min-h-[48px] items-center gap-3 rounded-xl border border-brand-border bg-white px-3 py-2">
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t(labelKey)}</span><span className="block text-xs text-brand-subtle">{t(helpKey)}</span></span>
                    <input type="checkbox" role="switch" aria-label={t(labelKey)} checked={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.checked })} className="h-5 w-5 accent-[#C83E24]" />
                  </label>
                ))}
                {draft.is_featured && !draft.is_available && <p className="text-xs text-brand-warn" role="status">{t('admin.featuredUnavailableHint')}</p>}
              </section>

              {err && <p className="text-sm text-brand-error" role="alert">{err}</p>}
            </div>

            <aside className="grid content-start gap-2 rounded-2xl border border-brand-border bg-brand-bg/70 p-3" aria-label={t('admin.livePreview')}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-bold">{t('admin.livePreview')}</h3><span className="badge bg-white text-brand-subtle">{t('admin.preview')}</span></div>
              <article className="overflow-hidden rounded-2xl border border-brand-border bg-white shadow-soft">
                {previewUrl || publicImageUrl(draft.image_path) ? <img src={previewUrl ?? publicImageUrl(draft.image_path) ?? ''} alt="" className="h-36 w-full object-cover" /> : <div className="grid h-36 place-items-center bg-brand-bg text-brand-subtle"><ImagePlus size={28} /></div>}
                <div className="grid gap-1.5 p-3">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="wrap-break-word text-sm font-bold">{draft.name_en || t('admin.previewName')}</p>{draft.name_kn && <p lang="kn" className="wrap-break-word text-xs text-brand-subtle">{draft.name_kn}</p>}</div>{discountPercent !== null && <span className="badge shrink-0 bg-brand-successBg text-brand-success">{discountPercent}%</span>}</div>
                  <div className="flex flex-wrap items-baseline gap-2"><span className="font-bold">{formatRupee(rupeesToPaise(draft.price))}</span>{discountPercent !== null && <span className="text-xs text-brand-subtle line-through">{formatRupee(rupeesToPaise(draft.original_price))}</span>}</div>
                  <span className={`flex items-center gap-1 text-xs font-semibold ${draft.is_vegetarian ? 'text-brand-success' : 'text-brand-error'}`}><span aria-hidden="true">{draft.is_vegetarian ? '🟢' : '🔴'}</span>{t(draft.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}</span>
                  {draft.is_featured && <span className="badge w-fit bg-brand-primary/10 text-brand-primary"><Star size={12} /> {t('admin.featured')}</span>}
                </div>
              </article>
              <p className="text-xs text-brand-subtle">{draft.is_available ? t('admin.available') : t('admin.unavailable')} · {draft.is_active ? t('admin.visible') : t('admin.hidden')}</p>
            </aside>

            <footer className="sticky bottom-0 z-10 -mx-4 col-span-full flex gap-2 border-t border-brand-border bg-white/95 px-4 py-3 shadow-elev2 backdrop-blur">
              <button type="button" className="btn-secondary flex-1" onClick={closeEditor} disabled={busy}>{t('common.cancel')}</button>
              <button type="button" className="btn-primary flex-1" onClick={() => void save()} disabled={busy} aria-busy={busy}>{busy ? t('admin.saving') : <><Save size={16} /> {t('admin.saveChanges')}</>}</button>
            </footer>
          </div>
        )}
      </Sheet>
    </div>
  );
}
