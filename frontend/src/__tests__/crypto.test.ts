import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  generatePasswords,
  generateUUID,
  generateSessionToken,
  secureCompare,
  toBase64,
  fromBase64,
  sanitizeInput,
  maskSensitive,
} from '../utils/crypto';

// ---------------------------------------------------------------------------
// generatePassword
// ---------------------------------------------------------------------------
describe('generatePassword', () => {
  it('generates password of default length (24)', () => {
    const pw = generatePassword();
    expect(pw.length).toBe(24);
  });

  it('generates password of custom length', () => {
    const pw = generatePassword(16);
    expect(pw.length).toBe(16);
  });

  it('includes uppercase when requested', () => {
    const pw = generatePassword(50, { uppercase: true, lowercase: false, numbers: false, symbols: false });
    expect(/[A-Z]/.test(pw)).toBe(true);
  });

  it('includes lowercase when requested', () => {
    const pw = generatePassword(50, { uppercase: false, lowercase: true, numbers: false, symbols: false });
    expect(/[a-z]/.test(pw)).toBe(true);
  });

  it('includes numbers when requested', () => {
    const pw = generatePassword(50, { uppercase: false, lowercase: false, numbers: true, symbols: false });
    expect(/[0-9]/.test(pw)).toBe(true);
  });

  it('includes symbols when requested', () => {
    const pw = generatePassword(50, { uppercase: false, lowercase: false, numbers: false, symbols: true });
    expect(/[^a-zA-Z0-9]/.test(pw)).toBe(true);
  });

  it('guarantees at least one char from each enabled set', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(12, { uppercase: true, lowercase: true, numbers: true, symbols: true });
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
      expect(/[^a-zA-Z0-9]/.test(pw)).toBe(true);
    }
  });

  it('excludes ambiguous characters when requested', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword(50, { excludeAmbiguous: true });
      expect(/[0OIl1|]/.test(pw)).toBe(false);
    }
  });

  it('falls back to lowercase+uppercase+numbers when no options enabled', () => {
    const pw = generatePassword(50, {
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: false,
    });
    expect(pw.length).toBe(50);
    expect(/[a-zA-Z0-9]/.test(pw)).toBe(true);
  });

  it('handles minimum length less than guaranteed count', () => {
    const pw = generatePassword(2, { uppercase: true, lowercase: true, numbers: true, symbols: true });
    expect(pw.length).toBeGreaterThanOrEqual(4);
  });

  it('generates unique passwords across calls', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 100; i++) {
      passwords.add(generatePassword());
    }
    expect(passwords.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// generatePasswords
// ---------------------------------------------------------------------------
describe('generatePasswords', () => {
  it('generates requested count', () => {
    const passwords = generatePasswords(5);
    expect(passwords.length).toBe(5);
  });

  it('generates unique passwords', () => {
    const passwords = generatePasswords(10);
    expect(new Set(passwords).size).toBe(10);
  });

  it('generates with custom length', () => {
    const passwords = generatePasswords(3, 32);
    expect(passwords.every((pw) => pw.length === 32)).toBe(true);
  });

  it('handles count of 1', () => {
    const passwords = generatePasswords(1);
    expect(passwords.length).toBe(1);
  });

  it('handles count of 0', () => {
    const passwords = generatePasswords(0);
    expect(passwords.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateUUID
// ---------------------------------------------------------------------------
describe('generateUUID', () => {
  it('generates valid UUID v4 format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique UUIDs', () => {
    const uuids = new Set(Array.from({ length: 50 }, () => generateUUID()));
    expect(uuids.size).toBe(50);
  });

  it('has correct length (36 chars with hyphens)', () => {
    expect(generateUUID().length).toBe(36);
  });

  it('has version 4 marker', () => {
    const uuid = generateUUID();
    expect(uuid[14]).toBe('4');
  });

  it('has valid variant bits', () => {
    const uuid = generateUUID();
    const variant = parseInt(uuid[19], 16);
    expect(variant >= 8 && variant <= 11).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSessionToken
// ---------------------------------------------------------------------------
describe('generateSessionToken', () => {
  it('generates hex string', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('generates 64-char token (32 bytes in hex)', () => {
    const token = generateSessionToken();
    expect(token.length).toBe(64);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateSessionToken()));
    expect(tokens.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// secureCompare
// ---------------------------------------------------------------------------
describe('secureCompare', () => {
  it('returns true for identical strings', () => {
    expect(secureCompare('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(secureCompare('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(secureCompare('abc', 'ab')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(secureCompare('', '')).toBe(true);
  });

  it('returns false for empty vs non-empty', () => {
    expect(secureCompare('', 'a')).toBe(false);
  });

  it('handles long identical strings', () => {
    const long = 'a'.repeat(10000);
    expect(secureCompare(long, long)).toBe(true);
  });

  it('handles unicode', () => {
    expect(secureCompare('héllo', 'héllo')).toBe(true);
    expect(secureCompare('héllo', 'hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toBase64 / fromBase64
// ---------------------------------------------------------------------------
describe('toBase64 / fromBase64', () => {
  it('round-trips ASCII string', () => {
    expect(fromBase64(toBase64('hello world'))).toBe('hello world');
  });

  it('round-trips empty string', () => {
    expect(fromBase64(toBase64(''))).toBe('');
  });

  it('round-trips unicode', () => {
    expect(fromBase64(toBase64('héllo wörld 日本語'))).toBe('héllo wörld 日本語');
  });

  it('round-trips special characters', () => {
    const special = '<script>alert("xss")</script>';
    expect(fromBase64(toBase64(special))).toBe(special);
  });

  it('produces valid base64 output', () => {
    const encoded = toBase64('test');
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ---------------------------------------------------------------------------
// sanitizeInput
// ---------------------------------------------------------------------------
describe('sanitizeInput', () => {
  it('returns empty for falsy input', () => {
    expect(sanitizeInput('')).toBe('');
    expect(sanitizeInput(null as unknown as string)).toBe('');
  });

  it('escapes ampersand', () => {
    expect(sanitizeInput('a&b')).toBe('a&amp;b');
  });

  it('escapes angle brackets', () => {
    expect(sanitizeInput('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes double quotes', () => {
    expect(sanitizeInput('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(sanitizeInput("it's")).toBe("it&#x27;s");
  });

  it('escapes backticks', () => {
    expect(sanitizeInput('`code`')).toBe('&#96;code&#96;');
  });

  it('escapes forward slashes', () => {
    expect(sanitizeInput('a/b')).toBe('a&#x2F;b');
  });

  it('prevents XSS script injection', () => {
    const xss = '<script>alert("xss")</script>';
    const sanitized = sanitizeInput(xss);
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('</script>');
  });

  it('leaves alphanumeric content unchanged', () => {
    expect(sanitizeInput('Hello World 123')).toBe('Hello World 123');
  });

  it('handles mixed dangerous characters', () => {
    const input = '<img src="x" onerror=`alert(1)`>';
    const result = sanitizeInput(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
    expect(result).not.toContain('`');
  });
});

// ---------------------------------------------------------------------------
// maskSensitive
// ---------------------------------------------------------------------------
describe('maskSensitive', () => {
  it('masks password fields', () => {
    const result = maskSensitive({ password: 'mysecret' });
    expect(result.password).not.toBe('mysecret');
    expect(result.password).toMatch(/^my•+/);
  });

  it('masks token fields', () => {
    const result = maskSensitive({ auth_token: 'abc123def' });
    expect(result.auth_token).not.toBe('abc123def');
  });

  it('masks api_key fields', () => {
    const result = maskSensitive({ api_key: 'key-12345' });
    expect(result.api_key).not.toBe('key-12345');
  });

  it('leaves non-sensitive fields unchanged', () => {
    const result = maskSensitive({ hostname: 'example.com', password: 'secret' });
    expect(result.hostname).toBe('example.com');
  });

  it('recursively masks nested objects', () => {
    const result = maskSensitive({
      db: { host: 'localhost', password: 'dbpass' },
    });
    expect(result.db.host).toBe('localhost');
    expect(result.db.password).not.toBe('dbpass');
  });

  it('handles arrays of objects', () => {
    const result = maskSensitive({
      users: [{ name: 'alice', password: 'pw1' }],
    });
    expect(result.users[0].name).toBe('alice');
    expect(result.users[0].password).not.toBe('pw1');
  });

  it('shows [REDACTED] for non-string sensitive values', () => {
    const result = maskSensitive({ secret: 42 });
    expect(result.secret).toBe('[REDACTED]');
  });

  it('preserves null sensitive values', () => {
    const result = maskSensitive({ password: null });
    expect(result.password).toBeNull();
  });

  it('accepts custom sensitive keys', () => {
    const result = maskSensitive(
      { name: 'visible', internal_code: 'hidden' },
      ['internal_code'],
    );
    expect(result.name).toBe('visible');
    expect(result.internal_code).not.toBe('hidden');
  });

  it('uses partial masking (first 2 chars visible)', () => {
    const result = maskSensitive({ password: 'mysecretpassword' });
    expect(result.password.startsWith('my')).toBe(true);
    expect(result.password).toContain('•');
  });
});
