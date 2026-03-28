import { validateHostname as validateHostnameShellSafe } from './crypto';

const FQDN_LABEL_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_FULL_RE = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
const IPV6_COMPRESSED_RE =
  /^(([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4})?::(([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4})?$/;
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{1,62}[a-zA-Z0-9]$/;
const UNIX_PATH_RE = /^\/(?:[^/\0]+\/?)*$/;
const PEM_BEGIN_RE = /-----BEGIN [A-Z ]+-----/;
const PEM_END_RE = /-----END [A-Z ]+-----/;
const CIDR_V4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\/(?:[0-9]|[12]\d|3[0-2])$/;
const PORT_RANGE_RE = /^(\d{1,5})-(\d{1,5})$/;

const COMMON_PASSWORDS = [
  'password', '12345678', 'qwerty', 'letmein', 'admin', 'welcome',
  'monkey', 'dragon', 'master', 'abc123', 'login', 'princess',
  'football', 'shadow', 'sunshine', 'trustno1', 'iloveyou', 'batman',
  'access', 'hello', 'charlie', 'donald', '123456789', '1234567890',
];

const KEYBOARD_PATTERNS = [
  'qwerty', 'asdfgh', 'zxcvbn', '123456', '654321', 'qazwsx',
  'abcdef', 'fedcba',
];

export function validateFQDN(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'FQDN is required';
  }

  const trimmed = value.trim();
  const hostname = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;

  if (hostname.length > 253) {
    return 'FQDN must not exceed 253 characters';
  }

  const labels = hostname.split('.');
  if (labels.length < 2) {
    return 'FQDN must contain at least two labels (e.g., host.example.com)';
  }

  for (const label of labels) {
    if (label.length === 0) {
      return 'FQDN must not contain empty labels';
    }
    if (label.length > 63) {
      return `Label "${label}" exceeds maximum length of 63 characters`;
    }
    if (!FQDN_LABEL_RE.test(label)) {
      return `Label "${label}" contains invalid characters (use a-z, 0-9, and hyphens)`;
    }
  }

  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) {
    return 'Top-level domain must not be all numeric';
  }

  return null;
}

export function validateIPAddress(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'IP address is required';
  }
  const trimmed = value.trim();

  if (IPV4_RE.test(trimmed)) {
    return null;
  }

  if (IPV6_FULL_RE.test(trimmed) || IPV6_COMPRESSED_RE.test(trimmed)) {
    if (trimmed.includes('::')) {
      const parts = trimmed.split('::');
      if (parts.length > 2) {
        return 'IPv6 address must not contain more than one "::" sequence';
      }
      const left = parts[0] ? parts[0].split(':').length : 0;
      const right = parts[1] ? parts[1].split(':').length : 0;
      if (left + right > 7) {
        return 'IPv6 address has too many groups';
      }
    }
    return null;
  }

  if (trimmed.includes(':')) {
    return 'Invalid IPv6 address format';
  }
  if (trimmed.includes('.')) {
    return 'Invalid IPv4 address — each octet must be 0-255';
  }
  return 'Invalid IP address — expected IPv4 (e.g., 192.168.1.1) or IPv6';
}

export function validateHostnameOrIP(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Host is required';
  }
  const trimmed = value.trim();

  // Reject shell injection chars first (defense in depth)
  const shellErr = validateHostnameShellSafe(trimmed);
  if (shellErr) return shellErr;

  if (trimmed === 'localhost') return null;

  const ipResult = validateIPAddress(trimmed);
  if (ipResult === null) return null;

  const fqdnResult = validateFQDN(trimmed);
  if (fqdnResult === null) return null;

  if (FQDN_LABEL_RE.test(trimmed)) return null;

  return 'Enter a valid hostname, FQDN, or IP address';
}

export function validatePort(value: number): string | null {
  if (value == null || isNaN(value)) {
    return 'Port number is required';
  }
  if (!Number.isInteger(value)) {
    return 'Port must be a whole number';
  }
  if (value < 1 || value > 65535) {
    return 'Port must be between 1 and 65535';
  }
  return null;
}

export function warnReservedPort(value: number): string | null {
  if (value >= 1 && value <= 1023) {
    return `Port ${value} is in the reserved range (1–1023). Ensure the process has permission to bind.`;
  }
  return null;
}

export function validateRequired(value: string, fieldName?: string): string | null {
  if (value == null || (typeof value === 'string' && value.trim().length === 0)) {
    return fieldName ? `${fieldName} is required` : 'This field is required';
  }
  return null;
}

export function validateMinLength(value: string, min: number): string | null {
  if (!value) return null;
  if (value.length < min) {
    return `Must be at least ${min} characters`;
  }
  return null;
}

export function validateMaxLength(value: string, max: number): string | null {
  if (!value) return null;
  if (value.length > max) {
    return `Must be at most ${max} characters`;
  }
  return null;
}

export function calculatePasswordEntropy(value: string): number {
  if (!value) return 0;

  let charsetSize = 0;
  if (/[a-z]/.test(value)) charsetSize += 26;
  if (/[A-Z]/.test(value)) charsetSize += 26;
  if (/[0-9]/.test(value)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(value)) charsetSize += 33;

  if (charsetSize === 0) return 0;
  return Math.floor(value.length * Math.log2(charsetSize));
}

export function getPasswordStrengthLevel(
  value: string,
): 'weak' | 'fair' | 'good' | 'strong' | 'excellent' {
  const entropy = calculatePasswordEntropy(value);
  if (entropy < 28) return 'weak';
  if (entropy < 36) return 'fair';
  if (entropy < 60) return 'good';
  if (entropy < 80) return 'strong';
  return 'excellent';
}

export function validatePasswordStrength(value: string): string | null {
  if (!value) {
    return 'Password is required';
  }

  const issues: string[] = [];

  if (value.length < 12) {
    issues.push('at least 12 characters');
  }
  if (!/[a-z]/.test(value)) {
    issues.push('a lowercase letter');
  }
  if (!/[A-Z]/.test(value)) {
    issues.push('an uppercase letter');
  }
  if (!/[0-9]/.test(value)) {
    issues.push('a number');
  }
  if (!/[^a-zA-Z0-9]/.test(value)) {
    issues.push('a special character');
  }

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.some((p) => lower.includes(p))) {
    issues.push('no common words or patterns');
  }

  if (KEYBOARD_PATTERNS.some((p) => lower.includes(p))) {
    issues.push('no keyboard sequences');
  }

  const repeating = /(.)\1{3,}/;
  if (repeating.test(value)) {
    issues.push('no repeated characters (4+)');
  }

  if (issues.length > 0) {
    return `Password needs: ${issues.join(', ')}`;
  }

  return null;
}

export function validateUnixPath(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Path is required';
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    return 'Path must be absolute (start with /)';
  }
  if (!UNIX_PATH_RE.test(trimmed)) {
    return 'Path contains invalid characters';
  }
  if (trimmed.includes('..')) {
    return 'Path must not contain ".." traversal';
  }
  if (trimmed.length > 4096) {
    return 'Path exceeds maximum length of 4096 characters';
  }
  return null;
}

export function validatePEMFormat(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Certificate is required';
  }
  const trimmed = value.trim();
  if (!PEM_BEGIN_RE.test(trimmed)) {
    return 'Certificate must start with -----BEGIN ... -----';
  }
  if (!PEM_END_RE.test(trimmed)) {
    return 'Certificate must end with -----END ... -----';
  }

  const beginMatches = trimmed.match(/-----BEGIN ([A-Z ]+)-----/g) || [];
  const endMatches = trimmed.match(/-----END ([A-Z ]+)-----/g) || [];
  if (beginMatches.length !== endMatches.length) {
    return 'Mismatched BEGIN/END markers in PEM data';
  }

  const bodyLines = trimmed
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s/g, '');
  if (bodyLines.length === 0) {
    return 'PEM body is empty';
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(bodyLines)) {
    return 'PEM body contains invalid base64 characters';
  }

  return null;
}

export function validateSSHKeyPath(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'SSH key path is required';
  }
  const pathError = validateUnixPath(value);
  if (pathError) return pathError;

  const trimmed = value.trim();
  if (trimmed.endsWith('.pub')) {
    return 'Provide the private key path, not the public key (.pub)';
  }
  if (!trimmed.includes('.ssh') && !trimmed.includes('ssh') && !trimmed.includes('key')) {
    return null; // warn but don't block
  }
  return null;
}

export function validateUsername(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Username is required';
  }
  const trimmed = value.trim();
  if (trimmed.length < 3) {
    return 'Username must be at least 3 characters';
  }
  if (trimmed.length > 64) {
    return 'Username must be at most 64 characters';
  }
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must start with a letter and contain only letters, numbers, hyphens, and underscores';
  }
  return null;
}

export function validateEmail(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Email is required';
  }
  const trimmed = value.trim();
  if (trimmed.length > 254) {
    return 'Email address is too long';
  }
  if (!EMAIL_RE.test(trimmed)) {
    return 'Enter a valid email address';
  }
  const [local, domain] = trimmed.split('@');
  if (local.length > 64) {
    return 'Local part of email must not exceed 64 characters';
  }
  if (!domain || domain.length < 3) {
    return 'Email must have a valid domain';
  }
  return null;
}

export function validateURL(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'URL is required';
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) {
      return 'URL must use http or https protocol';
    }
    return null;
  } catch {
    return 'Enter a valid URL (e.g., https://example.com)';
  }
}

export function validateRegistryURL(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Registry URL is required';
  }
  const trimmed = value.trim();

  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'Registry URL must use http or https';
      }
      return null;
    } catch {
      return 'Invalid registry URL format';
    }
  }

  const hostPort = trimmed.split('/')[0];
  const colonIdx = hostPort.lastIndexOf(':');
  const host = colonIdx > 0 ? hostPort.substring(0, colonIdx) : hostPort;
  const portStr = colonIdx > 0 ? hostPort.substring(colonIdx + 1) : null;

  const hostError = validateHostnameOrIP(host);
  if (hostError) {
    return `Registry host invalid: ${hostError}`;
  }

  if (portStr) {
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return 'Registry port must be between 1 and 65535';
    }
  }

  return null;
}

export function validateCIDR(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'CIDR notation is required';
  }
  const trimmed = value.trim();

  if (CIDR_V4_RE.test(trimmed)) {
    return null;
  }

  const slashIdx = trimmed.lastIndexOf('/');
  if (slashIdx === -1) {
    return 'CIDR must include a prefix length (e.g., 10.0.0.0/8)';
  }

  const ip = trimmed.substring(0, slashIdx);
  const prefix = trimmed.substring(slashIdx + 1);
  const prefixNum = parseInt(prefix, 10);

  if (trimmed.includes(':')) {
    const ipErr = validateIPAddress(ip);
    if (ipErr) return `Invalid IPv6 network address: ${ipErr}`;
    if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 128) {
      return 'IPv6 prefix length must be 0-128';
    }
    return null;
  }

  const ipErr = validateIPAddress(ip);
  if (ipErr) return `Invalid IPv4 network address: ${ipErr}`;
  if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
    return 'IPv4 prefix length must be 0-32';
  }

  return null;
}

export function validatePortRange(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'Port range is required';
  }
  const trimmed = value.trim();
  const match = PORT_RANGE_RE.exec(trimmed);
  if (!match) {
    return 'Port range must be in format "start-end" (e.g., 8000-8100)';
  }

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);

  const startErr = validatePort(start);
  if (startErr) return `Start port: ${startErr}`;

  const endErr = validatePort(end);
  if (endErr) return `End port: ${endErr}`;

  if (start >= end) {
    return 'Start port must be less than end port';
  }

  if (end - start > 10000) {
    return 'Port range must not span more than 10,000 ports';
  }

  return null;
}

export function validatePositiveInteger(value: number): string | null {
  if (value == null || isNaN(value)) {
    return 'A number is required';
  }
  if (!Number.isInteger(value)) {
    return 'Must be a whole number';
  }
  if (value < 1) {
    return 'Must be a positive integer';
  }
  return null;
}

export function validatePercentage(value: number): string | null {
  if (value == null || isNaN(value)) {
    return 'A percentage is required';
  }
  if (value < 0 || value > 100) {
    return 'Percentage must be between 0 and 100';
  }
  return null;
}

export function validateUniqueHosts(hosts: string[]): string | null {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const host of hosts) {
    const normalized = host.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) {
      duplicates.push(host);
    }
    seen.add(normalized);
  }

  if (duplicates.length > 0) {
    return `Duplicate hosts: ${duplicates.join(', ')}`;
  }
  return null;
}

export function validateUniquePorts(ports: number[]): string | null {
  const seen = new Set<number>();
  const duplicates: number[] = [];

  for (const port of ports) {
    if (seen.has(port)) {
      duplicates.push(port);
    }
    seen.add(port);
  }

  if (duplicates.length > 0) {
    return `Duplicate ports: ${duplicates.join(', ')}`;
  }
  return null;
}

export function composeValidators(
  ...validators: ((value: any) => string | null)[]
): (value: any) => string | null {
  return (value: any): string | null => {
    for (const validator of validators) {
      const error = validator(value);
      if (error !== null) return error;
    }
    return null;
  };
}

export function validateIf(
  condition: boolean,
  validator: (value: any) => string | null,
): (value: any) => string | null {
  return (value: any): string | null => {
    if (!condition) return null;
    return validator(value);
  };
}
