import type { MenuItem } from '@/types/db';
import { useLanguage } from '@/context/LanguageContext';
import { useCart } from '@/context/CartContext';
import { formatRupee, rupeesToPaise } from '@/lib/money';
import { showSnackbar, Sheet } from './ui';
import { Leaf, ImageIcon, Minus, Plus, Star, Utensils } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { haptic } from '@/lib/haptics';

function FoodImage({ item, className }: { item: MenuItem; className: string }) {
  const url = item.image_path ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/food-images/${item.image_path}` : null;
  if (!url) {
    return (
      <div className={`${className} flex items-center justify-center bg-brand-secondary/10 text-brand-secondary`} aria-hidden="true">
        <ImageIcon size={24} aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      width={208}
      height={208}
      className={`${className} bg-brand-border/40 object-cover`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
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

/** Item detail sheet — full-bleed image, description, quantity and add-to-cart. */
export function ItemSheet({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const cart = useCart();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  if (!item) return null;
  const name = lang === 'kn' ? item.name_kn || item.name_en : item.name_en;
  const desc = lang === 'kn' ? item.description_kn || item.description_en : item.description_en;
  const paise = rupeesToPaise(item.price);

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
    <Sheet open={!!item} onClose={onClose} title={t('menu.details')}>
      <div className="grid gap-3">
        <div className="overflow-hidden rounded-2xl bg-brand-bg">
          <FoodImage item={item} className="h-52 w-full" />
        </div>
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug">{name}</h3>
          <span className="text-lg font-bold">{formatRupee(paise)}</span>
        </div>
        <p className={`flex items-center gap-1 text-xs font-semibold ${item.is_vegetarian ? 'text-brand-success' : 'text-brand-error'}`}>
          {item.is_vegetarian ? <Leaf size={13} aria-hidden="true" /> : <Utensils size={13} aria-hidden="true" />}
          {t(item.is_vegetarian ? 'admin.vegetarian' : 'admin.nonVegetarian')}
        </p>
        {desc && <p className="selectable text-sm leading-relaxed text-brand-subtle">{desc}</p>}
        {!item.is_available && (
          <span className="badge self-start bg-brand-errorBg text-brand-error">
            {t('menu.unavailable')} — {t('menu.soldOut')}
          </span>
        )}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-bg px-3 py-2">
          <span className="text-sm font-semibold">{t('cart.quantity')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="tap grid h-10 w-10 place-items-center rounded-full bg-white text-brand-primary shadow-elev1"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label={t('cart.qtyDecrease')}
            >
              <Minus size={17} aria-hidden="true" />
            </button>
            <span className="min-w-6 text-center text-base font-bold tabular-nums" aria-live="polite">{qty}</span>
            <button
              type="button"
              className="tap grid h-10 w-10 place-items-center rounded-full bg-white text-brand-primary shadow-elev1"
              onClick={() => setQty((q) => Math.min(50, q + 1))}
              aria-label={t('cart.qtyIncrease')}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <button type="button" className="btn-primary w-full text-base" disabled={!item.is_available} onClick={addToCart}>
          {t('menu.add')} · {formatRupee(paise * qty)}
        </button>
      </div>
    </Sheet>
  );
}
