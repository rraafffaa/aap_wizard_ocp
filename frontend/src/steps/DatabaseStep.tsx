import React from 'react';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, DatabaseType } from '../types';
import { FormField, TextInput, NumberInput } from '../components/FormField';

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
        <h2 className="aap-step__title">Database Configuration</h2>
        <p className="aap-step__description aap-text-muted aap-text-sm">
          Configure PostgreSQL for AAP data storage.
        </p>
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
              <div className="aap-selection-card__title">External (BYO)</div>
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
              Enterprise topology requires an external PostgreSQL database for performance and independent scaling.
            </p>
          </div>
        </div>
      )}

      {isOCP && (
        <div className="aap-alert aap-alert--info aap-mb-lg">
          <span className="aap-alert__icon" aria-hidden>
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">Operator-Managed Database</div>
            <p className="aap-text-muted aap-text-sm">
              On OpenShift, the AAP Operator automatically deploys and manages a PostgreSQL instance.
              You can optionally configure an external database below, or leave this as default.
            </p>
          </div>
        </div>
      )}

      {/* PostgreSQL admin credentials */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">PostgreSQL Administrator</h3>
        </div>
        <div className="aap-form-row">
          <FormField label="Admin Username" required>
            <TextInput
              value={config.database.admin_username}
              onChange={(v) => updateConfig({ database: { ...config.database, admin_username: v } })}
              placeholder="postgres"
            />
          </FormField>
          <FormField label="Admin Password" required>
            <TextInput
              value={config.database.admin_password}
              onChange={(v) => updateConfig({ database: { ...config.database, admin_password: v } })}
              placeholder="Strong password"
              type="password"
            />
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
            <FormField label="Database Host" required>
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
            Requires PostgreSQL 15, 16, or 17 with ICU support enabled. External databases using PostgreSQL 16 or 17
            must use external backup/restore processes.
          </p>
        </div>
      )}

      {/* Per-component database settings */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">Component Database Credentials</h3>
          <p className="aap-card__description aap-text-muted aap-text-sm aap-mb-md">
            Each component uses its own database credentials.
          </p>
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
                <TextInput
                  value={config[key].pg_password}
                  onChange={(v) => updateConfig({ [key]: { ...config[key], pg_password: v } })}
                  placeholder={`${label} DB password`}
                  type="password"
                />
              </FormField>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
