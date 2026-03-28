import { useState, useCallback, useMemo } from 'react';
import type { DeploymentConfig, WizardStep } from '../types';
import {
  validateRequired,
  validateHostnameOrIP,
  validateFQDN,
  validatePort,
  validatePasswordStrength,
  validateUnixPath,
  validatePEMFormat,
  validateUniqueHosts,
  validateUniquePorts,
  warnReservedPort,
  getPasswordStrengthLevel,
} from '../utils/validators';
import { validateHostname as validateHostnameShellSafe } from '../utils/crypto';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface StepValidation {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  validate: () => boolean;
  getFieldError: (field: string) => string | undefined;
  getFieldWarning: (field: string) => string | undefined;
  clearFieldError: (field: string) => void;
  touchField: (field: string) => void;
  isTouched: (field: string) => boolean;
}

const STEP_VALIDATOR_MAP: Record<string, (config: DeploymentConfig) => ValidationError[]> = {
  eula: validateEulaStep,
  subscription: validateSubscriptionStep,
  topology: validateTopologyStep,
  target: validateTargetStep,
  hosts: validateHostsStep,
  components: validateComponentsStep,
  database: validateDatabaseStep,
  network: validateNetworkStep,
  credentials: validateCredentialsStep,
  review: validateReviewStep,
};

export function useStepValidation(step: WizardStep, config: DeploymentConfig): StepValidation {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [manuallyCleared, setManuallyCleared] = useState<Set<string>>(new Set());

  const allIssues = useMemo(() => {
    const validator = STEP_VALIDATOR_MAP[step];
    return validator ? validator(config) : [];
  }, [step, config]);

  const errors = useMemo(
    () => allIssues.filter((e) => e.severity === 'error'),
    [allIssues],
  );

  const warnings = useMemo(
    () => allIssues.filter((e) => e.severity === 'warning'),
    [allIssues],
  );

  const isValid = errors.length === 0;

  const validate = useCallback((): boolean => {
    const allFields = new Set(allIssues.map((e) => e.field));
    setTouched((prev) => {
      const next = new Set(prev);
      allFields.forEach((f) => next.add(f));
      return next;
    });
    setManuallyCleared(new Set());
    return errors.length === 0;
  }, [allIssues, errors]);

  const getFieldError = useCallback(
    (field: string): string | undefined => {
      if (!touched.has(field) || manuallyCleared.has(field)) return undefined;
      return errors.find((e) => e.field === field)?.message;
    },
    [errors, touched, manuallyCleared],
  );

  const getFieldWarning = useCallback(
    (field: string): string | undefined => {
      if (!touched.has(field)) return undefined;
      return warnings.find((e) => e.field === field)?.message;
    },
    [warnings, touched],
  );

  const clearFieldError = useCallback((field: string) => {
    setManuallyCleared((prev) => new Set(prev).add(field));
  }, []);

  const touchField = useCallback((field: string) => {
    setTouched((prev) => {
      if (prev.has(field)) return prev;
      return new Set(prev).add(field);
    });
    setManuallyCleared((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  const isTouched = useCallback((field: string): boolean => touched.has(field), [touched]);

  return { isValid, errors, warnings, validate, getFieldError, getFieldWarning, clearFieldError, touchField, isTouched };
}

export function validateEulaStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!config.eula_accepted) {
    errors.push({ field: 'eula_accepted', message: 'You must accept the End User License Agreement to proceed', severity: 'error' });
  }
  return errors;
}

export function validateSubscriptionStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (config.installation_type === 'online') {
    const userErr = validateRequired(config.registry.username, 'Registry username');
    if (userErr) errors.push({ field: 'registry.username', message: userErr, severity: 'error' });

    const passErr = validateRequired(config.registry.password, 'Registry password');
    if (passErr) errors.push({ field: 'registry.password', message: passErr, severity: 'error' });
  }

  if (config.installation_type === 'disconnected') {
    const bundleErr = validateRequired(config.bundle_dir, 'Bundle directory');
    if (bundleErr) {
      errors.push({ field: 'bundle_dir', message: bundleErr, severity: 'error' });
    } else {
      const pathErr = validateUnixPath(config.bundle_dir);
      if (pathErr) errors.push({ field: 'bundle_dir', message: pathErr, severity: 'error' });
    }
  }

  return errors;
}

export function validateTopologyStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config.topology) {
    errors.push({ field: 'topology', message: 'Please select a deployment topology', severity: 'error' });
  }

  if (!config.installation_type) {
    errors.push({ field: 'installation_type', message: 'Please select an installation type', severity: 'error' });
  }

  return errors;
}

export function validateHostsStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const isEnterprise = config.topology === 'enterprise';

  if (config.gateway.hosts.length === 0) {
    errors.push({ field: 'gateway.hosts', message: 'At least one gateway host is required', severity: 'error' });
  }
  for (let i = 0; i < config.gateway.hosts.length; i++) {
    const hostErr = validateHostnameOrIP(config.gateway.hosts[i]);
    if (hostErr) errors.push({ field: `gateway.hosts.${i}`, message: `Gateway host ${i + 1}: ${hostErr}`, severity: 'error' });
  }

  if (config.controller.hosts.length === 0) {
    errors.push({ field: 'controller.hosts', message: 'At least one controller host is required', severity: 'error' });
  }
  for (let i = 0; i < config.controller.hosts.length; i++) {
    const hostErr = validateHostnameOrIP(config.controller.hosts[i]);
    if (hostErr) errors.push({ field: `controller.hosts.${i}`, message: `Controller host ${i + 1}: ${hostErr}`, severity: 'error' });
  }

  if (config.hub.hosts.length === 0) {
    errors.push({ field: 'hub.hosts', message: 'At least one hub host is required', severity: 'error' });
  }
  for (let i = 0; i < config.hub.hosts.length; i++) {
    const hostErr = validateHostnameOrIP(config.hub.hosts[i]);
    if (hostErr) errors.push({ field: `hub.hosts.${i}`, message: `Hub host ${i + 1}: ${hostErr}`, severity: 'error' });
  }

  if (config.eda.hosts.length === 0) {
    errors.push({ field: 'eda.hosts', message: 'At least one EDA host is required', severity: 'error' });
  }
  for (let i = 0; i < config.eda.hosts.length; i++) {
    const hostErr = validateHostnameOrIP(config.eda.hosts[i]);
    if (hostErr) errors.push({ field: `eda.hosts.${i}`, message: `EDA host ${i + 1}: ${hostErr}`, severity: 'error' });
  }

  if (isEnterprise) {
    if (config.gateway.hosts.length < 2) {
      errors.push({ field: 'gateway.hosts', message: 'Enterprise topology requires at least 2 gateway hosts for HA', severity: 'error' });
    }
    if (config.controller.hosts.length < 2) {
      errors.push({ field: 'controller.hosts', message: 'Enterprise topology requires at least 2 controller hosts for HA', severity: 'error' });
    }
    if (config.hub.hosts.length < 2) {
      errors.push({ field: 'hub.hosts', message: 'Enterprise topology requires at least 2 hub hosts for HA', severity: 'error' });
    }
    if (config.eda.hosts.length < 2) {
      errors.push({ field: 'eda.hosts', message: 'Enterprise topology requires at least 2 EDA hosts for HA', severity: 'error' });
    }
  }

  const allHosts = [
    ...config.gateway.hosts,
    ...config.controller.hosts,
    ...config.hub.hosts,
    ...config.eda.hosts,
  ];
  const dupeErr = validateUniqueHosts(allHosts);
  if (dupeErr && isEnterprise) {
    errors.push({ field: 'hosts', message: dupeErr, severity: 'error' });
  } else if (dupeErr && !isEnterprise) {
    // Growth topology may co-locate components — just warn
  }

  for (let i = 0; i < config.execution_nodes.length; i++) {
    const node = config.execution_nodes[i];
    const hostErr = validateHostnameOrIP(node.host);
    if (hostErr) {
      errors.push({ field: `execution_nodes.${i}.host`, message: `Execution node ${i + 1}: ${hostErr}`, severity: 'error' });
    }
    if (!node.receptor_type || !['execution', 'hop'].includes(node.receptor_type)) {
      errors.push({ field: `execution_nodes.${i}.receptor_type`, message: `Execution node ${i + 1}: receptor type must be 'execution' or 'hop'`, severity: 'error' });
    }
  }

  for (let i = 0; i < config.hosts.length; i++) {
    const host = config.hosts[i];
    if (host.hostname) {
      const hnErr = validateHostnameOrIP(host.hostname);
      if (hnErr) errors.push({ field: `hosts.${i}.hostname`, message: `Host "${host.hostname}": ${hnErr}`, severity: 'error' });
    }
    const sshUserErr = validateHostnameShellSafe(host.ssh_user || '');
    if (host.ssh_user && sshUserErr) {
      errors.push({ field: `hosts.${i}.ssh_user`, message: `SSH user for ${host.hostname || 'host'}: ${sshUserErr}`, severity: 'error' });
    }
    if (host.ssh_port) {
      const portErr = validatePort(host.ssh_port);
      if (portErr) errors.push({ field: `hosts.${i}.ssh_port`, message: `Host "${host.hostname || 'host'}" SSH port: ${portErr}`, severity: 'error' });
    }
  }

  return errors;
}

export function validateTargetStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  const targetHostReqErr = validateRequired(config.target_host, 'Target host');
  if (targetHostReqErr) {
    errors.push({ field: 'target_host', message: targetHostReqErr, severity: 'error' });
  } else {
    const targetHostErr = validateHostnameOrIP(config.target_host);
    if (targetHostErr) {
      errors.push({ field: 'target_host', message: `Target host: ${targetHostErr}`, severity: 'error' });
    }
  }

  const targetUserReqErr = validateRequired(config.target_user, 'SSH username');
  if (targetUserReqErr) {
    errors.push({ field: 'target_user', message: targetUserReqErr, severity: 'error' });
  } else {
    const targetUserErr = validateHostnameShellSafe(config.target_user || '');
    if (targetUserErr) {
      errors.push({ field: 'target_user', message: `SSH username: ${targetUserErr}`, severity: 'error' });
    }
  }

  const targetPasswordErr = validateRequired(config.target_password, 'SSH password');
  if (targetPasswordErr) {
    errors.push({ field: 'target_password', message: targetPasswordErr, severity: 'error' });
  }

  const targetPortErr = validatePort(config.target_ssh_port);
  if (targetPortErr) {
    errors.push({ field: 'target_ssh_port', message: `SSH port: ${targetPortErr}`, severity: 'error' });
  }

  return errors;
}

export function validateComponentsStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  if (config.controller.percent_memory_capacity <= 0 || config.controller.percent_memory_capacity > 1) {
    errors.push({ field: 'controller.percent_memory_capacity', message: 'Memory capacity must be between 0 and 1 (e.g., 0.5 for 50%)', severity: 'error' });
  }

  if (config.topology === 'enterprise' && config.redis_mode !== 'cluster') {
    errors.push({ field: 'redis_mode', message: 'Enterprise topology requires Redis cluster mode', severity: 'warning' });
  }

  return errors;
}

export function validateDatabaseStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  const adminPwErr = validateRequired(config.database.admin_password, 'Database admin password');
  if (adminPwErr) {
    errors.push({ field: 'database.admin_password', message: adminPwErr, severity: 'error' });
  }

  if (config.database.type === 'external') {
    const hostErr = validateRequired(config.database.host, 'Database host');
    if (hostErr) {
      errors.push({ field: 'database.host', message: hostErr, severity: 'error' });
    } else {
      const hnErr = validateHostnameOrIP(config.database.host);
      if (hnErr) errors.push({ field: 'database.host', message: hnErr, severity: 'error' });
    }

    const portErr = validatePort(config.database.port);
    if (portErr) errors.push({ field: 'database.port', message: portErr, severity: 'error' });

    const userErr = validateRequired(config.database.admin_username, 'Database admin username');
    if (userErr) errors.push({ field: 'database.admin_username', message: userErr, severity: 'error' });
  }

  const componentDbs = [
    { prefix: 'gateway', cfg: config.gateway },
    { prefix: 'controller', cfg: config.controller },
    { prefix: 'hub', cfg: config.hub },
    { prefix: 'eda', cfg: config.eda },
  ];

  for (const { prefix, cfg } of componentDbs) {
    const pwErr = validateRequired(cfg.pg_password, `${prefix} database password`);
    if (pwErr) errors.push({ field: `${prefix}.pg_password`, message: pwErr, severity: 'error' });

    if (config.database.type === 'external' && cfg.pg_host) {
      const pgHostErr = validateHostnameOrIP(cfg.pg_host);
      if (pgHostErr) errors.push({ field: `${prefix}.pg_host`, message: `${prefix} DB host: ${pgHostErr}`, severity: 'error' });
    }

    const dbNameErr = validateRequired(cfg.pg_database, `${prefix} database name`);
    if (dbNameErr) errors.push({ field: `${prefix}.pg_database`, message: dbNameErr, severity: 'error' });

    const pgUserErr = validateRequired(cfg.pg_username, `${prefix} database username`);
    if (pgUserErr) errors.push({ field: `${prefix}.pg_username`, message: pgUserErr, severity: 'error' });
  }

  const dbNames = componentDbs.map((c) => c.cfg.pg_database);
  const uniqueNames = new Set(dbNames);
  if (uniqueNames.size < dbNames.length) {
    errors.push({ field: 'database', message: 'Each component must use a unique database name', severity: 'warning' });
  }

  return errors;
}

export function validateNetworkStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  const httpErr = validatePort(config.network.http_port);
  if (httpErr) errors.push({ field: 'network.http_port', message: `HTTP port: ${httpErr}`, severity: 'error' });

  const httpsErr = validatePort(config.network.https_port);
  if (httpsErr) errors.push({ field: 'network.https_port', message: `HTTPS port: ${httpsErr}`, severity: 'error' });

  const receptorErr = validatePort(config.network.receptor_port);
  if (receptorErr) errors.push({ field: 'network.receptor_port', message: `Receptor port: ${receptorErr}`, severity: 'error' });

  const ports = [config.network.http_port, config.network.https_port, config.network.receptor_port];
  const portDupe = validateUniquePorts(ports);
  if (portDupe) errors.push({ field: 'network.ports', message: `Port conflict: ${portDupe}`, severity: 'error' });

  const httpWarn = warnReservedPort(config.network.http_port);
  if (httpWarn) errors.push({ field: 'network.http_port', message: httpWarn, severity: 'warning' });

  const httpsWarn = warnReservedPort(config.network.https_port);
  if (httpsWarn) errors.push({ field: 'network.https_port', message: httpsWarn, severity: 'warning' });

  if (!config.network.tls.disable_https) {
    if (config.network.tls.custom_server_cert && !config.network.tls.custom_server_key) {
      errors.push({ field: 'network.tls.custom_server_key', message: 'Server key is required when a custom certificate is provided', severity: 'error' });
    }
    if (config.network.tls.custom_server_key && !config.network.tls.custom_server_cert) {
      errors.push({ field: 'network.tls.custom_server_cert', message: 'Server certificate is required when a custom key is provided', severity: 'error' });
    }
    if (config.network.tls.custom_server_cert) {
      const pemErr = validatePEMFormat(config.network.tls.custom_server_cert);
      if (pemErr) errors.push({ field: 'network.tls.custom_server_cert', message: `Server cert: ${pemErr}`, severity: 'error' });
    }
    if (config.network.tls.custom_ca_cert) {
      const caErr = validatePEMFormat(config.network.tls.custom_ca_cert);
      if (caErr) errors.push({ field: 'network.tls.custom_ca_cert', message: `CA cert: ${caErr}`, severity: 'error' });
    }
  }

  if (config.network.tls.disable_https) {
    errors.push({ field: 'network.tls.disable_https', message: 'HTTPS is disabled — connections will not be encrypted', severity: 'warning' });
  }

  return errors;
}

export function validateCredentialsStep(config: DeploymentConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  const adminPasswords: { field: string; label: string; value: string }[] = [
    { field: 'gateway.admin_password', label: 'Gateway', value: config.gateway.admin_password },
    { field: 'controller.admin_password', label: 'Controller', value: config.controller.admin_password },
    { field: 'hub.admin_password', label: 'Hub', value: config.hub.admin_password },
    { field: 'eda.admin_password', label: 'EDA', value: config.eda.admin_password },
  ];

  for (const { field, label, value } of adminPasswords) {
    const reqErr = validateRequired(value, `${label} admin password`);
    if (reqErr) {
      errors.push({ field, message: reqErr, severity: 'error' });
    } else {
      const strengthErr = validatePasswordStrength(value);
      if (strengthErr) {
        errors.push({ field, message: `${label}: ${strengthErr}`, severity: 'error' });
      }
      const level = getPasswordStrengthLevel(value);
      if (level === 'fair') {
        errors.push({ field, message: `${label} password strength is "fair" — consider a stronger password`, severity: 'warning' });
      }
    }
  }

  const passwordValues = adminPasswords.filter((p) => p.value).map((p) => p.value);
  const uniquePasswords = new Set(passwordValues);
  if (uniquePasswords.size < passwordValues.length && passwordValues.length > 1) {
    errors.push({ field: 'admin_passwords', message: 'Each component should have a unique admin password', severity: 'warning' });
  }

  if (config.target_password) {
    const tgtErr = validatePasswordStrength(config.target_password);
    if (tgtErr) errors.push({ field: 'target_password', message: `Target host password: ${tgtErr}`, severity: 'warning' });
  }

  return errors;
}

export function validateReviewStep(config: DeploymentConfig): ValidationError[] {
  const allErrors: ValidationError[] = [];

  for (const [step, validator] of Object.entries(STEP_VALIDATOR_MAP)) {
    if (step === 'review') continue;
    const stepErrors = validator(config).filter((e) => e.severity === 'error');
    for (const err of stepErrors) {
      allErrors.push({ ...err, message: `[${step}] ${err.message}` });
    }
  }

  return allErrors;
}

export function validateAllSteps(config: DeploymentConfig): Map<WizardStep, ValidationError[]> {
  const result = new Map<WizardStep, ValidationError[]>();

  for (const [step, validator] of Object.entries(STEP_VALIDATOR_MAP)) {
    result.set(step as WizardStep, validator(config));
  }

  return result;
}

export function canProceed(step: WizardStep, config: DeploymentConfig): boolean {
  const validator = STEP_VALIDATOR_MAP[step];
  if (!validator) return true;

  const issues = validator(config);
  return issues.filter((e) => e.severity === 'error').length === 0;
}
