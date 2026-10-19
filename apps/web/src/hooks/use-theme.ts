import { useLayoutEffect, useState } from 'react';
export type Theme = 'light' | 'dark' | 'system';
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { try { const value = localStorage.getItem('orders-theme'); return value === 'light' || value === 'dark' ? value : 'system'; } catch { return 'system'; } });
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { const dark = theme === 'dark' || (theme === 'system' && media.matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#19191c' : '#f5f5f7'); };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('orders-theme', theme); } catch { /* Theme remains usable without storage. */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
