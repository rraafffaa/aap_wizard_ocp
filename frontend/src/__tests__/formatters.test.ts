import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatTimestamp,
  formatRelativeTime,
  maskPassword,
  truncate,
  capitalize,
  slugify,
  formatPort,
  formatHostList,
  formatTopology,
  formatInstallationType,
  formatDatabaseType,
  formatPercentage,
  pluralize,
  generateId,
  deepClone,
  deepEqual,
  debounce,
  throttle,
} from '../utils/formatters';

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------
describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats fractional kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });

  it('formats terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1.0 TB');
  });

  it('handles negative bytes', () => {
    expect(formatBytes(-1024)).toBe('-1.0 KB');
  });

  it('respects decimal parameter', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB');
  });

  it('respects 0 decimals', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });

  it('handles very large values', () => {
    expect(formatBytes(5e15)).toMatch(/PB/);
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('formats 0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats sub-second', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats exactly 1 second', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(61000)).toBe('1m 1s');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(120000)).toBe('2m');
  });

  it('formats hours', () => {
    expect(formatDuration(3600000)).toBe('1h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3660000)).toBe('1h 1m');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
  });

  it('handles negative values', () => {
    expect(formatDuration(-5000)).toBe('-5s');
  });

  it('rounds sub-second correctly', () => {
    expect(formatDuration(999)).toBe('999ms');
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------
describe('formatTimestamp', () => {
  it('formats Date object', () => {
    const result = formatTimestamp(new Date('2025-06-15T10:30:00Z'));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats ISO string', () => {
    const result = formatTimestamp('2025-06-15T10:30:00Z');
    expect(typeof result).toBe('string');
  });

  it('formats epoch number', () => {
    const result = formatTimestamp(1718444400000);
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------
describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "just now" for recent times', () => {
    const recent = new Date('2025-06-15T11:59:55Z');
    expect(formatRelativeTime(recent)).toBe('just now');
  });

  it('shows seconds ago', () => {
    const past = new Date('2025-06-15T11:59:30Z');
    expect(formatRelativeTime(past)).toMatch(/\d+ seconds? ago/);
  });

  it('shows minutes ago', () => {
    const past = new Date('2025-06-15T11:55:00Z');
    expect(formatRelativeTime(past)).toMatch(/\d+ minutes? ago/);
  });

  it('shows future time', () => {
    const future = new Date('2025-06-15T12:05:00Z');
    expect(formatRelativeTime(future)).toMatch(/in \d+ minutes?/);
  });
});

// ---------------------------------------------------------------------------
// maskPassword
// ---------------------------------------------------------------------------
describe('maskPassword', () => {
  it('returns empty for empty string', () => {
    expect(maskPassword('')).toBe('');
  });

  it('masks with bullets of same length', () => {
    expect(maskPassword('secret')).toBe('••••••');
  });

  it('masks single character', () => {
    expect(maskPassword('x')).toBe('•');
  });

  it('handles null-ish', () => {
    expect(maskPassword(null as unknown as string)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------
describe('truncate', () => {
  it('returns unchanged string when under limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns unchanged string at exact limit', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles maxLength <= 3 (no ellipsis)', () => {
    expect(truncate('hello', 3)).toBe('hel');
  });

  it('handles maxLength of 1', () => {
    expect(truncate('hello', 1)).toBe('h');
  });

  it('returns empty for empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('returns falsy unchanged', () => {
    expect(truncate(null as unknown as string, 10)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// capitalize
// ---------------------------------------------------------------------------
describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('leaves already capitalized', () => {
    expect(capitalize('Hello')).toBe('Hello');
  });

  it('handles single character', () => {
    expect(capitalize('h')).toBe('H');
  });

  it('returns empty for empty string', () => {
    expect(capitalize('')).toBe('');
  });

  it('handles null-ish', () => {
    expect(capitalize(null as unknown as string)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('converts spaces to hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('a - - b')).toBe('a-b');
  });

  it('trims hyphens from edges', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });

  it('converts underscores to hyphens', () => {
    expect(slugify('hello_world')).toBe('hello-world');
  });

  it('lowercases everything', () => {
    expect(slugify('HELLO')).toBe('hello');
  });

  it('handles mixed separators', () => {
    expect(slugify('  foo  bar_baz  ')).toBe('foo-bar-baz');
  });
});

// ---------------------------------------------------------------------------
// formatPort
// ---------------------------------------------------------------------------
describe('formatPort', () => {
  it('labels HTTP port', () => {
    expect(formatPort(80)).toBe('80 (HTTP)');
  });

  it('labels HTTPS port', () => {
    expect(formatPort(443)).toBe('443 (HTTPS)');
  });

  it('labels SSH port', () => {
    expect(formatPort(22)).toBe('22 (SSH)');
  });

  it('labels PostgreSQL port', () => {
    expect(formatPort(5432)).toBe('5432 (PostgreSQL)');
  });

  it('labels Redis port', () => {
    expect(formatPort(6379)).toBe('6379 (Redis)');
  });

  it('labels Receptor port', () => {
    expect(formatPort(27199)).toBe('27199 (Receptor)');
  });

  it('returns plain number for unknown port', () => {
    expect(formatPort(9999)).toBe('9999');
  });
});

// ---------------------------------------------------------------------------
// formatHostList
// ---------------------------------------------------------------------------
describe('formatHostList', () => {
  it('returns "None" for empty array', () => {
    expect(formatHostList([])).toBe('None');
  });

  it('returns single host', () => {
    expect(formatHostList(['host1.com'])).toBe('host1.com');
  });

  it('joins two hosts with "and"', () => {
    expect(formatHostList(['a', 'b'])).toBe('a and b');
  });

  it('uses Oxford comma for three+', () => {
    expect(formatHostList(['a', 'b', 'c'])).toBe('a, b, and c');
  });

  it('handles four hosts', () => {
    expect(formatHostList(['a', 'b', 'c', 'd'])).toBe('a, b, c, and d');
  });

  it('returns "None" for null-ish', () => {
    expect(formatHostList(null as unknown as string[])).toBe('None');
  });
});

// ---------------------------------------------------------------------------
// formatTopology / formatInstallationType / formatDatabaseType
// ---------------------------------------------------------------------------
describe('formatTopology', () => {
  it('formats growth', () => {
    expect(formatTopology('growth')).toBe('Growth (Single-Node)');
  });

  it('formats enterprise', () => {
    expect(formatTopology('enterprise')).toBe('Enterprise (HA)');
  });
});

describe('formatInstallationType', () => {
  it('formats online', () => {
    expect(formatInstallationType('online')).toBe('Online (Connected)');
  });

  it('formats disconnected', () => {
    expect(formatInstallationType('disconnected')).toBe('Disconnected (Air-Gapped)');
  });
});

describe('formatDatabaseType', () => {
  it('formats managed', () => {
    expect(formatDatabaseType('managed')).toBe('Managed (Installer-Managed)');
  });

  it('formats external', () => {
    expect(formatDatabaseType('external')).toBe('External (Pre-Provisioned)');
  });
});

// ---------------------------------------------------------------------------
// formatPercentage
// ---------------------------------------------------------------------------
describe('formatPercentage', () => {
  it('formats integer without decimal', () => {
    expect(formatPercentage(50)).toBe('50%');
  });

  it('formats float with one decimal', () => {
    expect(formatPercentage(33.333)).toBe('33.3%');
  });

  it('formats zero', () => {
    expect(formatPercentage(0)).toBe('0%');
  });

  it('formats 100', () => {
    expect(formatPercentage(100)).toBe('100%');
  });
});

// ---------------------------------------------------------------------------
// pluralize
// ---------------------------------------------------------------------------
describe('pluralize', () => {
  it('uses singular for 1', () => {
    expect(pluralize(1, 'host')).toBe('1 host');
  });

  it('uses plural for 0', () => {
    expect(pluralize(0, 'host')).toBe('0 hosts');
  });

  it('uses plural for > 1', () => {
    expect(pluralize(5, 'host')).toBe('5 hosts');
  });

  it('uses custom plural', () => {
    expect(pluralize(2, 'child', 'children')).toBe('2 children');
  });

  it('uses custom plural for 1', () => {
    expect(pluralize(1, 'child', 'children')).toBe('1 child');
  });
});

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------
describe('generateId', () => {
  it('generates non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('includes prefix when provided', () => {
    expect(generateId('test')).toMatch(/^test-/);
  });

  it('has no prefix delimiter when no prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// deepClone
// ---------------------------------------------------------------------------
describe('deepClone', () => {
  it('clones primitives', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBeNull();
  });

  it('clones objects deeply', () => {
    const original = { a: 1, b: { c: 2 } };
    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    cloned.b.c = 999;
    expect(original.b.c).toBe(2);
  });

  it('clones arrays', () => {
    const original = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    (cloned[2] as any).a = 999;
    expect((original[2] as any).a).toBe(4);
  });

  it('handles Date objects', () => {
    const d = new Date('2025-01-01');
    const cloned = deepClone(d);
    expect(cloned.getTime()).toBe(d.getTime());
  });
});

// ---------------------------------------------------------------------------
// deepEqual
// ---------------------------------------------------------------------------
describe('deepEqual', () => {
  it('compares identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it('rejects different primitives', () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('compares objects deeply', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('compares arrays', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it('handles different types', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });

  it('compares Dates by value', () => {
    expect(deepEqual(new Date('2025-01-01'), new Date('2025-01-01'))).toBe(true);
    expect(deepEqual(new Date('2025-01-01'), new Date('2025-01-02'))).toBe(false);
  });

  it('rejects objects with different key counts', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------
describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delays execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('resets timer on rapid calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('passes arguments', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });
});

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------
describe('throttle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls immediately on first invocation', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throttles subsequent calls', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('runs trailing call after limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });
});
