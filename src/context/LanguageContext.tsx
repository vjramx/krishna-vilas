import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSavedLang, localeOf, saveLang, translate, type Dict } from '@/i18n';
import type { Lang } from '@/types/db';

interface LanguageValue {
  lang: Lang;
  locale: string;
  t: (key: keyof Dict | string, params?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadSavedLang());

  useEffect(() => {
    document.documentElement.lang = lang === 'kn' ? 'kn' : 'en';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  const value = useMemo<LanguageValue>(
    () => ({
      lang,
      locale: localeOf(lang),
      t: (key, params) => translate(lang, key as string, params),
      setLang,
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
