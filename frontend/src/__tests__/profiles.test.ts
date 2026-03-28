import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRESET_PROFILES,
  getProfiles,
  getProfile,
  saveCustomProfile,
  deleteCustomProfile,
  applyProfile,
  diffConfigs,
  configToYAML,
  yamlToConfig,
} from '../utils/profiles';
import { getDefaultConfig } from '../types';
import type { DeploymentConfig } from '../types';

const STORAGE_KEY = 'aap-wizard-profiles';

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// PRESET_PROFILES
// ---------------------------------------------------------------------------
describe('PRESET_PROFILES', () => {
  it('contains at least 4 presets', () => {
    expect(PRESET_PROFILES.length).toBeGreaterThanOrEqual(4);
  });

  it('every preset has required fields', () => {
    for (const profile of PRESET_PROFILES) {
      expect(profile.id).toBeTruthy();
      expect(profile.name).toBeTruthy();
      expect(profile.description).toBeTruthy();
      expect(profile.category).toBe('preset');
      expect(['growth', 'enterprise']).toContain(profile.topology);
      expect(profile.config).toBeTruthy();
      expect(Array.isArray(profile.tags)).toBe(true);
      expect(profile.createdAt).toBeTruthy();
      expect(profile.updatedAt).toBeTruthy();
    }
  });

  it('every preset has a unique id', () => {
    const ids = PRESET_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has a unique name', () => {
    const names = PRESET_PROFILES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes Development preset', () => {
    expect(PRESET_PROFILES.some((p) => p.name === 'Development')).toBe(true);
  });

  it('includes Production HA preset', () => {
    expect(PRESET_PROFILES.some((p) => p.name === 'Production HA')).toBe(true);
  });

  it('includes Air-Gapped preset', () => {
    expect(PRESET_PROFILES.some((p) => p.name === 'Air-Gapped')).toBe(true);
  });

  it('development preset uses growth topology', () => {
    const dev = PRESET_PROFILES.find((p) => p.name === 'Development');
    expect(dev?.topology).toBe('growth');
    expect(dev?.config.topology).toBe('growth');
  });

  it('Production HA preset uses enterprise topology', () => {
    const ha = PRESET_PROFILES.find((p) => p.name === 'Production HA');
    expect(ha?.topology).toBe('enterprise');
    expect(ha?.config.topology).toBe('enterprise');
  });

  it('Air-Gapped preset uses disconnected installation', () => {
    const ag = PRESET_PROFILES.find((p) => p.name === 'Air-Gapped');
    expect(ag?.config.installation_type).toBe('disconnected');
    expect(ag?.config.bundle_dir).toBeTruthy();
  });

  it('HA preset has multiple hosts per component', () => {
    const ha = PRESET_PROFILES.find((p) => p.name === 'Production HA');
    expect(ha?.config.gateway?.hosts?.length).toBeGreaterThanOrEqual(2);
    expect(ha?.config.controller?.hosts?.length).toBeGreaterThanOrEqual(2);
  });

  it('HA preset uses external database', () => {
    const ha = PRESET_PROFILES.find((p) => p.name === 'Production HA');
    expect(ha?.config.database?.type).toBe('external');
  });

  it('HA preset uses redis cluster', () => {
    const ha = PRESET_PROFILES.find((p) => p.name === 'Production HA');
    expect(ha?.config.redis_mode).toBe('cluster');
  });
});

// ---------------------------------------------------------------------------
// getProfiles / getProfile
// ---------------------------------------------------------------------------
describe('getProfiles', () => {
  it('returns all presets when no custom profiles exist', () => {
    const profiles = getProfiles();
    expect(profiles.length).toBe(PRESET_PROFILES.length);
  });

  it('includes custom profiles from localStorage', () => {
    const custom = [
      {
        id: 'custom-1',
        name: 'My Custom',
        description: 'test',
        category: 'custom',
        icon: 'user',
        topology: 'growth',
        config: {},
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    const profiles = getProfiles();
    expect(profiles.length).toBe(PRESET_PROFILES.length + 1);
  });

  it('handles malformed localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json!!!');
    const profiles = getProfiles();
    expect(profiles.length).toBe(PRESET_PROFILES.length);
  });
});

describe('getProfile', () => {
  it('finds preset by id', () => {
    const dev = getProfile('preset-development');
    expect(dev).toBeDefined();
    expect(dev?.name).toBe('Development');
  });

  it('returns undefined for non-existent id', () => {
    expect(getProfile('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// saveCustomProfile / deleteCustomProfile
// ---------------------------------------------------------------------------
describe('saveCustomProfile', () => {
  it('saves and can be retrieved', () => {
    const config = getDefaultConfig();
    const saved = saveCustomProfile('Test Profile', 'A test', config);

    expect(saved.id).toMatch(/^profile-/);
    expect(saved.name).toBe('Test Profile');
    expect(saved.category).toBe('custom');
    expect(saved.createdAt).toBeTruthy();

    const retrieved = getProfile(saved.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Test Profile');
  });

  it('preserves config data deeply', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.gateway.hosts = ['gw1.example.com', 'gw2.example.com'];

    const saved = saveCustomProfile('Enterprise', 'HA setup', config);
    const retrieved = getProfile(saved.id);
    expect(retrieved?.config.topology).toBe('enterprise');
    expect((retrieved?.config as DeploymentConfig).gateway.hosts).toEqual([
      'gw1.example.com',
      'gw2.example.com',
    ]);
  });

  it('allows multiple custom profiles', () => {
    const config = getDefaultConfig();
    saveCustomProfile('Profile 1', 'First', config);
    saveCustomProfile('Profile 2', 'Second', config);
    saveCustomProfile('Profile 3', 'Third', config);

    const profiles = getProfiles();
    const custom = profiles.filter((p) => p.category === 'custom');
    expect(custom.length).toBe(3);
  });
});

describe('deleteCustomProfile', () => {
  it('removes a custom profile', () => {
    const config = getDefaultConfig();
    const saved = saveCustomProfile('To Delete', 'Will be deleted', config);
    expect(getProfile(saved.id)).toBeDefined();

    deleteCustomProfile(saved.id);
    expect(getProfile(saved.id)).toBeUndefined();
  });

  it('does not affect other profiles', () => {
    const config = getDefaultConfig();
    const kept = saveCustomProfile('Keep', 'Stays', config);
    const removed = saveCustomProfile('Remove', 'Goes', config);

    deleteCustomProfile(removed.id);
    expect(getProfile(kept.id)).toBeDefined();
    expect(getProfile(removed.id)).toBeUndefined();
  });

  it('no-ops for non-existent id', () => {
    deleteCustomProfile('does-not-exist');
    expect(getProfiles().length).toBe(PRESET_PROFILES.length);
  });
});

// ---------------------------------------------------------------------------
// applyProfile
// ---------------------------------------------------------------------------
describe('applyProfile', () => {
  it('merges profile config into current config', () => {
    const current = getDefaultConfig();
    const devProfile = PRESET_PROFILES.find((p) => p.name === 'Development')!;
    const result = applyProfile(devProfile, current);

    expect(result.topology).toBe('growth');
    expect(result.gateway.hosts).toEqual(['localhost']);
  });

  it('does not mutate current config', () => {
    const current = getDefaultConfig();
    const originalHost = current.gateway.hosts[0];
    const devProfile = PRESET_PROFILES.find((p) => p.name === 'Development')!;

    applyProfile(devProfile, current);
    expect(current.gateway.hosts[0]).toBe(originalHost);
  });

  it('deep merges nested objects', () => {
    const current = getDefaultConfig();
    const haProfile = PRESET_PROFILES.find((p) => p.name === 'Production HA')!;
    const result = applyProfile(haProfile, current);

    expect(result.database.type).toBe('external');
    expect(result.database.host).toBe('db.example.com');
    expect(result.topology).toBe('enterprise');
  });

  it('replaces arrays entirely', () => {
    const current = getDefaultConfig();
    current.gateway.hosts = ['old-host.com'];

    const haProfile = PRESET_PROFILES.find((p) => p.name === 'Production HA')!;
    const result = applyProfile(haProfile, current);

    expect(result.gateway.hosts).toEqual(['gw-1.example.com', 'gw-2.example.com']);
    expect(result.gateway.hosts).not.toContain('old-host.com');
  });

  it('preserves fields not in profile config', () => {
    const current = getDefaultConfig();
    current.target_user = 'customuser';

    const devProfile = PRESET_PROFILES.find((p) => p.name === 'Development')!;
    const result = applyProfile(devProfile, current);
    expect(result.target_user).toBe('customuser');
  });
});

// ---------------------------------------------------------------------------
// diffConfigs
// ---------------------------------------------------------------------------
describe('diffConfigs', () => {
  it('returns empty for identical configs', () => {
    const config = getDefaultConfig();
    const diffs = diffConfigs(config, config);
    expect(diffs.length).toBe(0);
  });

  it('detects topology change', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.topology = 'growth';

    const diffs = diffConfigs(a, b);
    const topDiff = diffs.find((d) => d.path === 'topology');
    expect(topDiff).toBeDefined();
    expect(topDiff?.oldValue).toBe('enterprise');
    expect(topDiff?.newValue).toBe('growth');
  });

  it('detects nested database changes', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.database.type = 'external';
    b.database.host = 'db.example.com';

    const diffs = diffConfigs(a, b);
    expect(diffs.some((d) => d.path === 'database.type')).toBe(true);
    expect(diffs.some((d) => d.path === 'database.host')).toBe(true);
  });

  it('detects array changes (hosts)', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.gateway.hosts = ['gw1.example.com', 'gw2.example.com'];

    const diffs = diffConfigs(a, b);
    const hostDiff = diffs.find((d) => d.path === 'gateway.hosts');
    expect(hostDiff).toBeDefined();
  });

  it('provides human-readable labels', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.topology = 'growth';

    const diffs = diffConfigs(a, b);
    const topDiff = diffs.find((d) => d.path === 'topology');
    expect(topDiff?.label).toBe('Deployment Topology');
  });

  it('assigns categories from FIELD_LABELS', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    b.database.port = 5433;

    const diffs = diffConfigs(a, b);
    const portDiff = diffs.find((d) => d.path === 'database.port');
    expect(portDiff?.category).toBe('Database');
  });
});

// ---------------------------------------------------------------------------
// configToYAML / yamlToConfig
// ---------------------------------------------------------------------------
describe('configToYAML', () => {
  it('starts with document marker', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml.startsWith('---\n')).toBe(true);
  });

  it('includes topology', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml).toContain('topology: enterprise');
  });

  it('includes nested database config', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml).toContain('database:');
    expect(yaml).toContain('type: managed');
  });

  it('includes array items with dash prefix', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml).toContain('- aap.example.org');
  });

  it('represents booleans as true/false', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml).toContain('eula_accepted: false');
  });

  it('represents empty strings as ""', () => {
    const yaml = configToYAML(getDefaultConfig());
    expect(yaml).toContain('""');
  });

  it('represents empty arrays as []', () => {
    const config = getDefaultConfig();
    config.execution_nodes = [];
    const yaml = configToYAML(config);
    expect(yaml).toContain('execution_nodes: []');
  });
});

describe('yamlToConfig', () => {
  it('round-trips default config (key values preserved)', () => {
    const original = getDefaultConfig();
    const yaml = configToYAML(original);
    const parsed = yamlToConfig(yaml);

    expect(parsed.topology).toBe(original.topology);
    expect(parsed.installation_type).toBe(original.installation_type);
    expect(parsed.database.type).toBe(original.database.type);
    expect(parsed.database.port).toBe(original.database.port);
    expect(parsed.network.http_port).toBe(original.network.http_port);
  });

  it('parses booleans correctly', () => {
    const original = getDefaultConfig();
    original.eula_accepted = true;
    original.dry_run = true;
    const yaml = configToYAML(original);
    const parsed = yamlToConfig(yaml);

    expect(parsed.eula_accepted).toBe(true);
    expect(parsed.dry_run).toBe(true);
  });

  it('parses numbers correctly', () => {
    const original = getDefaultConfig();
    const yaml = configToYAML(original);
    const parsed = yamlToConfig(yaml);

    expect(typeof parsed.database.port).toBe('number');
    expect(typeof parsed.network.http_port).toBe('number');
  });

  it('handles empty config gracefully', () => {
    const yaml = '---\n';
    const parsed = yamlToConfig(yaml);
    expect(parsed.topology).toBeDefined();
  });

  it('ignores comments', () => {
    const yaml = '---\n# comment\ntopology: enterprise\n';
    const parsed = yamlToConfig(yaml);
    expect(parsed.topology).toBe('enterprise');
  });

  it('parses array of strings', () => {
    const original = getDefaultConfig();
    original.gateway.hosts = ['host1.com', 'host2.com'];
    const yaml = configToYAML(original);
    const parsed = yamlToConfig(yaml);
    expect(parsed.gateway.hosts).toEqual(['host1.com', 'host2.com']);
  });

  it('parses execution nodes (array of objects)', () => {
    const original = getDefaultConfig();
    original.execution_nodes = [
      { host: 'exec1.com', receptor_type: 'execution' },
      { host: 'hop1.com', receptor_type: 'hop' },
    ];
    const yaml = configToYAML(original);
    const parsed = yamlToConfig(yaml);
    expect(parsed.execution_nodes.length).toBe(2);
    expect(parsed.execution_nodes[0].host).toBe('exec1.com');
    expect(parsed.execution_nodes[1].receptor_type).toBe('hop');
  });
});
