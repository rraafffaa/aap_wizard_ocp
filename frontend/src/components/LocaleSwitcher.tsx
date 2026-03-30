import React from 'react';
import { useI18n, type Locale } from '../i18n';

const LOCALE_FLAGS: Record<Locale, string> = {
  en: '🇺🇸',
  ja: '🇯🇵',
  ko: '🇰🇷',
  zh: '🇨🇳',
  es: '🇪🇸',
};

export function LocaleSwitcher() {
  const { locale, setLocale, locales } = useI18n();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocale(e.target.value as Locale);
  };

  return (
    <div className="aap-locale-switcher">
      <select
        value={locale}
        onChange={handleChange}
        className="aap-locale-switcher__select"
        aria-label="Select language"
      >
        {locales.map(({ code, label }) => (
          <option key={code} value={code}>
            {LOCALE_FLAGS[code]} {label}
          </option>
        ))}
      </select>
    </div>
  );
}
