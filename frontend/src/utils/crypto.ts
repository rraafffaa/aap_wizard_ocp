const DEFAULT_PASSWORD_LENGTH = 24;

const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
} as const;

const AMBIGUOUS_CHARS = /[0OIl1|]/g;

const XSS_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#96;',
};

const DEFAULT_SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'key', 'credential', 'auth',
  'api_key', 'apiKey', 'private', 'ssh', 'cert',
];

function getRandomValues(length: number): Uint32Array {
  const values = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i++) {
      values[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  return values;
}

export function generatePassword(
  length: number = DEFAULT_PASSWORD_LENGTH,
  options: {
    uppercase?: boolean;
    lowercase?: boolean;
    numbers?: boolean;
    symbols?: boolean;
    excludeAmbiguous?: boolean;
  } = {},
): string {
  const {
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
    excludeAmbiguous = false,
  } = options;

  let charset = '';
  const guaranteed: string[] = [];

  if (uppercase) {
    charset += CHAR_SETS.uppercase;
    guaranteed.push(CHAR_SETS.uppercase);
  }
  if (lowercase) {
    charset += CHAR_SETS.lowercase;
    guaranteed.push(CHAR_SETS.lowercase);
  }
  if (numbers) {
    charset += CHAR_SETS.numbers;
    guaranteed.push(CHAR_SETS.numbers);
  }
  if (symbols) {
    charset += CHAR_SETS.symbols;
    guaranteed.push(CHAR_SETS.symbols);
  }

  if (charset.length === 0) {
    charset = CHAR_SETS.lowercase + CHAR_SETS.uppercase + CHAR_SETS.numbers;
    guaranteed.push(CHAR_SETS.lowercase, CHAR_SETS.uppercase, CHAR_SETS.numbers);
  }

  if (excludeAmbiguous) {
    charset = charset.replace(AMBIGUOUS_CHARS, '');
  }

  const actualLength = Math.max(length, guaranteed.length);
  const randomValues = getRandomValues(actualLength * 2);
  const chars: string[] = [];

  for (let i = 0; i < guaranteed.length; i++) {
    const set = excludeAmbiguous
      ? guaranteed[i].replace(AMBIGUOUS_CHARS, '')
      : guaranteed[i];
    if (set.length > 0) {
      chars.push(set[randomValues[i] % set.length]);
    }
  }

  let idx = guaranteed.length;
  while (chars.length < actualLength) {
    chars.push(charset[randomValues[idx] % charset.length]);
    idx++;
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomValues[guaranteed.length + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

export function generatePasswords(count: number, length?: number): string[] {
  const passwords = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 10;

  while (passwords.size < count && attempts < maxAttempts) {
    passwords.add(generatePassword(length));
    attempts++;
  }

  return Array.from(passwords);
}

export async function hashString(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = getRandomValues(4);
  const hex = Array.from(new Uint8Array(new Uint32Array(bytes).buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function generateSessionToken(): string {
  const values = getRandomValues(8);
  return Array.from(new Uint8Array(values.buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
    }
    void dummy;
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function toBase64(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16)),
      ),
    );
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export function fromBase64(str: string): string {
  if (typeof atob === 'function') {
    return decodeURIComponent(
      Array.from(atob(str))
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return new TextDecoder().decode(bytes);
}

export function sanitizeInput(input: string): string {
  if (!input) return '';
  return input.replace(/[&<>"'`/]/g, (char) => XSS_MAP[char] || char);
}

/** Shell injection / command injection dangerous chars for hostnames. */
const HOSTNAME_DANGEROUS = /[;$\`()|&*?\[\]\\'\"\n\r\t]/;

/**
 * Validates hostname for use in SSH/command contexts. Rejects dangerous chars.
 * @returns Error message if invalid, or null if valid.
 */
export function validateHostname(value: string): string | null {
  if (!value || typeof value !== 'string') return null;
  if (HOSTNAME_DANGEROUS.test(value)) {
    return 'Hostname contains invalid characters (e.g. ; $ ` ( ) | &). Use only letters, numbers, hyphens, and dots.';
  }
  return null;
}

export function maskSensitive(
  obj: Record<string, any>,
  sensitiveKeys?: string[],
): Record<string, any> {
  const keys = sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS;
  const masked: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = keys.some(
      (sk) => key.toLowerCase().includes(sk.toLowerCase()),
    );

    if (isSensitive) {
      if (typeof value === 'string' && value.length > 0) {
        masked[key] = value.slice(0, 2) + '•'.repeat(Math.max(value.length - 2, 4));
      } else if (value != null) {
        masked[key] = '[REDACTED]';
      } else {
        masked[key] = value;
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitive(value, keys);
    } else if (Array.isArray(value)) {
      masked[key] = value.map((item) =>
        item !== null && typeof item === 'object'
          ? maskSensitive(item, keys)
          : item,
      );
    } else {
      masked[key] = value;
    }
  }

  return masked;
}
