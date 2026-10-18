import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { kn } from '@/i18n/kn';
import { translate, normalizeLang, loadSavedLang, saveLang } from '@/i18n';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('explicit language preference', () => {
  it('defaults to English even on a Kannada device', () => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('kn-IN');
    expect(loadSavedLang()).toBe('en');
  });
  it('restores Kannada only after it was explicitly saved', () => {
    saveLang('kn');
    expect(loadSavedLang()).toBe('kn');
    saveLang('en');
    expect(loadSavedLang()).toBe('en');
  });
  it('uses English for an invalid saved preference', () => {
    localStorage.setItem('kv-lang', 'kn-IN');
    expect(loadSavedLang()).toBe('en');
  });
});

describe('translation bundles', () => {
  it('Kannada mirrors every English key', () => {
    const enKeys = Object.keys(en).sort();
    const knKeys = Object.keys(kn).sort();
    expect(knKeys).toEqual(enKeys);
  });

  it('contains no empty strings in either bundle', () => {
    for (const [k, v] of Object.entries(en)) expect(String(v).length, `en:${k}`).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(kn)) expect(String(v).length, `kn:${k}`).toBeGreaterThan(0);
  });

  it('renders Kannada as Kannada script for key strings', () => {
    expect(kn['app.name']).toMatch(/ಕೃಷ್ಣ ವಿಲಾಸ್/);
    expect(kn['checkout.cod']).toMatch(/[\u0C80-\u0CEF]/);
    expect(kn['order.status.delivered']).toMatch(/[\u0C80-\u0CEF]/);
  });

  it('falls back to English when a Kannada key is missing', () => {
    const missing = 'zzz.fallback.only' as never;
    expect(translate('kn', missing)).toBe('zzz.fallback.only');
  });

  it('interpolates params', () => {
    expect(translate('en', 'checkout.minOrder', { amount: '50', more: '12' })).toContain('₹50');
    expect(translate('kn', 'checkout.minOrder', { amount: '50', more: '12' })).toContain('₹50');
  });

  it('normalizes languages', () => {
    expect(normalizeLang('kn-IN')).toBe('kn');
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });
});
