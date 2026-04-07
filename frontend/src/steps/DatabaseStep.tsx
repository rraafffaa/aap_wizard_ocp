import React from 'react';
import { ExclamationTriangleIcon, KeyIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, DatabaseType } from '../types';
import { FormField, TextInput, NumberInput } from '../components/FormField';
import { generatePassword } from './CredentialsStep';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function DatabaseStep({ config, updateConfig }: Props) {
  const isGrowth = config.topology === 'growth';
  const isOCP = config.platform === 'openshift';

  const setDbType = (type: DatabaseType) => {
    updateConfig({ database: { ...config.database, type } });
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Database</h2>
      </div>

      {(isGrowth || isOCP) && (
        <div className="aap-card aap-mb-lg">
          <div className="aap-card__header">
            <h3 className="aap-card__title">Database Type</h3>
          </div>
          <div className="aap-selection-grid aap-selection-grid--2col" role="radiogroup" aria-label="Database type">
            <div
              role="radio"
              aria-checked={config.database.type === 'managed'}
              tabIndex={0}
              className={`aap-selection-card ${config.database.type === 'managed' ? 'aap-selection-card--selected' : ''}`}
              onClick={() => setDbType('managed')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setDbType('managed');
                }
              }}
            >
              <div className="aap-selection-card__indicator" />
              <div className="aap-selection-card__title">Managed (Included)</div>
              <div className="aap-selection-card__description">
                PostgreSQL 15 installed by the AAP installer on the same host.
              </div>
            </div>
            <div
              role="radio"
              aria-checked={config.database.type === 'external'}
              tabIndex={0}
              className={`aap-selection-card ${config.database.type === 'external' ? 'aap-selection-card--selected' : ''}`}
              onClick={() => setDbType('external')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setDbType('external');
                }
              }}
            >
              <div className="aap-selection-card__indicator" />
              <div className="aap-selection-card__title">External (bring your own)</div>
              <div className="aap-selection-card__description">
                Bring your own PostgreSQL 15, 16, or 17 instance.
              </div>
            </div>
          </div>
        </div>
      )}

      {!isGrowth && !isOCP && (
        <div className="aap-alert aap-alert--warning aap-mb-lg">
          <span className="aap-alert__icon" aria-hidden>
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">External Database Required</div>
            <p className="aap-text-muted aap-text-sm">
              Enterprise topology requires an external PostgreSQL instance.
            </p>
          </div>
        </div>
      )}

      {isOCP && (
        <div className="aap-alert aap-alert--info aap-alert--compact aap-mb-lg">
          <span className="aap-alert__icon" aria-hidden>
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <span className="aap-text-sm">Operator manages PostgreSQL by default. External is optional.</span>
          </div>
        </div>
      )}

      {/* PostgreSQL admin credentials */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-form-row">
          <FormField label="Admin Username" required tooltip="The PostgreSQL superuser account used by the installer to create component databases and roles.">
            <TextInput
              value={config.database.admin_username}
              onChange={(v) => updateConfig({ database: { ...config.database, admin_username: v } })}
              placeholder="postgres"
            />
          </FormField>
          <FormField label="Admin Password" required>
            <div className="aap-form-row">
              <TextInput
                value={config.database.admin_password}
                onChange={(v) => updateConfig({ database: { ...config.database, admin_password: v } })}
                placeholder="Strong password"
                type="password"
              />
              <button
                type="button"
                className="aap-btn aap-btn--tertiary aap-btn--sm"
                onClick={() => updateConfig({ database: { ...config.database, admin_password: generatePassword() } })}
                title="Generate random password"
                aria-label="Generate random admin password"
              >
                <KeyIcon aria-hidden />
              </button>
            </div>
          </FormField>
        </div>
      </div>

      {/* External DB config */}
      {(config.database.type === 'external' || (!isGrowth && !isOCP)) && (
        <div className="aap-card aap-mb-lg">
          <div className="aap-card__header">
            <h3 className="aap-card__title">External Database Connection</h3>
          </div>
          <div className="aap-form-row">
            <FormField label="Database Host" required tooltip="FQDN or IP of your external PostgreSQL server. Must be reachable from all AAP nodes.">
              <TextInput
                value={config.database.host}
                onChange={(v) => updateConfig({ database: { ...config.database, host: v } })}
                placeholder="externaldb.example.org"
              />
            </FormField>
            <FormField label="Port">
              <NumberInput
                value={config.database.port}
                onChange={(v) => updateConfig({ database: { ...config.database, port: v } })}
                min={1}
                max={65535}
              />
            </FormField>
          </div>
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            Requires PostgreSQL 15–17 with ICU support.
          </p>
        </div>
      )}

      {/* Per-component database settings */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <h3 className="aap-card__title">Component Database Credentials</h3>
            <p className="aap-card__description aap-text-muted aap-text-sm">
              Per-component database names and passwords.
            </p>
          </div>
          <button
            type="button"
            className="aap-btn aap-btn--secondary aap-btn--sm"
            onClick={() => {
              updateConfig({
                gateway: { ...config.gateway, pg_password: generatePassword() },
                controller: { ...config.controller, pg_password: generatePassword() },
                hub: { ...config.hub, pg_password: generatePassword() },
                eda: { ...config.eda, pg_password: generatePassword() },
              });
            }}
            aria-label="Generate passwords for all component databases"
          >
            <KeyIcon aria-hidden /> Generate all
          </button>
        </div>

        {[
          { label: 'Gateway', key: 'gateway' as const },
          { label: 'Controller', key: 'controller' as const },
          { label: 'Hub', key: 'hub' as const },
          { label: 'EDA', key: 'eda' as const },
        ].map(({ label, key }) => (
          <div key={key} className="aap-step__section">
            <div className="aap-step__section-title">{label}</div>
            <div className="aap-form-row">
              <FormField label="Database Name">
                <TextInput
                  value={config[key].pg_database}
                  onChange={(v) => updateConfig({ [key]: { ...config[key], pg_database: v } })}
                  placeholder={key}
                />
              </FormField>
              <FormField label="Database Password" required>
                <div className="aap-form-row">
                  <TextInput
                    value={config[key].pg_password}
                    onChange={(v) => updateConfig({ [key]: { ...config[key], pg_password: v } })}
                    placeholder={`${label} DB password`}
                    type="password"
                  />
                  <button
                    type="button"
                    className="aap-btn aap-btn--tertiary aap-btn--sm"
                    onClick={() => updateConfig({ [key]: { ...config[key], pg_password: generatePassword() } })}
                    title="Generate random password"
                    aria-label={`Generate random password for ${label} database`}
                  >
                    <KeyIcon aria-hidden />
                  </button>
                </div>
              </FormField>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
