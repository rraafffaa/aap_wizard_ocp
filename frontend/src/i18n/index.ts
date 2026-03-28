import { en } from './en';

type Locale = 'en';

const locales: Record<string, Record<string, any>> = { en };
let currentLocale: Locale = 'en';

export function setLocale(locale: string): void {
  if (locales[locale]) {
    currentLocale = locale as Locale;
  }
}

export function getLocale(): string {
  return currentLocale;
}

function resolve(obj: Record<string, any>, key: string): string | undefined {
  const parts = key.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = locales[currentLocale] ?? locales.en;
  let value = resolve(dict, key);

  if (value === undefined) return key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value!.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return value!;
}

export { en } from './en';
