import { describe, it, expect } from 'vitest';
import {
  validateFQDN,
  validateIPAddress,
  validateHostnameOrIP,
  validatePort,
  validateRequired,
  validateMinLength,
  validateMaxLength,
  validatePasswordStrength,
  calculatePasswordEntropy,
  getPasswordStrengthLevel,
  validateUnixPath,
  validatePEMFormat,
  validateSSHKeyPath,
  validateUsername,
  validateEmail,
  validateURL,
  validateCIDR,
  validatePortRange,
  validatePositiveInteger,
  validatePercentage,
  validateUniqueHosts,
  validateUniquePorts,
  composeValidators,
  validateIf,
  warnReservedPort,
  validateRegistryURL,
} from '../utils/validators';

// ---------------------------------------------------------------------------
// validateFQDN
// ---------------------------------------------------------------------------
describe('validateFQDN', () => {
  const valid = [
    'aap.example.org',
    'host1.corp.redhat.com',
    'a.b.c.d.e.f',
    'my-host.example.com',
    'sub1.sub2.sub3.example.co.uk',
    'x1.y2.z3',
    'AAP.Example.Org',
    'a1.b2',
    'node-01.cluster.internal',
    'example.org.',      // trailing dot is stripped
    'a-b.c-d.e-f',
    'test123.example456.com',
    'my.long.sub.domain.example.com',
    '0abc.example.com',
    'host.xn--nxasmq6b',
  ];

  it.each(valid)('accepts valid FQDN: %s', (fqdn) => {
    expect(validateFQDN(fqdn)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateFQDN('')).toBe('FQDN is required');
  });

  it('rejects whitespace-only', () => {
    expect(validateFQDN('   ')).toBe('FQDN is required');
  });

  it('rejects single label (no dots)', () => {
    expect(validateFQDN('localhost')).toMatch(/at least two labels/);
  });

  it('rejects leading hyphen in label', () => {
    expect(validateFQDN('-invalid.com')).toMatch(/invalid characters/);
  });

  it('rejects trailing hyphen in label', () => {
    expect(validateFQDN('host-.com')).toMatch(/invalid characters/);
  });

  it('rejects double dots (empty label)', () => {
    expect(validateFQDN('host..double.dot')).toBe('FQDN must not contain empty labels');
  });

  it('rejects FQDN exceeding 253 characters', () => {
    const long = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.com';
    expect(long.length).toBeGreaterThan(253);
    expect(validateFQDN(long)).toBe('FQDN must not exceed 253 characters');
  });

  it('rejects label exceeding 63 characters', () => {
    const longLabel = 'a'.repeat(64) + '.com';
    expect(validateFQDN(longLabel)).toMatch(/exceeds maximum length of 63/);
  });

  it('rejects all-numeric TLD', () => {
    expect(validateFQDN('host.123')).toBe('Top-level domain must not be all numeric');
  });

  it('rejects underscores in labels', () => {
    expect(validateFQDN('my_host.example.com')).toMatch(/invalid characters/);
  });

  it('rejects spaces in labels', () => {
    expect(validateFQDN('my host.example.com')).toMatch(/invalid characters/);
  });

  it('allows exactly 253 character hostname', () => {
    const label = 'a'.repeat(50);
    const fqdn = `${label}.${label}.${label}.${label}.com`;
    if (fqdn.replace(/\.$/, '').length <= 253) {
      expect(validateFQDN(fqdn)).toBeNull();
    }
  });

  it('rejects unicode characters', () => {
    expect(validateFQDN('héllo.example.com')).toMatch(/invalid characters/);
  });

  it('trims whitespace before validation', () => {
    expect(validateFQDN('  aap.example.org  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateIPAddress
// ---------------------------------------------------------------------------
describe('validateIPAddress', () => {
  describe('valid IPv4', () => {
    const validIPv4 = [
      '192.168.1.1',
      '10.0.0.0',
      '255.255.255.255',
      '0.0.0.0',
      '172.16.0.1',
      '1.2.3.4',
      '127.0.0.1',
      '8.8.8.8',
      '100.64.0.1',
      '192.0.2.1',
      '203.0.113.5',
      '198.51.100.10',
      '169.254.0.1',
      '224.0.0.1',
      '240.0.0.1',
    ];

    it.each(validIPv4)('accepts %s', (ip) => {
      expect(validateIPAddress(ip)).toBeNull();
    });
  });

  describe('valid IPv6', () => {
    const validIPv6 = [
      '::1',
      'fe80::1',
      '2001:db8::1',
      '::',
      'fe80::',
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      '2001:db8:85a3::8a2e:370:7334',
    ];

    it.each(validIPv6)('accepts %s', (ip) => {
      expect(validateIPAddress(ip)).toBeNull();
    });
  });

  describe('invalid addresses', () => {
    it('rejects empty string', () => {
      expect(validateIPAddress('')).toBe('IP address is required');
    });

    it('rejects whitespace-only', () => {
      expect(validateIPAddress('   ')).toBe('IP address is required');
    });

    it('rejects octets > 255', () => {
      expect(validateIPAddress('999.999.999.999')).toMatch(/each octet must be 0-255/);
    });

    it('rejects incomplete IPv4', () => {
      expect(validateIPAddress('192.168.1')).toMatch(/each octet must be 0-255/);
    });

    it('rejects plain text', () => {
      expect(validateIPAddress('abc')).toMatch(/Invalid IP address/);
    });

    it('rejects IPv4 with extra octets', () => {
      expect(validateIPAddress('1.2.3.4.5')).toMatch(/each octet must be 0-255/);
    });

    it('rejects negative numbers', () => {
      expect(validateIPAddress('-1.0.0.0')).not.toBeNull();
    });

    it('rejects IPv4 with port', () => {
      expect(validateIPAddress('192.168.1.1:8080')).toMatch(/Invalid/);
    });

    it('rejects malformed IPv6 with triple colon', () => {
      expect(validateIPAddress(':::1')).not.toBeNull();
    });

    it('rejects IPv4-mapped IPv6 with bad IPv4', () => {
      expect(validateIPAddress('::ffff:999.1.1.1')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// validateHostnameOrIP
// ---------------------------------------------------------------------------
describe('validateHostnameOrIP', () => {
  it('rejects empty string', () => {
    expect(validateHostnameOrIP('')).toBe('Host is required');
  });

  it('accepts "localhost"', () => {
    expect(validateHostnameOrIP('localhost')).toBeNull();
  });

  it('accepts valid IPv4', () => {
    expect(validateHostnameOrIP('192.168.1.1')).toBeNull();
  });

  it('accepts valid FQDN', () => {
    expect(validateHostnameOrIP('aap.example.org')).toBeNull();
  });

  it('accepts single-label hostname matching label regex', () => {
    expect(validateHostnameOrIP('myhost')).toBeNull();
  });

  it('rejects completely invalid host', () => {
    expect(validateHostnameOrIP('---')).toMatch(/valid hostname/);
  });

  it('accepts IPv6 loopback', () => {
    expect(validateHostnameOrIP('::1')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(validateHostnameOrIP('  myhost  ')).toBeNull();
  });

  it('rejects empty after trim', () => {
    expect(validateHostnameOrIP('   ')).toBe('Host is required');
  });

  it('rejects shell injection in hostname', () => {
    expect(validateHostnameOrIP('; rm -rf /')).toMatch(/invalid characters/);
    expect(validateHostnameOrIP('$(whoami)')).toMatch(/invalid characters|valid hostname/);
    expect(validateHostnameOrIP('host`id`')).toMatch(/invalid characters/);
    expect(validateHostnameOrIP('aap|malicious')).toMatch(/invalid characters|valid hostname/);
  });
});

// ---------------------------------------------------------------------------
// validatePort
// ---------------------------------------------------------------------------
describe('validatePort', () => {
  it('accepts port 1', () => {
    expect(validatePort(1)).toBeNull();
  });

  it('accepts port 65535', () => {
    expect(validatePort(65535)).toBeNull();
  });

  it('accepts port 443', () => {
    expect(validatePort(443)).toBeNull();
  });

  it('accepts port 8080', () => {
    expect(validatePort(8080)).toBeNull();
  });

  it('rejects port 0', () => {
    expect(validatePort(0)).toMatch(/between 1 and 65535/);
  });

  it('rejects port 65536', () => {
    expect(validatePort(65536)).toMatch(/between 1 and 65535/);
  });

  it('rejects negative port', () => {
    expect(validatePort(-1)).toMatch(/between 1 and 65535/);
  });

  it('rejects NaN', () => {
    expect(validatePort(NaN)).toBe('Port number is required');
  });

  it('rejects fractional port', () => {
    expect(validatePort(80.5)).toBe('Port must be a whole number');
  });

  it('rejects null-ish via coercion', () => {
    expect(validatePort(null as unknown as number)).toBe('Port number is required');
  });

  it('rejects undefined via coercion', () => {
    expect(validatePort(undefined as unknown as number)).toBe('Port number is required');
  });

  it('rejects very large number', () => {
    expect(validatePort(100000)).toMatch(/between 1 and 65535/);
  });
});

// ---------------------------------------------------------------------------
// warnReservedPort
// ---------------------------------------------------------------------------
describe('warnReservedPort', () => {
  it('warns for port 1', () => {
    expect(warnReservedPort(1)).toMatch(/reserved range/);
  });

  it('warns for port 80', () => {
    expect(warnReservedPort(80)).toMatch(/reserved range/);
  });

  it('warns for port 443', () => {
    expect(warnReservedPort(443)).toMatch(/reserved range/);
  });

  it('warns for port 1023', () => {
    expect(warnReservedPort(1023)).toMatch(/reserved range/);
  });

  it('does not warn for port 1024', () => {
    expect(warnReservedPort(1024)).toBeNull();
  });

  it('does not warn for port 8080', () => {
    expect(warnReservedPort(8080)).toBeNull();
  });

  it('does not warn for port 65535', () => {
    expect(warnReservedPort(65535)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateRequired
// ---------------------------------------------------------------------------
describe('validateRequired', () => {
  it('rejects empty string (no field name)', () => {
    expect(validateRequired('')).toBe('This field is required');
  });

  it('rejects empty string (with field name)', () => {
    expect(validateRequired('', 'Username')).toBe('Username is required');
  });

  it('rejects whitespace-only', () => {
    expect(validateRequired('   ')).toBe('This field is required');
  });

  it('rejects null coercion', () => {
    expect(validateRequired(null as unknown as string)).toBe('This field is required');
  });

  it('rejects undefined coercion', () => {
    expect(validateRequired(undefined as unknown as string)).toBe('This field is required');
  });

  it('accepts non-empty string', () => {
    expect(validateRequired('hello')).toBeNull();
  });

  it('accepts string with only spaces when not trimmed internally', () => {
    // The function trims, so ' a ' still has content
    expect(validateRequired(' a ')).toBeNull();
  });

  it('accepts single character', () => {
    expect(validateRequired('x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateMinLength / validateMaxLength
// ---------------------------------------------------------------------------
describe('validateMinLength', () => {
  it('returns null for falsy value (no error on empty)', () => {
    expect(validateMinLength('', 5)).toBeNull();
  });

  it('returns null when value meets min', () => {
    expect(validateMinLength('hello', 5)).toBeNull();
  });

  it('returns null when value exceeds min', () => {
    expect(validateMinLength('hello world', 5)).toBeNull();
  });

  it('returns error when value is too short', () => {
    expect(validateMinLength('hi', 5)).toBe('Must be at least 5 characters');
  });

  it('handles boundary exactly', () => {
    expect(validateMinLength('abc', 3)).toBeNull();
  });

  it('handles min of 1', () => {
    expect(validateMinLength('x', 1)).toBeNull();
  });
});

describe('validateMaxLength', () => {
  it('returns null for falsy value', () => {
    expect(validateMaxLength('', 5)).toBeNull();
  });

  it('returns null when value is within max', () => {
    expect(validateMaxLength('hi', 5)).toBeNull();
  });

  it('returns null at exact boundary', () => {
    expect(validateMaxLength('hello', 5)).toBeNull();
  });

  it('returns error when value exceeds max', () => {
    expect(validateMaxLength('hello world', 5)).toBe('Must be at most 5 characters');
  });

  it('handles max of 1', () => {
    expect(validateMaxLength('ab', 1)).toBe('Must be at most 1 characters');
  });
});

// ---------------------------------------------------------------------------
// calculatePasswordEntropy & getPasswordStrengthLevel
// ---------------------------------------------------------------------------
describe('calculatePasswordEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(calculatePasswordEntropy('')).toBe(0);
  });

  it('calculates for digits only', () => {
    const entropy = calculatePasswordEntropy('12345678');
    expect(entropy).toBe(Math.floor(8 * Math.log2(10)));
  });

  it('calculates for lowercase only', () => {
    const entropy = calculatePasswordEntropy('abcdefgh');
    expect(entropy).toBe(Math.floor(8 * Math.log2(26)));
  });

  it('calculates for mixed case', () => {
    const entropy = calculatePasswordEntropy('AbCdEfGh');
    expect(entropy).toBe(Math.floor(8 * Math.log2(52)));
  });

  it('calculates for all character classes', () => {
    const entropy = calculatePasswordEntropy('Ab1!');
    expect(entropy).toBe(Math.floor(4 * Math.log2(95)));
  });

  it('increases with length', () => {
    const short = calculatePasswordEntropy('abc');
    const long = calculatePasswordEntropy('abcdefghij');
    expect(long).toBeGreaterThan(short);
  });

  it('increases with charset diversity', () => {
    const lowOnly = calculatePasswordEntropy('aaaaaaaaaa');
    const mixed = calculatePasswordEntropy('aA1!aA1!aA');
    expect(mixed).toBeGreaterThan(lowOnly);
  });
});

describe('getPasswordStrengthLevel', () => {
  it('rates empty as weak', () => {
    expect(getPasswordStrengthLevel('')).toBe('weak');
  });

  it('rates short digit-only as weak', () => {
    expect(getPasswordStrengthLevel('12345')).toBe('weak');
  });

  it('rates short lowercase as fair', () => {
    // 7 lowercase chars → 7*log2(26) ≈ 32 → fair (28 ≤ 32 < 36)
    expect(getPasswordStrengthLevel('abcdefg')).toBe('fair');
  });

  it('rates medium mixed as good', () => {
    // 8 chars upper+lower+digit → 8*log2(62) ≈ 47 → good
    expect(getPasswordStrengthLevel('Passw0rd')).toBe('good');
  });

  it('rates longer mixed as strong', () => {
    // 12 chars upper+lower+digit → 12*log2(62) ≈ 71 → strong
    expect(getPasswordStrengthLevel('MyPassw0rd12')).toBe('strong');
  });

  it('rates all-class long password as excellent', () => {
    // 13 chars all classes → 13*log2(95) ≈ 85 → excellent
    expect(getPasswordStrengthLevel('MyP@ssw0rd!23')).toBe('excellent');
  });
});

// ---------------------------------------------------------------------------
// validatePasswordStrength
// ---------------------------------------------------------------------------
describe('validatePasswordStrength', () => {
  it('rejects empty password', () => {
    expect(validatePasswordStrength('')).toBe('Password is required');
  });

  it('rejects short password', () => {
    const result = validatePasswordStrength('Ab1!');
    expect(result).toMatch(/at least 12 characters/);
  });

  it('rejects password without lowercase', () => {
    const result = validatePasswordStrength('ABCDEFGH1234!@');
    expect(result).toMatch(/a lowercase letter/);
  });

  it('rejects password without uppercase', () => {
    const result = validatePasswordStrength('abcdefgh1234!@');
    expect(result).toMatch(/an uppercase letter/);
  });

  it('rejects password without numbers', () => {
    const result = validatePasswordStrength('Abcdefghijkl!@');
    expect(result).toMatch(/a number/);
  });

  it('rejects password without special characters', () => {
    const result = validatePasswordStrength('Abcdefgh1234');
    expect(result).not.toBeNull();
  });

  it('detects common password "password"', () => {
    const result = validatePasswordStrength('MyPassword1!xx');
    expect(result).toMatch(/no common words/);
  });

  it('detects common password "12345678"', () => {
    const result = validatePasswordStrength('Ax!12345678xxx');
    expect(result).toMatch(/no common words/);
  });

  it('detects keyboard pattern "qwerty"', () => {
    const result = validatePasswordStrength('Ax!qwerty12345');
    expect(result).toMatch(/no keyboard sequences/);
  });

  it('detects keyboard pattern "asdfgh"', () => {
    const result = validatePasswordStrength('Ax!asdfgh12345');
    expect(result).toMatch(/no keyboard sequences/);
  });

  it('detects repeating characters (4+)', () => {
    const result = validatePasswordStrength('Ax!aaaa1234567');
    expect(result).toMatch(/no repeated characters/);
  });

  it('allows 3 repeated characters', () => {
    const result = validatePasswordStrength('Bx!aaa12345678');
    expect(result).not.toMatch(/repeated/);
  });

  it('accepts strong password with all requirements', () => {
    expect(validatePasswordStrength('MyP@ssw0rd!23')).toBeNull();
  });

  it('accepts long complex password', () => {
    expect(validatePasswordStrength('Tr0ub4dor&3Hse!')).toBeNull();
  });

  it('reports multiple issues at once', () => {
    const result = validatePasswordStrength('abc');
    expect(result).toMatch(/at least 12 characters/);
    expect(result).toMatch(/an uppercase letter/);
    expect(result).toMatch(/a number/);
    expect(result).toMatch(/a special character/);
  });
});

// ---------------------------------------------------------------------------
// validateUnixPath
// ---------------------------------------------------------------------------
describe('validateUnixPath', () => {
  it('rejects empty string', () => {
    expect(validateUnixPath('')).toBe('Path is required');
  });

  it('rejects relative path', () => {
    expect(validateUnixPath('relative/path')).toBe('Path must be absolute (start with /)');
  });

  it('rejects path with null bytes', () => {
    expect(validateUnixPath('/path/with\0null')).toBe('Path contains invalid characters');
  });

  it('rejects path with ".." traversal', () => {
    expect(validateUnixPath('/etc/../passwd')).toBe('Path must not contain ".." traversal');
  });

  it('rejects path exceeding 4096 characters', () => {
    const longPath = '/' + 'a'.repeat(4097);
    expect(validateUnixPath(longPath)).toBe('Path exceeds maximum length of 4096 characters');
  });

  it('accepts valid absolute path', () => {
    expect(validateUnixPath('/opt/aap')).toBeNull();
  });

  it('accepts root path', () => {
    expect(validateUnixPath('/')).toBeNull();
  });

  it('accepts path with hyphens and underscores', () => {
    expect(validateUnixPath('/opt/my-app/data_dir')).toBeNull();
  });

  it('accepts deep nested path', () => {
    expect(validateUnixPath('/a/b/c/d/e/f/g')).toBeNull();
  });

  it('accepts path with trailing slash', () => {
    expect(validateUnixPath('/opt/aap/')).toBeNull();
  });

  it('trims whitespace before validation', () => {
    expect(validateUnixPath('  /opt/aap  ')).toBeNull();
  });

  it('rejects whitespace-only', () => {
    expect(validateUnixPath('   ')).toBe('Path is required');
  });
});

// ---------------------------------------------------------------------------
// validatePEMFormat
// ---------------------------------------------------------------------------
describe('validatePEMFormat', () => {
  const validPEM = [
    '-----BEGIN CERTIFICATE-----',
    'MIICEjCCAXsCAg36MA0GCSqGSIb3DQEBBQUAMIGbMQswCQYD',
    '-----END CERTIFICATE-----',
  ].join('\n');

  it('rejects empty string', () => {
    expect(validatePEMFormat('')).toBe('Certificate is required');
  });

  it('rejects missing BEGIN marker', () => {
    expect(validatePEMFormat('MIICEjCCAXs\n-----END CERTIFICATE-----')).toMatch(/must start with/);
  });

  it('rejects missing END marker', () => {
    expect(validatePEMFormat('-----BEGIN CERTIFICATE-----\nMIICEjCCAXs')).toMatch(/must end with/);
  });

  it('rejects mismatched BEGIN/END count', () => {
    const bad = '-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----\n-----BEGIN RSA KEY-----\ndata2';
    expect(validatePEMFormat(bad)).not.toBeNull();
  });

  it('rejects empty body', () => {
    const emptyBody = '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----';
    expect(validatePEMFormat(emptyBody)).toBe('PEM body is empty');
  });

  it('rejects invalid base64 in body', () => {
    const badB64 = '-----BEGIN CERTIFICATE-----\n!!!invalid!!!\n-----END CERTIFICATE-----';
    expect(validatePEMFormat(badB64)).toBe('PEM body contains invalid base64 characters');
  });

  it('accepts valid PEM certificate', () => {
    expect(validatePEMFormat(validPEM)).toBeNull();
  });

  it('accepts PEM with multiple valid blocks', () => {
    const multi = validPEM + '\n' + validPEM.replace('CERTIFICATE', 'RSA PRIVATE KEY');
    expect(validatePEMFormat(multi)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(validatePEMFormat('  ' + validPEM + '  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateSSHKeyPath
// ---------------------------------------------------------------------------
describe('validateSSHKeyPath', () => {
  it('rejects empty string', () => {
    expect(validateSSHKeyPath('')).toBe('SSH key path is required');
  });

  it('rejects non-absolute path', () => {
    expect(validateSSHKeyPath('.ssh/id_rsa')).toMatch(/must be absolute/);
  });

  it('rejects .pub (public key) path', () => {
    expect(validateSSHKeyPath('/home/user/.ssh/id_rsa.pub')).toMatch(/private key.*not the public key/);
  });

  it('accepts valid SSH key path', () => {
    expect(validateSSHKeyPath('/home/user/.ssh/id_rsa')).toBeNull();
  });

  it('accepts path without ssh reference', () => {
    expect(validateSSHKeyPath('/opt/mykeys/deploy')).toBeNull();
  });

  it('validates underlying unix path rules', () => {
    expect(validateSSHKeyPath('/path/../bad')).toMatch(/traversal/);
  });
});

// ---------------------------------------------------------------------------
// validateUsername
// ---------------------------------------------------------------------------
describe('validateUsername', () => {
  it('rejects empty string', () => {
    expect(validateUsername('')).toBe('Username is required');
  });

  it('rejects too short (1 char)', () => {
    expect(validateUsername('ab')).toMatch(/at least 3 characters/);
  });

  it('rejects too long (65 chars)', () => {
    expect(validateUsername('a' + 'b'.repeat(64))).toMatch(/at most 64 characters/);
  });

  it('rejects starting with number', () => {
    expect(validateUsername('1admin')).toMatch(/must start with a letter/);
  });

  it('rejects starting with hyphen', () => {
    expect(validateUsername('-admin')).toMatch(/must start with a letter/);
  });

  it('rejects special characters', () => {
    expect(validateUsername('admin@host')).toMatch(/must start with a letter/);
  });

  it('accepts valid username', () => {
    expect(validateUsername('admin')).toBeNull();
  });

  it('accepts username with hyphens', () => {
    expect(validateUsername('my-user')).toBeNull();
  });

  it('accepts username with underscores', () => {
    expect(validateUsername('my_user')).toBeNull();
  });

  it('accepts username with numbers', () => {
    expect(validateUsername('user123')).toBeNull();
  });

  it('accepts exactly 3 characters', () => {
    expect(validateUsername('abc')).toBeNull();
  });

  it('accepts exactly 64 characters', () => {
    expect(validateUsername('a' + 'b'.repeat(62) + 'c')).toBeNull();
  });

  it('rejects ending with hyphen', () => {
    expect(validateUsername('admin-')).toMatch(/must start with a letter/);
  });

  it('trims whitespace', () => {
    expect(validateUsername('  admin  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------
describe('validateEmail', () => {
  it('rejects empty string', () => {
    expect(validateEmail('')).toBe('Email is required');
  });

  it('rejects string without @', () => {
    expect(validateEmail('invalid')).toBe('Enter a valid email address');
  });

  it('rejects email exceeding 254 characters', () => {
    const longEmail = 'a'.repeat(200) + '@' + 'b'.repeat(50) + '.com';
    expect(validateEmail(longEmail)).toBe('Email address is too long');
  });

  it('rejects local part exceeding 64 characters', () => {
    const longLocal = 'a'.repeat(65) + '@example.com';
    expect(validateEmail(longLocal)).toBe('Local part of email must not exceed 64 characters');
  });

  it('rejects domain shorter than 3 characters', () => {
    const result = validateEmail('user@ab');
    expect(result).not.toBeNull();
  });

  it('accepts valid email', () => {
    expect(validateEmail('user@example.com')).toBeNull();
  });

  it('accepts email with plus addressing', () => {
    expect(validateEmail('user+tag@example.com')).toBeNull();
  });

  it('accepts email with dots in local part', () => {
    expect(validateEmail('first.last@example.com')).toBeNull();
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.co.uk')).toBeNull();
  });

  it('rejects email with spaces', () => {
    expect(validateEmail('user @example.com')).toBe('Enter a valid email address');
  });

  it('rejects double @', () => {
    expect(validateEmail('user@@example.com')).toBe('Enter a valid email address');
  });

  it('trims whitespace', () => {
    expect(validateEmail('  user@example.com  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateURL
// ---------------------------------------------------------------------------
describe('validateURL', () => {
  it('rejects empty string', () => {
    expect(validateURL('')).toBe('URL is required');
  });

  it('rejects non-URL string', () => {
    expect(validateURL('not a url')).toMatch(/valid URL/);
  });

  it('rejects ftp protocol', () => {
    expect(validateURL('ftp://example.com')).toBe('URL must use http or https protocol');
  });

  it('rejects file protocol', () => {
    expect(validateURL('file:///etc/passwd')).toBe('URL must use http or https protocol');
  });

  it('accepts http URL', () => {
    expect(validateURL('http://example.com')).toBeNull();
  });

  it('accepts https URL', () => {
    expect(validateURL('https://example.com')).toBeNull();
  });

  it('accepts URL with path', () => {
    expect(validateURL('https://example.com/path/to/resource')).toBeNull();
  });

  it('accepts URL with port', () => {
    expect(validateURL('https://example.com:8443')).toBeNull();
  });

  it('accepts URL with query params', () => {
    expect(validateURL('https://example.com?key=value')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(validateURL('  https://example.com  ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateRegistryURL
// ---------------------------------------------------------------------------
describe('validateRegistryURL', () => {
  it('rejects empty string', () => {
    expect(validateRegistryURL('')).toBe('Registry URL is required');
  });

  it('accepts URL with https protocol', () => {
    expect(validateRegistryURL('https://registry.redhat.io')).toBeNull();
  });

  it('accepts URL with http protocol', () => {
    expect(validateRegistryURL('http://registry.example.com')).toBeNull();
  });

  it('rejects non-http/https protocol', () => {
    expect(validateRegistryURL('ftp://registry.example.com')).toMatch(/must use http or https/);
  });

  it('accepts bare hostname', () => {
    expect(validateRegistryURL('registry.redhat.io')).toBeNull();
  });

  it('accepts hostname with port', () => {
    expect(validateRegistryURL('myregistry.example.com:5000')).toBeNull();
  });

  it('accepts hostname with port and path', () => {
    expect(validateRegistryURL('myregistry.example.com:5000/v2')).toBeNull();
  });

  it('rejects invalid port in bare form', () => {
    expect(validateRegistryURL('myregistry.example.com:99999')).toMatch(/port must be between/);
  });

  it('rejects invalid hostname in bare form', () => {
    expect(validateRegistryURL('---:5000')).toMatch(/host invalid/);
  });

  it('rejects malformed URL with protocol', () => {
    expect(validateRegistryURL('https://:::')).toMatch(/Invalid registry URL format/);
  });
});

// ---------------------------------------------------------------------------
// validateCIDR
// ---------------------------------------------------------------------------
describe('validateCIDR', () => {
  it('rejects empty string', () => {
    expect(validateCIDR('')).toBe('CIDR notation is required');
  });

  it('rejects address without prefix', () => {
    expect(validateCIDR('10.0.0.0')).toMatch(/must include a prefix length/);
  });

  it('accepts valid IPv4 CIDR', () => {
    expect(validateCIDR('10.0.0.0/8')).toBeNull();
  });

  it('accepts /32 single host', () => {
    expect(validateCIDR('192.168.1.1/32')).toBeNull();
  });

  it('accepts /0 default route', () => {
    expect(validateCIDR('0.0.0.0/0')).toBeNull();
  });

  it('rejects IPv4 prefix > 32', () => {
    expect(validateCIDR('10.0.0.0/33')).not.toBeNull();
  });

  it('accepts valid IPv6 CIDR', () => {
    expect(validateCIDR('2001:db8::/32')).toBeNull();
  });

  it('accepts IPv6 /128', () => {
    expect(validateCIDR('::1/128')).toBeNull();
  });

  it('rejects IPv6 prefix > 128', () => {
    expect(validateCIDR('::1/129')).toMatch(/prefix length must be 0-128/);
  });

  it('rejects invalid IP in CIDR', () => {
    expect(validateCIDR('999.0.0.0/8')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePortRange
// ---------------------------------------------------------------------------
describe('validatePortRange', () => {
  it('rejects empty string', () => {
    expect(validatePortRange('')).toBe('Port range is required');
  });

  it('rejects single port', () => {
    expect(validatePortRange('8080')).toMatch(/format "start-end"/);
  });

  it('rejects invalid format', () => {
    expect(validatePortRange('abc-def')).toMatch(/format "start-end"/);
  });

  it('rejects start >= end', () => {
    expect(validatePortRange('8080-8080')).toMatch(/Start port must be less than end port/);
  });

  it('rejects reversed range', () => {
    expect(validatePortRange('9000-8000')).toMatch(/Start port must be less than end port/);
  });

  it('rejects range spanning > 10000', () => {
    expect(validatePortRange('1-20000')).toMatch(/must not span more than 10,000/);
  });

  it('rejects start port 0', () => {
    expect(validatePortRange('0-100')).toMatch(/Start port/);
  });

  it('rejects end port > 65535', () => {
    expect(validatePortRange('1-70000')).toMatch(/End port/);
  });

  it('accepts valid range', () => {
    expect(validatePortRange('8000-8100')).toBeNull();
  });

  it('accepts range at port boundaries', () => {
    expect(validatePortRange('1-10000')).toBeNull();
  });

  it('accepts small range', () => {
    expect(validatePortRange('443-444')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePositiveInteger
// ---------------------------------------------------------------------------
describe('validatePositiveInteger', () => {
  it('rejects NaN', () => {
    expect(validatePositiveInteger(NaN)).toBe('A number is required');
  });

  it('rejects null coercion', () => {
    expect(validatePositiveInteger(null as unknown as number)).toBe('A number is required');
  });

  it('rejects float', () => {
    expect(validatePositiveInteger(1.5)).toBe('Must be a whole number');
  });

  it('rejects zero', () => {
    expect(validatePositiveInteger(0)).toBe('Must be a positive integer');
  });

  it('rejects negative', () => {
    expect(validatePositiveInteger(-5)).toBe('Must be a positive integer');
  });

  it('accepts 1', () => {
    expect(validatePositiveInteger(1)).toBeNull();
  });

  it('accepts large integer', () => {
    expect(validatePositiveInteger(1000000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePercentage
// ---------------------------------------------------------------------------
describe('validatePercentage', () => {
  it('rejects NaN', () => {
    expect(validatePercentage(NaN)).toBe('A percentage is required');
  });

  it('rejects negative', () => {
    expect(validatePercentage(-1)).toMatch(/between 0 and 100/);
  });

  it('rejects > 100', () => {
    expect(validatePercentage(101)).toMatch(/between 0 and 100/);
  });

  it('accepts 0', () => {
    expect(validatePercentage(0)).toBeNull();
  });

  it('accepts 100', () => {
    expect(validatePercentage(100)).toBeNull();
  });

  it('accepts 50.5', () => {
    expect(validatePercentage(50.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateUniqueHosts
// ---------------------------------------------------------------------------
describe('validateUniqueHosts', () => {
  it('returns null for unique hosts', () => {
    expect(validateUniqueHosts(['host1.com', 'host2.com', 'host3.com'])).toBeNull();
  });

  it('detects duplicate hosts', () => {
    expect(validateUniqueHosts(['host1.com', 'host2.com', 'host1.com'])).toMatch(/Duplicate hosts/);
  });

  it('detects case-insensitive duplicates', () => {
    expect(validateUniqueHosts(['Host1.COM', 'host1.com'])).toMatch(/Duplicate hosts/);
  });

  it('skips empty strings', () => {
    expect(validateUniqueHosts(['', '', 'host1.com'])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(validateUniqueHosts([])).toBeNull();
  });

  it('returns null for single host', () => {
    expect(validateUniqueHosts(['host1.com'])).toBeNull();
  });

  it('trims whitespace before comparing', () => {
    expect(validateUniqueHosts(['  host1.com  ', 'host1.com'])).toMatch(/Duplicate hosts/);
  });
});

// ---------------------------------------------------------------------------
// validateUniquePorts
// ---------------------------------------------------------------------------
describe('validateUniquePorts', () => {
  it('returns null for unique ports', () => {
    expect(validateUniquePorts([80, 443, 8080])).toBeNull();
  });

  it('detects duplicate ports', () => {
    expect(validateUniquePorts([80, 443, 80])).toMatch(/Duplicate ports/);
  });

  it('returns null for empty array', () => {
    expect(validateUniquePorts([])).toBeNull();
  });

  it('returns null for single port', () => {
    expect(validateUniquePorts([443])).toBeNull();
  });

  it('lists all duplicates', () => {
    const result = validateUniquePorts([80, 443, 80, 443]);
    expect(result).toMatch(/80/);
    expect(result).toMatch(/443/);
  });
});

// ---------------------------------------------------------------------------
// composeValidators
// ---------------------------------------------------------------------------
describe('composeValidators', () => {
  it('returns null when all validators pass', () => {
    const composed = composeValidators(
      (v: string) => (v.length > 0 ? null : 'empty'),
      (v: string) => (v.length < 100 ? null : 'too long'),
    );
    expect(composed('hello')).toBeNull();
  });

  it('returns first error and stops', () => {
    const composed = composeValidators(
      () => 'first error',
      () => 'second error',
    );
    expect(composed('anything')).toBe('first error');
  });

  it('skips to second when first passes', () => {
    const composed = composeValidators(
      () => null,
      () => 'second error',
    );
    expect(composed('anything')).toBe('second error');
  });

  it('works with no validators', () => {
    const composed = composeValidators();
    expect(composed('anything')).toBeNull();
  });

  it('works with single validator', () => {
    const composed = composeValidators((v: string) => (v === 'ok' ? null : 'nope'));
    expect(composed('ok')).toBeNull();
    expect(composed('bad')).toBe('nope');
  });
});

// ---------------------------------------------------------------------------
// validateIf
// ---------------------------------------------------------------------------
describe('validateIf', () => {
  const alwaysFails = () => 'always fails';
  const alwaysPasses = () => null;

  it('skips validation when condition is false', () => {
    const validator = validateIf(false, alwaysFails);
    expect(validator('anything')).toBeNull();
  });

  it('runs validation when condition is true', () => {
    const validator = validateIf(true, alwaysFails);
    expect(validator('anything')).toBe('always fails');
  });

  it('returns null when condition is true and validator passes', () => {
    const validator = validateIf(true, alwaysPasses);
    expect(validator('anything')).toBeNull();
  });

  it('can be composed with other validators', () => {
    const composed = composeValidators(
      validateIf(false, alwaysFails),
      validateIf(true, (v: string) => (v ? null : 'required')),
    );
    expect(composed('hello')).toBeNull();
    expect(composed('')).toBe('required');
  });
});
