import { useState, useEffect, useCallback, useMemo } from 'react';

export type Theme = 'dark' | 'light' | 'high-contrast' | 'system';

export interface ThemeContext {
  theme: Theme;
  resolvedTheme: 'dark' | 'light' | 'high-contrast';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = 'aap-wizard-theme';
const THEME_CLASS_PREFIX = 'pf-v5-theme-';
const VALID_THEMES: Theme[] = ['dark', 'light', 'high-contrast', 'system'];

function getSystemPreference(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

function resolveTheme(theme: Theme): 'dark' | 'light' | 'high-contrast' {
  if (theme === 'system') return getSystemPreference();
  return theme;
}

function applyThemeToDOM(resolved: 'dark' | 'light' | 'high-contrast'): void {
  const root = document.documentElement;

  root.classList.remove(
    `${THEME_CLASS_PREFIX}dark`,
    `${THEME_CLASS_PREFIX}light`,
    `${THEME_CLASS_PREFIX}high-contrast`,
    'pf-v5-theme-dark',
  );

  root.setAttribute('data-theme', resolved);

  if (resolved === 'dark') {
    root.classList.add('pf-v5-theme-dark');
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const colors: Record<string, string> = {
      dark: '#1b1d21',
      light: '#ffffff',
      'high-contrast': '#000000',
    };
    metaThemeColor.setAttribute('content', colors[resolved]);
  }
}

export function useTheme(): ThemeContext {
  const [theme, setThemeState] = useState<Theme>(loadStoredTheme);
  const [systemPref, setSystemPref] = useState<'dark' | 'light'>(getSystemPreference);

  const resolvedTheme = useMemo(
    (): 'dark' | 'light' | 'high-contrast' => {
      if (theme === 'system') return systemPref;
      return theme;
    },
    [theme, systemPref],
  );

  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      setSystemPref(e.matches ? 'dark' : 'light');
    };

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    persistTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const resolved = resolveTheme(current);
      const next: Theme = resolved === 'dark' ? 'light' : 'dark';
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
