import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/** Screen titles shown in the Android task switcher / WebView title bar. */
const TITLES: { test: RegExp; title: string }[] = [
  { test: /^\/$/, title: 'Krishna Vilas' },
  { test: /^\/cart/, title: 'Cart · Krishna Vilas' },
  { test: /^\/checkout/, title: 'Checkout · Krishna Vilas' },
  { test: /^\/orders/, title: 'My Orders · Krishna Vilas' },
  { test: /^\/order\//, title: 'Order · Krishna Vilas' },
  { test: /^\/account/, title: 'Account · Krishna Vilas' },
  { test: /^\/login/, title: 'Sign in · Krishna Vilas' },
  { test: /^\/admin/, title: 'Admin · Krishna Vilas' },
  { test: /^\/agent/, title: 'Delivery · Krishna Vilas' },
];

/**
 * Native-app navigation semantics: a new screen starts at the top (never
 * half-scrolled like a web page), updates the task title, and animates in.
 */
export function RouteEffects({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const match = TITLES.find((entry) => entry.test.test(location.pathname));
    if (match) document.title = match.title;
  }, [location.pathname]);

  return (
    <div key={location.pathname} className="page-enter">
      {children}
    </div>
  );
}
