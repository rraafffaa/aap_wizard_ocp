const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const TIME_DIVISIONS: [number, string][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [4.345, 'week'],
  [12, 'month'],
  [Number.POSITIVE_INFINITY, 'year'],
];

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(-bytes, decimals)}`;

  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, BYTE_UNITS.length - 1);
  const value = bytes / Math.pow(k, idx);

  return `${value.toFixed(decimals)} ${BYTE_UNITS[idx]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return `-${formatDuration(-ms)}`;
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainMin = minutes % 60;
    const remainSec = seconds % 60;
    if (remainMin === 0 && remainSec === 0) return `${hours}h`;
    if (remainSec === 0) return `${hours}h ${remainMin}m`;
    return `${hours}h ${remainMin}m ${remainSec}s`;
  }
  if (minutes > 0) {
    const remainSec = seconds % 60;
    if (remainSec === 0) return `${minutes}m`;
    return `${minutes}m ${remainSec}s`;
  }
  return `${seconds}s`;
}

export function formatTimestamp(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  let diff = (d.getTime() - Date.now()) / 1000;
  const isFuture = diff > 0;

  diff = Math.abs(diff);

  if (diff < 10) return 'just now';

  for (const [divisor, unit] of TIME_DIVISIONS) {
    if (diff < divisor) {
      const rounded = Math.round(diff);
      const plural = rounded !== 1 ? 's' : '';
      return isFuture
        ? `in ${rounded} ${unit}${plural}`
        : `${rounded} ${unit}${plural} ago`;
    }
    diff /= divisor;
  }

  return formatTimestamp(d);
}

export function maskPassword(password: string): string {
  if (!password) return '';
  return '•'.repeat(password.length);
}

export function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) return str;
  if (maxLength <= 3) return str.slice(0, maxLength);
  return str.slice(0, maxLength - 3) + '...';
}

export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatPort(port: number): string {
  if (port === 80) return '80 (HTTP)';
  if (port === 443) return '443 (HTTPS)';
  if (port === 22) return '22 (SSH)';
  if (port === 5432) return '5432 (PostgreSQL)';
  if (port === 6379) return '6379 (Redis)';
  if (port === 27199) return '27199 (Receptor)';
  return String(port);
}

export function formatHostList(hosts: string[]): string {
  if (!hosts || hosts.length === 0) return 'None';
  if (hosts.length === 1) return hosts[0];
  if (hosts.length === 2) return `${hosts[0]} and ${hosts[1]}`;
  return `${hosts.slice(0, -1).join(', ')}, and ${hosts[hosts.length - 1]}`;
}

export function formatTopology(topology: 'growth' | 'enterprise'): string {
  return topology === 'growth' ? 'Growth (Single-Node)' : 'Enterprise (HA)';
}

export function formatInstallationType(type: 'online' | 'disconnected'): string {
  return type === 'online' ? 'Online (Connected)' : 'Disconnected (Air-Gapped)';
}

export function formatDatabaseType(type: 'managed' | 'external'): string {
  return type === 'managed' ? 'Managed (Installer-Managed)' : 'External (Pre-Provisioned)';
}

export function formatPercentage(value: number): string {
  if (Number.isInteger(value)) return `${value}%`;
  return `${value.toFixed(1)}%`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  const p = plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : p}`;
}

export function generateId(prefix?: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;

  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  const cloned = {} as T;
  for (const key of Object.keys(obj as object)) {
    (cloned as any)[key] = deepClone((obj as any)[key]);
  }
  return cloned;
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item: any, i: number) => deepEqual(item, b[i]));
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: any[]) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };

  return debounced as unknown as T;
}

export function throttle<T extends (...args: any[]) => any>(fn: T, limit: number): T {
  let inThrottle = false;
  let lastArgs: any[] | null = null;

  const throttled = (...args: any[]) => {
    if (inThrottle) {
      lastArgs = args;
      return;
    }
    fn(...args);
    inThrottle = true;

    setTimeout(() => {
      inThrottle = false;
      if (lastArgs !== null) {
        throttled(...lastArgs);
        lastArgs = null;
      }
    }, limit);
  };

  return throttled as unknown as T;
}
