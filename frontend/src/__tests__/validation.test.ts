import { describe, it, expect } from 'vitest';
import {
  validateEulaStep,
  validateSubscriptionStep,
  validateTopologyStep,
  validateTargetStep,
  validateHostsStep,
  validateComponentsStep,
  validateDatabaseStep,
  validateNetworkStep,
  validateCredentialsStep,
  validateReviewStep,
  validateAllSteps,
  canProceed,
} from '../hooks/useValidation';
import { getDefaultConfig } from '../types';
import type { DeploymentConfig } from '../types';

function makeValidConfig(): DeploymentConfig {
  const config = getDefaultConfig();
  config.topology = 'growth';
  config.eula_accepted = true;
  config.registry.username = 'myuser';
  config.registry.password = 'mypass';
  config.target_host = 'aap-vm.example.com';
  config.target_user = 'aap';
  config.target_password = 'Adm1n!TargetPass99';
  config.target_ssh_port = 22;
  config.gateway.hosts = ['gw.example.com'];
  config.controller.hosts = ['ctrl.example.com'];
  config.hub.hosts = ['hub.example.com'];
  config.eda.hosts = ['eda.example.com'];
  config.database.admin_password = 'Str0ngDbP@ss!99';
  config.gateway.admin_password = 'G@tew4y!Pass99';
  config.gateway.pg_password = 'gw-db-pass';
  config.gateway.pg_database = 'gateway';
  config.gateway.pg_username = 'gateway';
  config.controller.admin_password = 'C0ntr0ll3r!P@ss';
  config.controller.pg_password = 'ctrl-db-pass';
  config.controller.pg_database = 'controller';
  config.controller.pg_username = 'controller';
  config.hub.admin_password = 'Hb!Adm1nP@ss99';
  config.hub.pg_password = 'hub-db-pass';
  config.hub.pg_database = 'hub';
  config.hub.pg_username = 'hub';
  config.eda.admin_password = 'Ed@!Adm1nP@ss9';
  config.eda.pg_password = 'eda-db-pass';
  config.eda.pg_database = 'eda';
  config.eda.pg_username = 'eda';
  config.network.http_port = 80;
  config.network.https_port = 443;
  config.network.receptor_port = 27199;
  return config;
}

// ---------------------------------------------------------------------------
// validateEulaStep
// ---------------------------------------------------------------------------
describe('validateEulaStep', () => {
  it('errors when EULA not accepted', () => {
    const config = getDefaultConfig();
    const errors = validateEulaStep(config);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe('eula_accepted');
    expect(errors[0].severity).toBe('error');
  });

  it('passes when EULA accepted', () => {
    const config = getDefaultConfig();
    config.eula_accepted = true;
    expect(validateEulaStep(config)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateSubscriptionStep
// ---------------------------------------------------------------------------
describe('validateSubscriptionStep', () => {
  describe('online installation', () => {
    it('errors when registry username is empty', () => {
      const config = getDefaultConfig();
      const errors = validateSubscriptionStep(config);
      expect(errors.some((e) => e.field === 'registry.username')).toBe(true);
    });

    it('errors when registry password is empty', () => {
      const config = getDefaultConfig();
      const errors = validateSubscriptionStep(config);
      expect(errors.some((e) => e.field === 'registry.password')).toBe(true);
    });

    it('passes with valid registry credentials', () => {
      const config = getDefaultConfig();
      config.registry.username = 'user';
      config.registry.password = 'pass';
      expect(validateSubscriptionStep(config)).toHaveLength(0);
    });
  });

  describe('disconnected installation', () => {
    it('errors when bundle_dir is empty', () => {
      const config = getDefaultConfig();
      config.installation_type = 'disconnected';
      const errors = validateSubscriptionStep(config);
      expect(errors.some((e) => e.field === 'bundle_dir')).toBe(true);
    });

    it('errors when bundle_dir is not absolute path', () => {
      const config = getDefaultConfig();
      config.installation_type = 'disconnected';
      config.bundle_dir = 'relative/path';
      const errors = validateSubscriptionStep(config);
      expect(errors.some((e) => e.field === 'bundle_dir')).toBe(true);
    });

    it('passes with valid bundle_dir', () => {
      const config = getDefaultConfig();
      config.installation_type = 'disconnected';
      config.bundle_dir = '/opt/aap-bundle';
      expect(validateSubscriptionStep(config)).toHaveLength(0);
    });

    it('does not require registry credentials when disconnected', () => {
      const config = getDefaultConfig();
      config.installation_type = 'disconnected';
      config.bundle_dir = '/opt/aap-bundle';
      const errors = validateSubscriptionStep(config);
      expect(errors.some((e) => e.field === 'registry.username')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// validateTopologyStep
// ---------------------------------------------------------------------------
describe('validateTopologyStep', () => {
  it('passes with default config (topology and type set)', () => {
    const config = getDefaultConfig();
    expect(validateTopologyStep(config)).toHaveLength(0);
  });

  it('errors when topology is empty', () => {
    const config = getDefaultConfig();
    (config as any).topology = '';
    const errors = validateTopologyStep(config);
    expect(errors.some((e) => e.field === 'topology')).toBe(true);
  });

  it('errors when installation_type is empty', () => {
    const config = getDefaultConfig();
    (config as any).installation_type = '';
    const errors = validateTopologyStep(config);
    expect(errors.some((e) => e.field === 'installation_type')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateHostsStep
// ---------------------------------------------------------------------------
describe('validateHostsStep', () => {
  it('passes for growth topology with default host mapping', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    const errors = validateHostsStep(config);
    const hard = errors.filter((e) => e.severity === 'error');
    expect(hard).toHaveLength(0);
  });

  it('errors when gateway has no hosts', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = [];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field === 'gateway.hosts')).toBe(true);
  });

  it('errors when controller has no hosts', () => {
    const config = getDefaultConfig();
    config.controller.hosts = [];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field === 'controller.hosts')).toBe(true);
  });

  it('errors when hub has no hosts', () => {
    const config = getDefaultConfig();
    config.hub.hosts = [];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field === 'hub.hosts')).toBe(true);
  });

  it('errors when eda has no hosts', () => {
    const config = getDefaultConfig();
    config.eda.hosts = [];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field === 'eda.hosts')).toBe(true);
  });

  it('validates individual host entries', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['---invalid---'];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field === 'gateway.hosts.0')).toBe(true);
  });

  describe('enterprise topology', () => {
    it('requires at least 2 gateway hosts', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      config.gateway.hosts = ['gw1.example.com'];
      config.controller.hosts = ['c1.example.com', 'c2.example.com'];
      config.hub.hosts = ['h1.example.com', 'h2.example.com'];
      config.eda.hosts = ['e1.example.com', 'e2.example.com'];
      const errors = validateHostsStep(config);
      expect(errors.some((e) => e.message.includes('at least 2 gateway hosts'))).toBe(true);
    });

    it('requires at least 2 controller hosts', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      config.gateway.hosts = ['g1.example.com', 'g2.example.com'];
      config.controller.hosts = ['ctrl.example.com'];
      config.hub.hosts = ['h1.example.com', 'h2.example.com'];
      config.eda.hosts = ['e1.example.com', 'e2.example.com'];
      const errors = validateHostsStep(config);
      expect(errors.some((e) => e.message.includes('at least 2 controller hosts'))).toBe(true);
    });

    it('requires at least 2 hub hosts', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      config.gateway.hosts = ['g1.example.com', 'g2.example.com'];
      config.controller.hosts = ['c1.example.com', 'c2.example.com'];
      config.hub.hosts = ['hub.example.com'];
      config.eda.hosts = ['e1.example.com', 'e2.example.com'];
      const errors = validateHostsStep(config);
      expect(errors.some((e) => e.message.includes('at least 2 hub hosts'))).toBe(true);
    });

    it('requires at least 2 EDA hosts', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      config.gateway.hosts = ['g1.example.com', 'g2.example.com'];
      config.controller.hosts = ['c1.example.com', 'c2.example.com'];
      config.hub.hosts = ['h1.example.com', 'h2.example.com'];
      config.eda.hosts = ['eda.example.com'];
      const errors = validateHostsStep(config);
      expect(errors.some((e) => e.message.includes('at least 2 EDA hosts'))).toBe(true);
    });

    it('detects duplicate hosts across components', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      const host = 'shared.example.com';
      config.gateway.hosts = [host, 'gw2.example.com'];
      config.controller.hosts = [host, 'ctrl2.example.com'];
      config.hub.hosts = ['hub1.example.com', 'hub2.example.com'];
      config.eda.hosts = ['eda1.example.com', 'eda2.example.com'];
      const errors = validateHostsStep(config);
      expect(errors.some((e) => e.field === 'hosts')).toBe(true);
    });

    it('passes with fully valid enterprise hosts', () => {
      const config = getDefaultConfig();
      config.topology = 'enterprise';
      config.gateway.hosts = ['gw1.example.com', 'gw2.example.com'];
      config.controller.hosts = ['ctrl1.example.com', 'ctrl2.example.com'];
      config.hub.hosts = ['hub1.example.com', 'hub2.example.com'];
      config.eda.hosts = ['eda1.example.com', 'eda2.example.com'];
      const errors = validateHostsStep(config);
      const hard = errors.filter((e) => e.severity === 'error');
      expect(hard).toHaveLength(0);
    });
  });

  it('validates execution node hosts', () => {
    const config = getDefaultConfig();
    config.execution_nodes = [{ host: '', receptor_type: 'execution' }];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field.includes('execution_nodes'))).toBe(true);
  });

  it('validates execution node receptor type', () => {
    const config = getDefaultConfig();
    config.execution_nodes = [{ host: 'exec.example.com', receptor_type: '' as any }];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.message.includes('receptor type'))).toBe(true);
  });

  it('validates host inventory SSH port', () => {
    const config = getDefaultConfig();
    config.hosts = [
      { hostname: 'host.example.com', ip_address: '', ssh_user: 'root', ssh_port: 99999, ssh_key_path: '', ssh_password: '' },
    ];
    const errors = validateHostsStep(config);
    expect(errors.some((e) => e.field.includes('ssh_port'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateTargetStep
// ---------------------------------------------------------------------------
describe('validateTargetStep', () => {
  it('errors when target host is missing', () => {
    const config = getDefaultConfig();
    const errors = validateTargetStep(config);
    expect(errors.some((e) => e.field === 'target_host')).toBe(true);
  });

  it('passes with valid target credentials', () => {
    const config = makeValidConfig();
    const errors = validateTargetStep(config).filter((e) => e.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateComponentsStep
// ---------------------------------------------------------------------------
describe('validateComponentsStep', () => {
  it('passes with valid default config', () => {
    const config = getDefaultConfig();
    const errors = validateComponentsStep(config).filter((e) => e.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('errors when memory capacity is 0', () => {
    const config = getDefaultConfig();
    config.controller.percent_memory_capacity = 0;
    const errors = validateComponentsStep(config);
    expect(errors.some((e) => e.field === 'controller.percent_memory_capacity')).toBe(true);
  });

  it('errors when memory capacity exceeds 1', () => {
    const config = getDefaultConfig();
    config.controller.percent_memory_capacity = 1.5;
    const errors = validateComponentsStep(config);
    expect(errors.some((e) => e.field === 'controller.percent_memory_capacity')).toBe(true);
  });

  it('warns when enterprise topology uses non-cluster redis', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.redis_mode = 'standalone';
    const errors = validateComponentsStep(config);
    const redisWarn = errors.find((e) => e.field === 'redis_mode');
    expect(redisWarn).toBeDefined();
    expect(redisWarn?.severity).toBe('warning');
  });

  it('no redis warning for growth topology with standalone', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    config.redis_mode = 'standalone';
    const errors = validateComponentsStep(config);
    expect(errors.some((e) => e.field === 'redis_mode')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDatabaseStep
// ---------------------------------------------------------------------------
describe('validateDatabaseStep', () => {
  it('errors when admin password is empty', () => {
    const config = getDefaultConfig();
    const errors = validateDatabaseStep(config);
    expect(errors.some((e) => e.field === 'database.admin_password')).toBe(true);
  });

  describe('external database', () => {
    it('requires database host', () => {
      const config = getDefaultConfig();
      config.database.type = 'external';
      config.database.admin_password = 'pass';
      const errors = validateDatabaseStep(config);
      expect(errors.some((e) => e.field === 'database.host')).toBe(true);
    });

    it('validates database host format', () => {
      const config = getDefaultConfig();
      config.database.type = 'external';
      config.database.host = '---invalid---';
      config.database.admin_password = 'pass';
      const errors = validateDatabaseStep(config);
      expect(errors.some((e) => e.field === 'database.host')).toBe(true);
    });

    it('validates database port', () => {
      const config = getDefaultConfig();
      config.database.type = 'external';
      config.database.host = 'db.example.com';
      config.database.port = 0;
      config.database.admin_password = 'pass';
      const errors = validateDatabaseStep(config);
      expect(errors.some((e) => e.field === 'database.port')).toBe(true);
    });

    it('requires admin username', () => {
      const config = getDefaultConfig();
      config.database.type = 'external';
      config.database.host = 'db.example.com';
      config.database.admin_username = '';
      config.database.admin_password = 'pass';
      const errors = validateDatabaseStep(config);
      expect(errors.some((e) => e.field === 'database.admin_username')).toBe(true);
    });
  });

  it('requires pg_password for each component', () => {
    const config = getDefaultConfig();
    config.database.admin_password = 'pass';
    const errors = validateDatabaseStep(config);
    expect(errors.some((e) => e.field === 'gateway.pg_password')).toBe(true);
    expect(errors.some((e) => e.field === 'controller.pg_password')).toBe(true);
    expect(errors.some((e) => e.field === 'hub.pg_password')).toBe(true);
    expect(errors.some((e) => e.field === 'eda.pg_password')).toBe(true);
  });

  it('requires unique database names per component', () => {
    const config = getDefaultConfig();
    config.database.admin_password = 'pass';
    config.gateway.pg_password = 'p';
    config.controller.pg_password = 'p';
    config.hub.pg_password = 'p';
    config.eda.pg_password = 'p';
    config.gateway.pg_database = 'shared';
    config.controller.pg_database = 'shared';
    const errors = validateDatabaseStep(config);
    expect(errors.some((e) => e.message.includes('unique database name'))).toBe(true);
  });

  it('passes with fully valid database config', () => {
    const config = makeValidConfig();
    const errors = validateDatabaseStep(config).filter((e) => e.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateNetworkStep
// ---------------------------------------------------------------------------
describe('validateNetworkStep', () => {
  it('passes with default ports', () => {
    const config = getDefaultConfig();
    const errors = validateNetworkStep(config).filter((e) => e.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('errors on invalid HTTP port', () => {
    const config = getDefaultConfig();
    config.network.http_port = 0;
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.http_port' && e.severity === 'error')).toBe(true);
  });

  it('errors on invalid HTTPS port', () => {
    const config = getDefaultConfig();
    config.network.https_port = 70000;
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.https_port' && e.severity === 'error')).toBe(true);
  });

  it('errors on duplicate ports', () => {
    const config = getDefaultConfig();
    config.network.http_port = 443;
    config.network.https_port = 443;
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.ports')).toBe(true);
  });

  it('warns on reserved ports', () => {
    const config = getDefaultConfig();
    const errors = validateNetworkStep(config);
    const portWarnings = errors.filter(
      (e) => e.severity === 'warning' && e.message.includes('reserved range'),
    );
    expect(portWarnings.length).toBeGreaterThan(0);
  });

  it('warns when HTTPS is disabled', () => {
    const config = getDefaultConfig();
    config.network.tls.disable_https = true;
    const errors = validateNetworkStep(config);
    expect(
      errors.some((e) => e.field === 'network.tls.disable_https' && e.severity === 'warning'),
    ).toBe(true);
  });

  it('errors when cert provided without key', () => {
    const config = getDefaultConfig();
    config.network.tls.custom_server_cert = '-----BEGIN CERTIFICATE-----\ndata\n-----END CERTIFICATE-----';
    config.network.tls.custom_server_key = '';
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.tls.custom_server_key')).toBe(true);
  });

  it('errors when key provided without cert', () => {
    const config = getDefaultConfig();
    config.network.tls.custom_server_key = '-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----';
    config.network.tls.custom_server_cert = '';
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.tls.custom_server_cert')).toBe(true);
  });

  it('validates PEM format of custom cert', () => {
    const config = getDefaultConfig();
    config.network.tls.custom_server_cert = 'not-a-pem';
    config.network.tls.custom_server_key = 'not-a-pem';
    const errors = validateNetworkStep(config);
    expect(errors.some((e) => e.field === 'network.tls.custom_server_cert')).toBe(true);
  });

  it('skips TLS validation when HTTPS is disabled', () => {
    const config = getDefaultConfig();
    config.network.tls.disable_https = true;
    config.network.tls.custom_server_cert = 'garbage';
    const errors = validateNetworkStep(config);
    expect(
      errors.filter((e) => e.field === 'network.tls.custom_server_cert' && e.severity === 'error'),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateCredentialsStep
// ---------------------------------------------------------------------------
describe('validateCredentialsStep', () => {
  it('errors when admin passwords are empty', () => {
    const config = getDefaultConfig();
    const errors = validateCredentialsStep(config);
    expect(errors.some((e) => e.field === 'gateway.admin_password')).toBe(true);
    expect(errors.some((e) => e.field === 'controller.admin_password')).toBe(true);
    expect(errors.some((e) => e.field === 'hub.admin_password')).toBe(true);
    expect(errors.some((e) => e.field === 'eda.admin_password')).toBe(true);
  });

  it('validates password strength for admin passwords', () => {
    const config = getDefaultConfig();
    config.gateway.admin_password = 'weak';
    config.controller.admin_password = 'weak';
    config.hub.admin_password = 'weak';
    config.eda.admin_password = 'weak';
    const errors = validateCredentialsStep(config);
    const strengthErrors = errors.filter((e) => e.message.includes('Password needs'));
    expect(strengthErrors.length).toBe(4);
  });

  it('warns when admin passwords are reused', () => {
    const config = makeValidConfig();
    const sharedPw = config.gateway.admin_password;
    config.controller.admin_password = sharedPw;
    const errors = validateCredentialsStep(config);
    expect(errors.some((e) => e.field === 'admin_passwords' && e.severity === 'warning')).toBe(true);
  });

  it('passes with unique strong passwords', () => {
    const config = makeValidConfig();
    const errors = validateCredentialsStep(config).filter((e) => e.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('warns for weak target host password', () => {
    const config = makeValidConfig();
    config.target_password = 'weak';
    const errors = validateCredentialsStep(config);
    expect(errors.some((e) => e.field === 'target_password' && e.severity === 'warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateReviewStep
// ---------------------------------------------------------------------------
describe('validateReviewStep', () => {
  it('aggregates errors from all other steps', () => {
    const config = getDefaultConfig();
    const errors = validateReviewStep(config);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('[eula]'))).toBe(true);
    expect(errors.some((e) => e.message.includes('[subscription]'))).toBe(true);
  });

  it('returns no errors for fully valid config', () => {
    const config = makeValidConfig();
    const errors = validateReviewStep(config);
    expect(errors).toHaveLength(0);
  });

  it('prefixes errors with step name', () => {
    const config = getDefaultConfig();
    const errors = validateReviewStep(config);
    for (const err of errors) {
      expect(err.message).toMatch(/^\[/);
    }
  });

  it('excludes warnings (only reports errors)', () => {
    const config = makeValidConfig();
    config.network.tls.disable_https = true; // this triggers a warning
    const errors = validateReviewStep(config);
    expect(errors.some((e) => e.message.includes('disable_https'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAllSteps
// ---------------------------------------------------------------------------
describe('validateAllSteps', () => {
  it('returns a Map with entries for every step', () => {
    const config = getDefaultConfig();
    const result = validateAllSteps(config);
    expect(result.size).toBeGreaterThan(0);
    expect(result.has('eula')).toBe(true);
    expect(result.has('subscription')).toBe(true);
    expect(result.has('topology')).toBe(true);
    expect(result.has('target')).toBe(true);
    expect(result.has('hosts')).toBe(true);
    expect(result.has('components')).toBe(true);
    expect(result.has('database')).toBe(true);
    expect(result.has('network')).toBe(true);
    expect(result.has('credentials')).toBe(true);
    expect(result.has('review')).toBe(true);
  });

  it('each step has an array of ValidationError', () => {
    const config = getDefaultConfig();
    const result = validateAllSteps(config);
    for (const [, errors] of result) {
      expect(Array.isArray(errors)).toBe(true);
      for (const err of errors) {
        expect(err.field).toBeDefined();
        expect(err.message).toBeDefined();
        expect(['error', 'warning']).toContain(err.severity);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// canProceed
// ---------------------------------------------------------------------------
describe('canProceed', () => {
  it('blocks eula step when not accepted', () => {
    const config = getDefaultConfig();
    expect(canProceed('eula', config)).toBe(false);
  });

  it('allows eula step when accepted', () => {
    const config = getDefaultConfig();
    config.eula_accepted = true;
    expect(canProceed('eula', config)).toBe(true);
  });

  it('blocks subscription step without credentials (online)', () => {
    const config = getDefaultConfig();
    expect(canProceed('subscription', config)).toBe(false);
  });

  it('allows subscription step with valid credentials', () => {
    const config = getDefaultConfig();
    config.registry.username = 'user';
    config.registry.password = 'pass';
    expect(canProceed('subscription', config)).toBe(true);
  });

  it('allows topology step with default config', () => {
    const config = getDefaultConfig();
    expect(canProceed('topology', config)).toBe(true);
  });

  it('allows hosts step with default hosts', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    expect(canProceed('hosts', config)).toBe(true);
  });

  it('allows components step with default config', () => {
    const config = getDefaultConfig();
    expect(canProceed('components', config)).toBe(true);
  });

  it('blocks database step without admin password', () => {
    const config = getDefaultConfig();
    expect(canProceed('database', config)).toBe(false);
  });

  it('allows network step with default ports', () => {
    const config = getDefaultConfig();
    expect(canProceed('network', config)).toBe(true);
  });

  it('blocks credentials step without admin passwords', () => {
    const config = getDefaultConfig();
    expect(canProceed('credentials', config)).toBe(false);
  });

  it('returns true for unknown steps', () => {
    const config = getDefaultConfig();
    expect(canProceed('welcome' as any, config)).toBe(true);
  });

  it('allows all steps with fully valid config', () => {
    const config = makeValidConfig();
    expect(canProceed('eula', config)).toBe(true);
    expect(canProceed('subscription', config)).toBe(true);
    expect(canProceed('topology', config)).toBe(true);
    expect(canProceed('target', config)).toBe(true);
    expect(canProceed('hosts', config)).toBe(true);
    expect(canProceed('components', config)).toBe(true);
    expect(canProceed('database', config)).toBe(true);
    expect(canProceed('network', config)).toBe(true);
    expect(canProceed('credentials', config)).toBe(true);
    expect(canProceed('review', config)).toBe(true);
  });
});
