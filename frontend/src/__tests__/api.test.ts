import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  healthCheck,
  runPreflight,
  generateInventory,
  validateInventory,
  startDeploy,
  getDeployStatus,
  cancelDeploy,
  getPlatformHealth,
  getProfiles,
  createProfile,
  deleteProfile,
  getAuditLog,
  getAuditStats,
  getBackups,
  createBackup,
  restoreBackup,
  generateCertificate,
  validateCertificate,
  getNotificationConfig,
  updateNotificationConfig,
  generateReport,
  validateConfig,
} from '../api';
import { getDefaultConfig } from '../types';

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function mockResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockError(message: string) {
  mockFetch.mockRejectedValueOnce(new Error(message));
}

// ---------------------------------------------------------------------------
// healthCheck (3 tests)
// ---------------------------------------------------------------------------
describe('healthCheck', () => {
  it('success returns { status: "ok" }', async () => {
    mockResponse({ status: 'ok' });
    const result = await healthCheck();
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws on network error', async () => {
    mockError('Network error');
    await expect(healthCheck()).rejects.toThrow(/Network error/);
  });

  it('throws on timeout', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(err);
    await expect(healthCheck()).rejects.toThrow(/timed out/);
  });
});

// ---------------------------------------------------------------------------
// runPreflight (3 tests)
// ---------------------------------------------------------------------------
describe('runPreflight', () => {
  it('success with result', async () => {
    const result = { overall: 'passed' as const, checks: [] };
    mockResponse(result);
    const res = await runPreflight([], 'growth', 'online');
    expect(res.overall).toBe('passed');
  });

  it('throws on API error', async () => {
    mockResponse({ detail: 'Bad request' }, 400);
    await expect(runPreflight([], 'growth', 'online')).rejects.toThrow();
  });

  it('handles invalid response shape', async () => {
    mockResponse({ unexpected: true });
    const res = await runPreflight([], 'growth', 'online');
    expect(res).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// generateInventory (3 tests)
// ---------------------------------------------------------------------------
describe('generateInventory', () => {
  it('success returns inventory string', async () => {
    mockResponse({ inventory: 'all:\n  hosts:\n    aap.example.org:' });
    const res = await generateInventory(getDefaultConfig());
    expect(res.inventory).toContain('all:');
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Config invalid' }, 500);
    await expect(generateInventory(getDefaultConfig())).rejects.toThrow();
  });

  it('returns string content', async () => {
    mockResponse({ inventory: 'inventory content' });
    const res = await generateInventory(getDefaultConfig());
    expect(typeof res.inventory).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// validateInventory (3 tests)
// ---------------------------------------------------------------------------
describe('validateInventory', () => {
  it('valid config returns valid true', async () => {
    mockResponse({ valid: true, errors: [] });
    const res = await validateInventory(getDefaultConfig());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('invalid config returns errors', async () => {
    mockResponse({ valid: false, errors: ['Missing hosts'] });
    const res = await validateInventory(getDefaultConfig());
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Missing hosts');
  });

  it('throws on API error', async () => {
    mockResponse({}, 500);
    await expect(validateInventory(getDefaultConfig())).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// startDeploy (3 tests)
// ---------------------------------------------------------------------------
describe('startDeploy', () => {
  it('returns session_id', async () => {
    mockResponse({ session_id: 'sess-123' });
    const res = await startDeploy(getDefaultConfig());
    expect(res.session_id).toBe('sess-123');
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Deploy failed' }, 500);
    await expect(startDeploy(getDefaultConfig())).rejects.toThrow();
  });

  it('sends config in body', async () => {
    mockResponse({ session_id: 'x' });
    await startDeploy(getDefaultConfig());
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/deploy/start'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// getDeployStatus (3 tests)
// ---------------------------------------------------------------------------
describe('getDeployStatus', () => {
  it('success returns status', async () => {
    mockResponse({
      session_id: 's1',
      status: 'running',
      current_phase: 'install',
      progress: 50,
      error: '',
      log_lines: [],
    });
    const res = await getDeployStatus('s1');
    expect(res.status).toBe('running');
    expect(res.progress).toBe(50);
  });

  it('404 for unknown session', async () => {
    mockResponse({ detail: 'Not found' }, 404);
    await expect(getDeployStatus('unknown')).rejects.toThrow();
  });

  it('returns log_lines', async () => {
    mockResponse({
      session_id: 's1',
      status: 'complete',
      current_phase: '',
      progress: 100,
      error: '',
      log_lines: ['line1', 'line2'],
    });
    const res = await getDeployStatus('s1');
    expect(res.log_lines).toEqual(['line1', 'line2']);
  });
});

// ---------------------------------------------------------------------------
// cancelDeploy (2 tests)
// ---------------------------------------------------------------------------
describe('cancelDeploy', () => {
  it('success', async () => {
    mockResponse({ status: 'cancelled' });
    await expect(cancelDeploy('s1')).resolves.not.toThrow();
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Cannot cancel' }, 400);
    await expect(cancelDeploy('s1')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getPlatformHealth (3 tests)
// ---------------------------------------------------------------------------
describe('getPlatformHealth', () => {
  it('success returns health object', async () => {
    mockResponse({
      overall: 'healthy',
      components: [],
      database: { status: 'ok', active_connections: 0, max_connections: 100, database_size: '1MB' },
      last_updated: Date.now(),
    });
    const res = await getPlatformHealth();
    expect(res.overall).toBe('healthy');
    expect(res.database).toBeDefined();
  });

  it('accepts gateway_url param', async () => {
    mockResponse({ overall: 'healthy', components: [], database: {}, last_updated: 0 });
    await getPlatformHealth('https://gateway.example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('gateway_url'),
      expect.any(Object)
    );
  });

  it('maps snake_case to camelCase', async () => {
    mockResponse({
      overall: 'ok',
      components: [{ container_state: 'running', api_latency_ms: 10 }],
      database: { status: 'ok', active_connections: 0, max_connections: 0, database_size: '' },
      last_updated: 0,
    });
    const res = await getPlatformHealth();
    expect(res.components[0].containerState).toBe('running');
    expect(res.components[0].apiLatencyMs).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getProfiles (2 tests)
// ---------------------------------------------------------------------------
describe('getProfiles', () => {
  it('returns array', async () => {
    mockResponse({ profiles: [{ id: 'p1', name: 'Test' }] });
    const res = await getProfiles();
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no profiles', async () => {
    mockResponse({ profiles: [] });
    const res = await getProfiles();
    expect(res).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createProfile (2 tests)
// ---------------------------------------------------------------------------
describe('createProfile', () => {
  it('success returns profile', async () => {
    mockResponse({ id: 'p1', name: 'My Profile', description: '', category: '', topology: '', config: {}, tags: [], created_at: '', updated_at: '' });
    const res = await createProfile({
      name: 'My Profile',
      description: 'Test',
      config: getDefaultConfig(),
    });
    expect(res.name).toBe('My Profile');
  });

  it('throws on validation error', async () => {
    mockResponse({ detail: 'Name required' }, 400);
    await expect(
      createProfile({ name: '', description: '', config: getDefaultConfig() })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteProfile (2 tests)
// ---------------------------------------------------------------------------
describe('deleteProfile', () => {
  it('success', async () => {
    mockResponse({});
    await expect(deleteProfile('p1')).resolves.not.toThrow();
  });

  it('throws on 404', async () => {
    mockResponse({ detail: 'Not found' }, 404);
    await expect(deleteProfile('nonexistent')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getAuditLog (3 tests)
// ---------------------------------------------------------------------------
describe('getAuditLog', () => {
  it('with filters', async () => {
    mockResponse({ entries: [], count: 0 });
    await getAuditLog({ category: 'config', limit: 10 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/category=config/),
      expect.any(Object)
    );
  });

  it('without filters', async () => {
    mockResponse({ entries: [], count: 0 });
    const res = await getAuditLog();
    expect(res.entries).toEqual([]);
  });

  it('with pagination', async () => {
    mockResponse({ entries: [], count: 5 });
    await getAuditLog({ limit: 5, offset: 10 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/limit=5.*offset=10|offset=10.*limit=5/),
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// getBackups (2 tests)
// ---------------------------------------------------------------------------
describe('getBackups', () => {
  it('list returns backups', async () => {
    mockResponse({
      backups: [
        { id: 'b1', name: 'backup1', timestamp: 0, version: '1', contents: [], size_bytes: 0 },
      ],
    });
    const res = await getBackups();
    expect(res.length).toBe(1);
    expect(res[0].name).toBe('backup1');
  });

  it('empty when no backups', async () => {
    mockResponse({ backups: [] });
    const res = await getBackups();
    expect(res).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createBackup (2 tests)
// ---------------------------------------------------------------------------
describe('createBackup', () => {
  it('success returns manifest', async () => {
    mockResponse({
      id: 'b1',
      name: 'my-backup',
      timestamp: Date.now(),
      version: '1',
      contents: ['config'],
      size_bytes: 100,
    });
    const res = await createBackup({ name: 'my-backup', config: getDefaultConfig() });
    expect(res.name).toBe('my-backup');
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Failed' }, 500);
    await expect(createBackup({ name: 'x', config: getDefaultConfig() })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// restoreBackup (2 tests)
// ---------------------------------------------------------------------------
describe('restoreBackup', () => {
  it('success returns config', async () => {
    const config = getDefaultConfig();
    mockResponse({ config });
    const res = await restoreBackup('b1');
    expect(res).toEqual(config);
  });

  it('throws when no config in response', async () => {
    mockResponse({});
    await expect(restoreBackup('b1')).rejects.toThrow(/did not return config/);
  });
});

// ---------------------------------------------------------------------------
// generateCertificate (2 tests)
// ---------------------------------------------------------------------------
describe('generateCertificate', () => {
  it('success returns PEM strings', async () => {
    mockResponse({
      ca_cert: '-----BEGIN CERTIFICATE-----',
      server_cert: '-----BEGIN CERTIFICATE-----',
      server_key: '-----BEGIN PRIVATE KEY-----',
    });
    const res = await generateCertificate(['aap.example.com']);
    expect(res.ca_pem).toContain('BEGIN');
    expect(res.cert_pem).toContain('BEGIN');
    expect(res.key_pem).toContain('BEGIN');
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Invalid hostname' }, 400);
    await expect(generateCertificate([])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateCertificate (2 tests)
// ---------------------------------------------------------------------------
describe('validateCertificate', () => {
  it('valid returns isValid true', async () => {
    mockResponse({ is_valid: true, errors: [], warnings: [] });
    const res = await validateCertificate({ cert_pem: '-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----' });
    expect(res.isValid).toBe(true);
  });

  it('invalid returns errors', async () => {
    mockResponse({ is_valid: false, errors: ['Expired'], warnings: [] });
    const res = await validateCertificate({ cert_pem: 'invalid' });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Expired');
  });
});

// ---------------------------------------------------------------------------
// getNotificationConfig / updateNotificationConfig (2 tests)
// ---------------------------------------------------------------------------
describe('getNotificationConfig', () => {
  it('returns config', async () => {
    mockResponse({ webhook_url: '', enabled: false, events: [] });
    const res = await getNotificationConfig();
    expect(res).toHaveProperty('webhookUrl');
    expect(res).toHaveProperty('enabled');
  });
});

describe('updateNotificationConfig', () => {
  it('succeeds', async () => {
    mockResponse({});
    await expect(
      updateNotificationConfig({ webhookUrl: 'https://x.com', enabled: true, events: [] })
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateReport (2 tests)
// ---------------------------------------------------------------------------
describe('generateReport', () => {
  it('success returns report string', async () => {
    mockResponse({ report: '# Pre-deploy Report\n\nSummary...' });
    const res = await generateReport('pre-deploy', getDefaultConfig());
    expect(typeof res).toBe('string');
    expect(res).toContain('Report');
  });

  it('throws on error', async () => {
    mockResponse({ detail: 'Failed' }, 500);
    await expect(generateReport('config', getDefaultConfig())).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateConfig (3 tests)
// ---------------------------------------------------------------------------
describe('validateConfig', () => {
  it('valid returns high score', async () => {
    mockResponse({ valid: true, errors: [], warnings: [], score: 100 });
    const res = await validateConfig(getDefaultConfig());
    expect(res.valid).toBe(true);
    expect(res.score).toBe(100);
  });

  it('errors present when invalid', async () => {
    mockResponse({
      valid: false,
      errors: [{ field: 'topology', message: 'Required', severity: 'error', category: 'general' }],
      warnings: [],
      score: 50,
    });
    const res = await validateConfig(getDefaultConfig());
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('warnings included', async () => {
    mockResponse({
      valid: true,
      errors: [],
      warnings: ['Consider stronger password'],
      score: 90,
    });
    const res = await validateConfig(getDefaultConfig());
    expect(res.warnings).toContain('Consider stronger password');
  });
});
