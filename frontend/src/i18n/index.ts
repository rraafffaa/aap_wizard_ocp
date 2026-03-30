import { useState, useEffect, useMemo } from 'react';
import { en } from './en';
import { ja } from './ja';

export type Locale = 'en' | 'ja' | 'ko' | 'zh' | 'es';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  es: 'Español',
};

export const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'aap_wizard_locale';

type TranslationDict = Record<string, string>;

const translations: Record<Locale, TranslationDict> = {
  en,
  ja,
  ko: en, // Fallback to English for now
  zh: en, // Fallback to English for now
  es: en, // Fallback to English for now
};

function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale;
    if (stored && Object.keys(LOCALE_LABELS).includes(stored)) {
      return stored;
    }
  } catch {
    // localStorage may not be available
  }
  return DEFAULT_LOCALE;
}

function setStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage may not be available
  }
}

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  useEffect(() => {
    setStoredLocale(locale);
  }, [locale]);

  const t = useMemo(() => {
    return (key: string, params?: Record<string, string>): string => {
      let text = translations[locale]?.[key] || translations[DEFAULT_LOCALE]?.[key] || key;

      // Replace {param} placeholders with values
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        });
      }

      return text;
    };
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
  };

  const locales = useMemo(() => {
    return Object.entries(LOCALE_LABELS).map(([code, label]) => ({
      code: code as Locale,
      label,
    }));
  }, []);

  return { t, locale, setLocale, locales };
}
