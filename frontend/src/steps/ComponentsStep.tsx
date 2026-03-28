import React from 'react';
import type { DeploymentConfig } from '../types';
import { SwitchInput } from '../components/FormField';
import { ProductIcon, type ProductName } from '../components/ProductIcon';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export const COMPONENTS = [
  {
    id: 'gateway',
    name: 'Platform Gateway',
    product: 'gateway' as ProductName,
    description: 'Unified entry point and authentication. Routes traffic to all services.',
    required: true,
  },
  {
    id: 'controller',
    name: 'Automation Controller',
    product: 'controller' as ProductName,
    description: 'Define, run, and monitor automation jobs with RBAC.',
    required: true,
  },
  {
    id: 'hub',
    name: 'Automation Hub',
    product: 'hub' as ProductName,
    description: 'Manage collections, execution environments, and decision environments.',
    required: true,
  },
  {
    id: 'eda',
    name: 'Event-Driven Ansible',
    product: 'eda' as ProductName,
    description: 'Trigger automation from webhooks, alerts, and other events in real time.',
    required: true,
  },
];

export function ComponentsStep({ config, updateConfig }: Props) {
  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Platform Components</h2>
        <p className="aap-step__description aap-text-muted aap-text-sm">
          All four components are required. Configure options below.
        </p>
      </div>

      <div className="aap-selection-grid aap-selection-grid--2col aap-mb-lg">
        {COMPONENTS.map((comp) => (
          <div key={comp.id} className="aap-card">
            <div className="aap-card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProductIcon product={comp.product} size={32} />
                <span className="aap-card__title">{comp.name}</span>
              </div>
              <span className={`aap-badge ${comp.required ? 'aap-badge--success' : 'aap-badge--neutral'}`}>
                {comp.required ? 'Required' : 'Optional'}
              </span>
            </div>
            <p className="aap-card__description aap-text-muted aap-text-sm">
              {comp.description}
            </p>
          </div>
        ))}
      </div>

      {/* Hub-specific options */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">Automation Hub Options</h3>
        </div>
        <SwitchInput
          checked={config.hub.seed_collections}
          onChange={(v) => updateConfig({ hub: { ...config.hub, seed_collections: v } })}
          label="Seed certified collections after installation"
        />
        <p className="aap-text-muted aap-text-sm aap-mt-sm">
          Requires 32 GB RAM and can take 45+ minutes.
        </p>
      </div>

      {/* Controller options */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">Automation Controller Options</h3>
        </div>
        <div className="aap-form-group">
          <label className="aap-form-group__label">Memory Capacity Allocation</label>
          <div className="aap-form-row">
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.1"
              value={config.controller.percent_memory_capacity}
              onChange={(e) =>
                updateConfig({
                  controller: {
                    ...config.controller,
                    percent_memory_capacity: parseFloat(e.target.value),
                  },
                })
              }
              className="aap-input"
              aria-label="Memory capacity percentage"
            />
            <span className="aap-text-mono">
              {Math.round(config.controller.percent_memory_capacity * 100)}%
            </span>
          </div>
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            System memory allocated to the controller.
          </p>
        </div>
      </div>

      {/* EDA options */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">Event-Driven Ansible Options</h3>
        </div>
        <div className="aap-form-group">
          <label className="aap-form-group__label">Enabled Event Source Plugins</label>
          <div className="aap-form-row aap-mt-sm">
            {[
              'ansible.eda.webhook',
              'ansible.eda.alertmanager',
              'ansible.eda.url_check',
              'ansible.eda.range',
              'ansible.eda.file_watch',
              'ansible.eda.journald',
            ].map((plugin) => {
              const active = config.eda.safe_plugins.includes(plugin);
              return (
                <button
                  key={plugin}
                  type="button"
                  className={`aap-btn aap-btn--sm ${active ? 'aap-btn--primary' : 'aap-btn--secondary'}`}
                  onClick={() => {
                    const plugins = active
                      ? config.eda.safe_plugins.filter((p) => p !== plugin)
                      : [...config.eda.safe_plugins, plugin];
                    updateConfig({ eda: { ...config.eda, safe_plugins: plugins } });
                  }}
                >
                  {plugin}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Redis mode (enterprise only) */}
      {config.topology === 'enterprise' && (
        <div className="aap-card aap-mb-lg">
          <div className="aap-card__header">
            <h3 className="aap-card__title">Redis Configuration</h3>
          </div>
          <div className="aap-selection-grid aap-selection-grid--2col" role="radiogroup" aria-label="Redis mode">
            <div
              role="radio"
              aria-checked={config.redis_mode === 'standalone'}
              tabIndex={0}
              className={`aap-selection-card ${config.redis_mode === 'standalone' ? 'aap-selection-card--selected' : ''}`}
              onClick={() => updateConfig({ redis_mode: 'standalone' })}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  updateConfig({ redis_mode: 'standalone' });
                }
              }}
            >
              <div className="aap-selection-card__indicator" />
              <div className="aap-selection-card__title">Standalone</div>
              <div className="aap-selection-card__description">
                Single Redis instance per service node
              </div>
            </div>
            <div
              role="radio"
              aria-checked={config.redis_mode === 'cluster'}
              tabIndex={0}
              className={`aap-selection-card ${config.redis_mode === 'cluster' ? 'aap-selection-card--selected' : ''}`}
              onClick={() => updateConfig({ redis_mode: 'cluster' })}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  updateConfig({ redis_mode: 'cluster' });
                }
              }}
            >
              <div className="aap-selection-card__indicator" />
              <div className="aap-selection-card__title">Cluster</div>
              <div className="aap-selection-card__description">
                Distributed Redis cluster for high availability
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
