import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  const mm = window.matchMedia ?? (() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    media: '',
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, 'matchMedia', { value: mm, writable: true });
  if (!window.crypto?.randomUUID) {
    (window as unknown as { crypto: unknown }).crypto = {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    };
  }
}
