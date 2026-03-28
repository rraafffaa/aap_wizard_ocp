import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, getLocale } from '../i18n';
import { en } from '../i18n/en';

beforeEach(() => {
  setLocale('en');
});

// ---------------------------------------------------------------------------
// Locale management
// ---------------------------------------------------------------------------
describe('getLocale / setLocale', () => {
  it('defaults to "en"', () => {
    expect(getLocale()).toBe('en');
  });

  it('returns current locale after set', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
  });

  it('ignores unsupported locale', () => {
    setLocale('xx');
    expect(getLocale()).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// Simple key resolution
// ---------------------------------------------------------------------------
describe('t — simple keys', () => {
  it('resolves top-level nested key', () => {
    expect(t('common.next')).toBe('Next');
  });

  it('resolves common.back', () => {
    expect(t('common.back')).toBe('Back');
  });

  it('resolves common.cancel', () => {
    expect(t('common.cancel')).toBe('Cancel');
  });

  it('resolves common.save', () => {
    expect(t('common.save')).toBe('Save');
  });

  it('resolves common.loading', () => {
    expect(t('common.loading')).toBe('Loading...');
  });
});

// ---------------------------------------------------------------------------
// Nested key resolution
// ---------------------------------------------------------------------------
describe('t — nested keys', () => {
  it('resolves app.title', () => {
    expect(t('app.title')).toBe('AAP Deployment Wizard');
  });

  it('resolves app.subtitle', () => {
    expect(t('app.subtitle')).toBe('Ansible Automation Platform');
  });

  it('resolves steps.welcome', () => {
    expect(t('steps.welcome')).toBe('Welcome');
  });

  it('resolves steps.deploy', () => {
    expect(t('steps.deploy')).toBe('Deploy');
  });

  it('resolves eula.title', () => {
    expect(t('eula.title')).toBe('End User License Agreement');
  });

  it('resolves topology.growth', () => {
    expect(t('topology.growth')).toBe('Growth (Single-Node)');
  });

  it('resolves topology.enterprise', () => {
    expect(t('topology.enterprise')).toBe('Enterprise (HA)');
  });

  it('resolves database.managed', () => {
    expect(t('database.managed')).toBe('Managed (Installer-Managed)');
  });

  it('resolves database.external', () => {
    expect(t('database.external')).toBe('External (Pre-Provisioned)');
  });

  it('resolves validation.passwordWeak', () => {
    expect(t('validation.passwordWeak')).toBe('Password is too weak');
  });

  it('resolves deploy.success', () => {
    expect(t('deploy.success')).toBe('Deployment completed successfully');
  });
});

// ---------------------------------------------------------------------------
// Parameter interpolation
// ---------------------------------------------------------------------------
describe('t — parameter interpolation', () => {
  it('replaces {version} in app.version', () => {
    expect(t('app.version', { version: '2.5' })).toBe('Version 2.5');
  });

  it('replaces {min} and {max} in validation.portRange', () => {
    expect(t('validation.portRange', { min: '1', max: '65535' })).toBe(
      'Port must be between 1 and 65535',
    );
  });

  it('replaces {current} and {total} in deploy.phase', () => {
    expect(t('deploy.phase', { current: 2, total: 5 })).toBe('Phase 2 of 5');
  });

  it('leaves string unchanged when no params match', () => {
    expect(t('common.next', { unknown: 'value' })).toBe('Next');
  });

  it('replaces all occurrences of same param', () => {
    expect(t('deploy.phase', { current: 1, total: 1 })).toBe('Phase 1 of 1');
  });
});

// ---------------------------------------------------------------------------
// Missing key handling
// ---------------------------------------------------------------------------
describe('t — missing keys', () => {
  it('returns the key string for unknown key', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('returns key for deeply nested missing key', () => {
    expect(t('a.b.c.d.e')).toBe('a.b.c.d.e');
  });

  it('returns key for partial path (resolves to object, not string)', () => {
    expect(t('common')).toBe('common');
  });

  it('returns key for empty string', () => {
    expect(t('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Locale data integrity
// ---------------------------------------------------------------------------
describe('en locale structure', () => {
  it('has all expected top-level sections', () => {
    expect(en.app).toBeDefined();
    expect(en.steps).toBeDefined();
    expect(en.common).toBeDefined();
    expect(en.eula).toBeDefined();
    expect(en.topology).toBeDefined();
    expect(en.database).toBeDefined();
    expect(en.validation).toBeDefined();
    expect(en.deploy).toBeDefined();
  });

  it('steps section covers all wizard steps', () => {
    const expectedSteps = [
      'welcome', 'eula', 'subscription', 'topology', 'hosts',
      'components', 'database', 'network', 'credentials',
      'preflight', 'review', 'deploy', 'complete',
    ];
    for (const step of expectedSteps) {
      expect(en.steps[step]).toBeDefined();
      expect(typeof en.steps[step]).toBe('string');
    }
  });

  it('has no empty string values (recursive check)', () => {
    function checkNoEmpty(obj: Record<string, any>, path: string): void {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = `${path}.${key}`;
        if (typeof value === 'string') {
          expect(value.length, `${fullPath} should not be empty`).toBeGreaterThan(0);
        } else if (typeof value === 'object' && value !== null) {
          checkNoEmpty(value, fullPath);
        }
      }
    }
    checkNoEmpty(en, 'en');
  });

  it('all leaf values are strings', () => {
    function checkLeaves(obj: Record<string, any>, path: string): void {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = `${path}.${key}`;
        if (typeof value === 'object' && value !== null) {
          checkLeaves(value, fullPath);
        } else {
          expect(typeof value, `${fullPath} should be a string`).toBe('string');
        }
      }
    }
    checkLeaves(en, 'en');
  });
});
