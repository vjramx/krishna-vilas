import type { Lang } from '@/types/db';
import { en } from './en';
import { kn } from './kn';

export type Dict = typeof en;

const bundles: Record<Lang, Dict> = { en, kn: kn as unknown as Dict };

const STORAGE_KEY = 'kv-lang';
const DEFAULT_LANG: Lang = 'en';

export function normalizeLang(l: string | null | undefined): Lang {
  if (l === undefined || l === null) return DEFAULT_LANG;
  if (l === 'kn' || /^kn\b/i.test(l)) return 'kn';
  if (l === 'en' || /^en\b/i.test(l)) return 'en';
  return DEFAULT_LANG;
}

export function loadSavedLang(): Lang {
  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    // Only an explicit saved settings choice enables Kannada, never the
    // device/browser locale (which may be Kannada on first launch).
    return fromStorage === 'kn' ? 'kn' : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode */
  }
}

/** t('checkout.minOrder', { amount: '50', more: '12' }) → interpolated string */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const bundle = bundles[lang];
  let text: string | undefined = bundle[key as keyof Dict];
  if (text === undefined) text = (en as Dict)[key as keyof Dict];
  if (text === undefined) return key;
  if (params) {
    for (const [p, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function localeOf(lang: Lang): string {
  return lang === 'kn' ? 'kn-IN' : 'en-IN';
}
