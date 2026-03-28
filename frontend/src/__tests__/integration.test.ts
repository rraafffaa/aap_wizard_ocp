import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDefaultConfig, type DeploymentConfig } from '../types';
import { applyProfile, diffConfigs, configToYAML, yamlToConfig, PRESET_PROFILES } from '../utils/profiles';
import { validateAllSteps, canProceed } from '../hooks/useValidation';
import { computeDiff, flattenDiff, hasMeaningfulChanges } from '../utils/diffEngine';
import { validatePasswordStrength, validateFQDN, validateHostnameOrIP } from '../utils/validators';
import { generatePassword, generatePasswords, generateUUID, toBase64, fromBase64, sanitizeInput } from '../utils/crypto';
import { formatDuration, formatBytes, deepClone, deepEqual, slugify, capitalize } from '../utils/formatters';

// Mock fetch for API-dependent tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Config lifecycle tests (10 tests)
// ---------------------------------------------------------------------------
describe('Config lifecycle', () => {
  it('create default config, modify, validate, generate inventory check', () => {
    const config = getDefaultConfig();
    expect(config.topology).toBe('enterprise');

    config.topology = 'enterprise';
    config.eula_accepted = true;
    const allErrors = validateAllSteps(config);
    const reviewErrors = allErrors.get('review') ?? [];
    const hardErrors = reviewErrors.filter((e) => e.severity === 'error');
    expect(hardErrors.length).toBeGreaterThan(0);
  });

  it('profile apply then validate produces correct results', () => {
    const current = getDefaultConfig();
    const devProfile = PRESET_PROFILES.find((p) => p.name === 'Development')!;
    const applied = applyProfile(devProfile, current);
    expect(applied.gateway.hosts).toContain('localhost');
    const errors = validateAllSteps(applied);
    expect(errors.size).toBeGreaterThan(0);
  });

  it('import config, validate, export, re-import matches', () => {
    const original = getDefaultConfig();
    original.topology = 'enterprise';
    original.eula_accepted = true;
    const exported = JSON.stringify(original);
    const reimported = JSON.parse(exported) as DeploymentConfig;
    expect(reimported.topology).toBe(original.topology);
    expect(reimported.eula_accepted).toBe(original.eula_accepted);
  });

  it('config diff engine detects all changes after modifications', () => {
    const a = getDefaultConfig();
    const b = { ...getDefaultConfig(), topology: 'growth' as const };
    b.database.type = 'external';
    b.database.host = 'db.example.com';
    const diffs = computeDiff(a, b);
    const flat = flattenDiff(diffs);
    expect(hasMeaningfulChanges(diffs)).toBe(true);
    const changedPaths = flat.filter((e) => e.type === 'changed' || e.type === 'added').map((e) => e.path.join('.'));
    expect(changedPaths.some((p) => p.includes('topology'))).toBe(true);
    expect(changedPaths.some((p) => p.includes('database'))).toBe(true);
  });

  it('config diff detects topology change', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.topology = 'growth';
    const diffs = diffConfigs(a, b);
    expect(diffs.some((d) => d.path === 'topology')).toBe(true);
  });

  it('config diff detects host array changes', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.gateway.hosts = ['gw1.example.com', 'gw2.example.com'];
    const diffs = diffConfigs(a, b);
    expect(diffs.some((d) => d.path === 'gateway.hosts')).toBe(true);
  });

  it('YAML round-trip preserves key values', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    const yaml = configToYAML(config);
    const parsed = yamlToConfig(yaml);
    expect(parsed.topology).toBe('enterprise');
  });

  it('default config has required structure', () => {
    const config = getDefaultConfig();
    expect(config).toHaveProperty('gateway');
    expect(config).toHaveProperty('controller');
    expect(config).toHaveProperty('hub');
    expect(config).toHaveProperty('eda');
    expect(config).toHaveProperty('network');
  });

  it('modifying registry updates config', () => {
    const config = getDefaultConfig();
    config.registry.username = 'user';
    config.registry.password = 'pass';
    expect(config.registry.username).toBe('user');
  });

  it('network config has valid ports', () => {
    const config = getDefaultConfig();
    expect(config.network.http_port).toBeGreaterThan(0);
    expect(config.network.https_port).toBeGreaterThan(0);
    expect(config.network.receptor_port).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Validation integration (10 tests)
// ---------------------------------------------------------------------------
describe('Validation integration', () => {
  function makeValidGrowthConfig(): DeploymentConfig {
    const c = getDefaultConfig();
    c.topology = 'growth';
    c.target_host = 'aap-vm.example.com';
    c.target_user = 'aap';
    c.target_password = 'Adm1n!TargetPass99';
    c.target_ssh_port = 22;
    c.eula_accepted = true;
    c.registry.username = 'user';
    c.registry.password = 'pass';
    c.gateway.hosts = ['aap.example.com'];
    c.controller.hosts = ['aap.example.com'];
    c.hub.hosts = ['aap.example.com'];
    c.eda.hosts = ['aap.example.com'];
    c.database.admin_password = 'Str0ngDbP@ss!99';
    c.gateway.admin_password = 'G@tew4y!Pass99';
    c.gateway.pg_password = 'gw-db';
    c.controller.admin_password = 'C0ntr0ll3r!P@ss';
    c.controller.pg_password = 'ctrl-db';
    c.hub.admin_password = 'Hb!Adm1nP@ss99';
    c.hub.pg_password = 'hub-db';
    c.eda.admin_password = 'Ed@!Adm1nP@ss9';
    c.eda.pg_password = 'eda-db';
    return c;
  }

  function makeValidEnterpriseConfig(): DeploymentConfig {
    const c = makeValidGrowthConfig();
    c.topology = 'enterprise';
    c.gateway.hosts = ['gw1.example.com', 'gw2.example.com'];
    c.controller.hosts = ['c1.example.com', 'c2.example.com'];
    c.hub.hosts = ['h1.example.com', 'h2.example.com'];
    c.eda.hosts = ['e1.example.com', 'e2.example.com'];
    c.redis_mode = 'cluster';
    c.database.type = 'external';
    c.database.host = 'db.example.com';
    c.gateway.pg_host = 'db.example.com';
    c.controller.pg_host = 'db.example.com';
    c.hub.pg_host = 'db.example.com';
    c.eda.pg_host = 'db.example.com';
    return c;
  }

  it('all step validators pass for a complete valid growth config', () => {
    const config = makeValidGrowthConfig();
    const errors = validateAllSteps(config);
    for (const [step, stepErrors] of errors) {
      const hard = stepErrors.filter((e) => e.severity === 'error');
      expect(hard).toHaveLength(0);
    }
  });

  it('all step validators pass for a complete valid enterprise config', () => {
    const config = makeValidEnterpriseConfig();
    const errors = validateAllSteps(config);
    for (const [step, stepErrors] of errors) {
      const hard = stepErrors.filter((e) => e.severity === 'error');
      expect(hard).toHaveLength(0);
    }
  });

  it('partial config produces expected errors in expected steps', () => {
    const config = getDefaultConfig();
    const errors = validateAllSteps(config);
    expect(errors.get('eula')?.some((e) => e.field === 'eula_accepted')).toBe(true);
    expect(errors.get('database')?.some((e) => e.field === 'database.admin_password')).toBe(true);
  });

  it('changing topology from growth to enterprise flags new requirements', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.gateway.hosts = ['gw1.example.com'];
    config.controller.hosts = ['c1.example.com'];
    config.hub.hosts = ['h1.example.com'];
    config.eda.hosts = ['e1.example.com'];
    const errors = validateAllSteps(config);
    const hostErrors = errors.get('hosts') ?? [];
    expect(hostErrors.some((e) => e.message.includes('at least 2'))).toBe(true);
  });

  it('password generation passes strength validation', () => {
    const pw = generatePassword(24, { uppercase: true, lowercase: true, numbers: true, symbols: true });
    const err = validatePasswordStrength(pw);
    expect(err).toBeNull();
  });

  it('FQDN validator agrees with step host validation', () => {
    const validFqdn = 'aap.example.com';
    expect(validateFQDN(validFqdn)).toBeNull();
    expect(validateHostnameOrIP(validFqdn)).toBeNull();
  });

  it('canProceed blocks eula when not accepted', () => {
    const config = getDefaultConfig();
    expect(canProceed('eula', config)).toBe(false);
  });

  it('canProceed allows eula when accepted', () => {
    const config = getDefaultConfig();
    config.eula_accepted = true;
    expect(canProceed('eula', config)).toBe(true);
  });

  it('canProceed allows all steps with valid config', () => {
    const config = makeValidGrowthConfig();
    expect(canProceed('eula', config)).toBe(true);
    expect(canProceed('subscription', config)).toBe(true);
    expect(canProceed('review', config)).toBe(true);
  });

  it('invalid hostname produces host validation error', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['---invalid---'];
    const errors = validateAllSteps(config);
    const hostErrors = errors.get('hosts') ?? [];
    expect(hostErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Profile integration (10 tests)
// ---------------------------------------------------------------------------
describe('Profile integration', () => {
  const strongPassword = 'Str0ngP@ssw0rd!99';

  function withTarget(c: DeploymentConfig): DeploymentConfig {
    c.target_host = 'aap-vm.example.com';
    c.target_user = 'aap';
    c.target_password = 'Adm1n!TargetPass99';
    c.target_ssh_port = 22;
    return c;
  }

  function addPasswords(c: DeploymentConfig): DeploymentConfig {
    c.eula_accepted = true;
    c.registry.username = 'user';
    c.registry.password = 'pass';
    c.database.admin_password = strongPassword;
    c.gateway.admin_password = strongPassword;
    c.gateway.pg_password = 'gw-db';
    c.controller.admin_password = strongPassword;
    c.controller.pg_password = 'ctrl-db';
    c.hub.admin_password = strongPassword;
    c.hub.pg_password = 'hub-db';
    c.eda.admin_password = strongPassword;
    c.eda.pg_password = 'eda-db';
    return c;
  }

  it('Development preset produces config that passes validation', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'Development')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('QA/Staging preset produces valid config', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'QA / Staging')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('Production Single-Node preset produces valid config', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'Production Single-Node')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('Production HA preset produces valid config', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'Production HA')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('Air-Gapped preset produces valid config', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'Air-Gapped')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('Air-Gapped Enterprise preset produces valid config', () => {
    const current = withTarget(getDefaultConfig());
    const applied = addPasswords(applyProfile(PRESET_PROFILES.find((p) => p.name === 'Air-Gapped Enterprise')!, current));
    const errors = validateAllSteps(applied);
    const hard = [...errors.values()].flat().filter((e) => e.severity === 'error');
    expect(hard.length).toBe(0);
  });

  it('applying a profile then diffing shows correct changes', () => {
    const current = getDefaultConfig();
    const devProfile = PRESET_PROFILES.find((p) => p.name === 'Development')!;
    const applied = applyProfile(devProfile, current);
    const diffs = diffConfigs(current, applied);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.path === 'gateway.hosts')).toBe(true);
  });

  it('custom profile save/load round trip', async () => {
    const { saveCustomProfile, getProfile } = await import('../utils/profiles');
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    const saved = saveCustomProfile('Test', 'Desc', config);
    const loaded = getProfile(saved.id);
    expect(loaded).toBeDefined();
    expect(loaded?.config.topology).toBe('enterprise');
  });

  it('profile YAML export/import round trip', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    const yaml = configToYAML(config);
    const parsed = yamlToConfig(yaml);
    expect(parsed.topology).toBe(config.topology);
  });

  it('diffing two preset profiles shows meaningful differences', () => {
    const dev = PRESET_PROFILES.find((p) => p.name === 'Development')!;
    const ha = PRESET_PROFILES.find((p) => p.name === 'Production HA')!;
    const base = getDefaultConfig();
    const devApplied = applyProfile(dev, base);
    const haApplied = applyProfile(ha, base);
    const diffs = diffConfigs(devApplied, haApplied);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.path === 'topology')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crypto integration (5 tests)
// ---------------------------------------------------------------------------
describe('Crypto integration', () => {
  it('generated passwords pass strength validation', () => {
    for (let i = 0; i < 5; i++) {
      const pw = generatePassword(24);
      expect(validatePasswordStrength(pw)).toBeNull();
    }
  });

  it('generated UUIDs are unique across 100 generations', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });

  it('base64 round-trip preserves special characters', () => {
    const special = '<script>alert("xss")</script>';
    expect(fromBase64(toBase64(special))).toBe(special);
  });

  it('sanitize then format preserves meaning', () => {
    const input = 'hello & world';
    const sanitized = sanitizeInput(input);
    expect(sanitized).toContain('hello');
    expect(sanitized).toContain('world');
  });

  it('multiple password generation produces no duplicates', () => {
    const passwords = generatePasswords(50);
    expect(new Set(passwords).size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Formatter integration (5 tests)
// ---------------------------------------------------------------------------
describe('Formatter integration', () => {
  it('duration formatting produces correct output for known inputs', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(61000)).toBe('1m 1s');
  });

  it('byte formatting covers all units', () => {
    expect(formatBytes(0)).toContain('B');
    expect(formatBytes(1024)).toContain('KB');
    expect(formatBytes(1024 * 1024)).toContain('MB');
    expect(formatBytes(1024 * 1024 * 1024)).toContain('GB');
  });

  it('deep clone then deep equal returns true', () => {
    const obj = { a: 1, b: { c: 2 }, d: [3, 4] };
    const cloned = deepClone(obj);
    expect(deepEqual(obj, cloned)).toBe(true);
  });

  it('deep clone then modify then deep equal returns false', () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = deepClone(obj);
    (cloned as any).b.c = 999;
    expect(deepEqual(obj, cloned)).toBe(false);
  });

  it('slugify then capitalize produces consistent results', () => {
    const input = 'hello world';
    const slug = slugify(input);
    const capped = capitalize(slug);
    expect(slug).toBe('hello-world');
    expect(capped).toBe('Hello-world');
  });
});
