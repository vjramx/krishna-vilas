import type { MenuItem } from '@/types/db';
import { useLanguage } from '@/context/LanguageContext';
import { useCart } from '@/context/CartContext';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { showSnackbar, Sheet } from './ui';
import { Leaf, ImageIcon, Minus, Plus, Star, Utensils } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { haptic } from '@/lib/haptics';

function FoodImage({ item, className, iconSize = 24, alt = '' }: { item: MenuItem; className: string; iconSize?: number; /** Meaningful alt for the detail hero; tiles keep it decorative. */ alt?: string }) {
  // Broken/missing photos must collapse into a clean placeholder instead of a
  // blank tile: the error state lives beside the fetch state, per instance.
  const url = item.image_path ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/food-images/${item.image_path}` : null;
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className={`${className} flex items-center justify-center bg-brand-secondary/10 text-brand-secondary`} aria-hidden="true">
        <ImageIcon size={iconSize} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${className} bg-brand-border/40 object-cover`}
      onError={() => setBroken(true)}
    />
  );
}

/** Compact in-tile stepper sized for the image overlay (still 40dp tall). */
function TileStepper({ qty, onChange }: { qty: number; onChange: (n: number) => void }) {
  const { t } = useLanguage();
  const press = (n: number) => {
    haptic(5);
    onChange(n);
  };
  return (
    <div className="flex h-9 items-center rounded-lg border border-brand-primary/30 bg-white shadow-elev1">
      <button
        type="button"
        className="tap grid h-full w-8 place-items-center rounded-l-lg text-brand-primary active:bg-brand-primary/10"
        aria-label={t('cart.qtyDecrease')}
        onClick={(e) => {
          e.stopPropagation();
          press(qty - 1);
        }}
      >
        <Minus size={15} aria-hidden="true" />
      </button>
      <span aria-live="polite" className="min-w-[1.35rem] text-center text-sm font-bold tabular-nums text-brand-primary">
        {qty}
      </span>
      <button
        type="button"
        className="tap grid h-full w-8 place-items-center rounded-r-lg text-brand-primary active:bg-brand-primary/10"
        aria-label={t('cart.qtyIncrease')}
        onClick={(e) => {
          e.stopPropagation();
          press(qty + 1);
        }}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ItemCard({ item, onOpen }: { item: MenuItem; onOpen?: (item: MenuItem) => void }) {
  const { t, lang } = useLanguage();
  const cart = useCart();
  const navigate = useNavigate();
  const qty = cart.quantityOf(item.id);
  const available = item.is_available && item.is_active;
  const name = lang === 'kn' ? item.name_kn || item.name_en : item.name_en;
  const desc = lang === 'kn' ? item.description_kn || item.description_en : item.description_en;
  const paise = rupeesToPaise(item.price);
  const orig = item.original_price ? rupeesToPaise(item.original_price) : 0;

  const add = () => {
    haptic();
    cart.add(item);
    showSnackbar(t('cart.addedToCart', { name }), {
      label: t('cart.viewCart'),
      onAction: () => navigate('/cart'),
    });
  };

  return (
    <div className={`card relative flex min-w-0 gap-3 overflow-hidden p-3 ${!available ? 'opacity-70' : ''}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${item.is_vegetarian ? 'border-brand-success/40 bg-brand-successBg text-brand-success' : 'border-brand-error/30 bg-brand-errorBg text-brand-error'}`}
            aria-label={t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
          >
            {item.is_vegetarian ? <Leaf size={11} aria-hidden="true" /> : <Utensils size={11} aria-hidden="true" />}
            {t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
          </span>
          {item.is_featured && (
            <span className="badge gap-0.5 bg-brand-primary/10 px-1.5 py-0 text-[10px] text-brand-primary">
              <Star size={10} className="fill-brand-primary" aria-hidden="true" /> {t('menu.featured')}
            </span>
          )}
        </div>

        <button
          type="button"
          className="mt-1 min-w-0 text-left"
          aria-haspopup={onOpen ? 'dialog' : undefined}
          aria-label={onOpen ? `${t('menu.details')}: ${name}` : name}
          onClick={() => onOpen?.(item)}
        >
          <h3 className="wrap-break-word text-[15px] font-bold leading-snug text-brand-text">{name}</h3>
        </button>

        {desc && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-brand-subtle">{desc}</p>}

        <div className="mt-auto flex flex-wrap items-baseline gap-1.5 pt-1.5">
          <span className="text-[15px] font-bold text-brand-text">{formatRupee(paise)}</span>
          {orig > paise && (
            <span className="text-xs text-brand-subtle line-through">{formatRupee(orig)}</span>
          )}
          {!available && <span className="badge bg-brand-errorBg py-0.5 text-brand-error">{t('menu.soldOut')}</span>}
        </div>
      </div>

      <div className="relative shrink-0 self-start">
        <button
          type="button"
          className="block h-[104px] w-[104px] overflow-hidden rounded-2xl"
          aria-label={onOpen ? `${t('menu.details')}: ${name}` : name}
          onClick={() => onOpen?.(item)}
        >
          <FoodImage item={item} className="h-[104px] w-[104px]" />
        </button>
        {available && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
            {qty > 0 ? (
              <TileStepper qty={qty} onChange={(n) => cart.setQuantity(item.id, n)} />
            ) : (
              <button
                type="button"
                className="tap min-h-[34px] rounded-lg border border-brand-primary/30 bg-white px-4 text-[13px] font-extrabold uppercase tracking-wide text-brand-primary shadow-elev1 active:bg-brand-bg"
                onClick={add}
              >
                {t('menu.add')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * True width of the surface in CSS pixels. Some Android WebViews render a
 * wide (desktop-style) layout viewport (~980px) even on a narrow phone, which
 * would fire viewport media queries regardless of the real hardware width.
 * The visual viewport scale < 1 reveals that case: layout width × scale
 * recovers the honest device width, so we key the layout off it.
 */
function trueViewportWidth(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  const inner = window.innerWidth;
  if (!vv) return inner;
  return Math.round(vv.width * (vv.scale || 1)) || inner;
}

function computeLayoutMode(): 'narrow' | 'wide' {
  if (typeof window === 'undefined') return 'narrow';
  return window.innerWidth <= 600 || trueViewportWidth() <= 600 ? 'narrow' : 'wide';
}

/** Item-sheet layout is decided by the *actual surface width* — not media
 * queries — so a mis-reporting Android WebView still gets the vertical
 * layout. Re-evaluates on resize/rotation. */
function useLayoutMode(): 'narrow' | 'wide' {
  const [mode, setMode] = useState<'narrow' | 'wide'>(computeLayoutMode);
  useEffect(() => {
    const update = () => setMode(computeLayoutMode());
    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return mode;
}

/**
 * Item detail: a **bottom sheet** anchored to the bottom of the viewport —
 * the scrim dims the whole app (header, menu and tab bar included) while the
 * panel springs up from the bottom edge, capped below the full viewport so
 * the underlying menu stays visible and does not jump. Below/at 600 CSS px
 * (phones, zoomed-out WebViews) it is forced to a single column: image on
 * top, badge → name/price → description underneath, pinned action bar last.
 * Only genuinely wide surfaces get the two-column layout. The action bar
 * stays pinned above the safe-area inset; content scrolls independently when
 * it overflows.
 */
export function ItemSheet({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const cart = useCart();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const wide = useLayoutMode() === 'wide';
  if (!item) return null;
  const name = lang === 'kn' ? item.name_kn || item.name_en : item.name_en;
  const desc = lang === 'kn' ? item.description_kn || item.description_en : item.description_en;
  const paise = rupeesToPaise(item.price);
  const orig = item.original_price ? rupeesToPaise(item.original_price) : 0;
  const discountPct = orig > paise && orig > 0 ? Math.round(((orig - paise) / orig) * 100) : 0;

  const addToCart = () => {
    haptic();
    for (let i = 0; i < qty; i++) cart.add(item);
    onClose();
    showSnackbar(t('cart.addedToCart', { name }), {
      label: t('cart.viewCart'),
      onAction: () => navigate('/cart'),
    });
  };

  return (
    <Sheet open={!!item} onClose={onClose} title={`${t('menu.details')}: ${name}`} bottomSheet>
      {/* Content area: hugs the content on phones (max-h caps at the band;
              long descriptions scroll inside, the bar stays pinned) and fills
              the band on wide surfaces. Vertical order is fixed on phones:
              image → badge → name/price → description → action bar. */}
      <div
        className={
          wide
            ? 'app-scroll flex min-h-0 flex-1 overflow-hidden'
            : 'app-scroll flex min-h-0 flex-1 flex-col overflow-y-auto'
        }
      >
        {/* Image: ~40% of the band on phones — fixed height (no elastic
            growth, so no white void appears), full column height on wide
            screens. */}
        <div
          className={
            wide
              ? 'relative w-[44%] flex-none min-h-0'
              : 'relative w-full min-w-0 h-[38dvh] min-h-[190px] shrink-0'
          }
        >
          <FoodImage item={item} className="absolute inset-0 h-full w-full" iconSize={48} alt={name} />
          {!item.image_path && (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-secondary/5 to-brand-secondary/10" aria-hidden="true" />
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent" aria-hidden="true" />
          {!item.is_available && (
            <span className="absolute bottom-3 left-3 rounded-xl bg-black/65 px-3 py-1.5 text-sm font-bold text-white backdrop-blur">
              {t('menu.soldOut')}
            </span>
          )}
        </div>

        {/* Details: veg/non-veg badge, name, price, full description — the
            exact vertical order the phones must show. On wide surfaces the
            column scrolls on its own and the text stays at a readable
            measure. */}
        <div
          className={
            wide
              ? 'min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pb-6 pt-6'
              : 'w-full min-w-0 px-4 pb-4 pt-4'
          }
        >
          <div className={wide ? 'mx-auto w-full max-w-[640px]' : undefined}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${item.is_vegetarian ? 'border-brand-success/40 bg-brand-successBg text-brand-success' : 'border-brand-error/30 bg-brand-errorBg text-brand-error'}`}
                aria-label={t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
              >
                {item.is_vegetarian ? <Leaf size={12} aria-hidden="true" /> : <Utensils size={12} aria-hidden="true" />}
                {t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
              </span>
              {item.is_featured && (
                <span className="badge gap-1 bg-brand-primary/10 px-2 py-1 text-[11px] text-brand-primary">
                  <Star size={11} className="fill-brand-primary" aria-hidden="true" /> {t('menu.featured')}
                </span>
              )}
              {discountPct > 0 && (
                <span className="rounded-md bg-brand-primary px-2 py-1 text-[11px] font-bold text-white">{t('menu.discount', { pct: String(discountPct) })}</span>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <h3 className="wrap-break-word min-w-0 flex-1 text-xl font-extrabold leading-snug">{name}</h3>
              <div className="shrink-0 text-right">
                <p className="text-xl font-extrabold">{formatRupee(paise)}</p>
                {orig > paise && <p className="text-xs text-brand-subtle line-through">{formatRupee(orig)}</p>}
              </div>
            </div>
            {desc ? (
              <p className="selectable mt-3 text-[15px] leading-relaxed text-brand-text/90">{desc}</p>
            ) : (
              <p className="mt-3 text-sm italic text-brand-subtle">{t('menu.noDescription')}</p>
            )}
          </div>
        </div>
      </div>

      {/* ---- Pinned action bar: quantity + Add with the correct live total.
              Content scrolls under it; it never clips on short screens and
              respects the safe-area inset (from the parent panel). ---- */}
      <div className="shrink-0 border-t border-brand-border bg-white px-4 pb-1 pt-2.5">
        <div className={wide ? 'mx-auto flex w-full max-w-none items-center justify-between gap-3 px-6' : 'mx-auto flex w-full max-w-app items-center justify-between gap-3'}>
          <div className="flex items-center gap-2" role="group" aria-label={t('cart.quantity')}>
            <button
              type="button"
              className="tap grid h-11 w-11 place-items-center rounded-xl border border-brand-border text-brand-primary active:bg-brand-bg"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label={t('cart.qtyDecrease')}
            >
              <Minus size={17} aria-hidden="true" />
            </button>
            <span className="min-w-7 text-center text-base font-bold tabular-nums" aria-live="polite">{qty}</span>
            <button
              type="button"
              className="tap grid h-11 w-11 place-items-center rounded-xl border border-brand-border text-brand-primary active:bg-brand-bg"
              onClick={() => setQty((q) => Math.min(50, q + 1))}
              aria-label={t('cart.qtyIncrease')}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="btn-primary min-h-11 min-w-0 flex-1 text-base"
            disabled={!item.is_available}
            onClick={addToCart}
          >
            {item.is_available ? `${t('menu.add')} · ${formatRupee(paise * qty)}` : t('menu.soldOut')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
