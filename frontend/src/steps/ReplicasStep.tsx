import React from 'react';
import { CheckIcon } from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

const RESOURCE_PRESETS = [
  { id: 'small' as const, label: 'Small', desc: 'Dev/test — minimal resources', cpu: '2 cores', mem: '4 Gi' },
  { id: 'medium' as const, label: 'Medium', desc: 'Standard workloads', cpu: '4 cores', mem: '8 Gi' },
  { id: 'large' as const, label: 'Large', desc: 'High-throughput production', cpu: '8 cores', mem: '16 Gi' },
];

interface ReplicaRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  description: string;
}

function ReplicaRow({ label, value, onChange, description }: ReplicaRowProps) {
  return (
    <div className="aap-flex-row aap-mb-md" style={{ gap: 16, alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <div className="aap-label">{label}</div>
        <div className="aap-text-muted aap-text-sm">{description}</div>
      </div>
      <div className="aap-flex-row" style={{ gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="aap-btn aap-btn--secondary aap-btn--sm"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
          aria-label={`Decrease ${label} replicas`}
        >
          −
        </button>
        <span className="aap-text-mono" style={{ minWidth: 32, textAlign: 'center', fontSize: 18 }}>
          {value}
        </span>
        <button
          type="button"
          className="aap-btn aap-btn--secondary aap-btn--sm"
          onClick={() => onChange(Math.min(10, value + 1))}
          disabled={value >= 10}
          aria-label={`Increase ${label} replicas`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ReplicasStep({ config, updateConfig }: Props) {
  const ocp = config.ocp;

  const updateOCP = (partial: Partial<typeof ocp>) => {
    updateConfig({ ocp: { ...ocp, ...partial } });
  };

  const totalReplicas = ocp.gateway_replicas + ocp.controller_replicas + ocp.hub_replicas + ocp.eda_replicas;

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Scaling & Resources</h2>
        <p className="aap-step__description">
          Configure the number of replicas for each AAP component and the resource limits.
          More replicas provide higher availability and throughput.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Component Replicas</h3>
        <p className="aap-text-muted aap-text-sm aap-mb-lg">
          Set the replica count for each component. Use 1 for development, 2+ for production HA.
        </p>

        <ReplicaRow
          label="Platform Gateway"
          value={ocp.gateway_replicas}
          onChange={(v) => updateOCP({ gateway_replicas: v })}
          description="Handles authentication and request routing"
        />
        <ReplicaRow
          label="Automation Controller"
          value={ocp.controller_replicas}
          onChange={(v) => updateOCP({ controller_replicas: v })}
          description="Runs automation jobs and manages inventories"
        />
        <ReplicaRow
          label="Automation Hub"
          value={ocp.hub_replicas}
          onChange={(v) => updateOCP({ hub_replicas: v })}
          description="Hosts content collections and execution environments"
        />
        <ReplicaRow
          label="Event-Driven Ansible"
          value={ocp.eda_replicas}
          onChange={(v) => updateOCP({ eda_replicas: v })}
          description="Processes events and triggers automation"
        />

        <div className="aap-flex-row aap-mt-lg" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--pf-v6-global--BorderColor--100)', paddingTop: 16 }}>
          <span className="aap-text-muted">Total pods</span>
          <span className="aap-text-mono" style={{ fontSize: 18 }}>{totalReplicas}</span>
        </div>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Resource Preset</h3>
        <p className="aap-text-muted aap-text-sm aap-mb-md">
          Choose a resource allocation preset for the Controller component. This sets CPU and memory limits per pod.
        </p>

        <div className="aap-selection-grid aap-selection-grid--3col" role="radiogroup" aria-label="Resource preset">
          {RESOURCE_PRESETS.map((preset) => (
            <div
              key={preset.id}
              className={`aap-selection-card ${ocp.controller_resource_preset === preset.id ? 'aap-selection-card--selected' : ''}`}
              role="radio"
              aria-checked={ocp.controller_resource_preset === preset.id}
              tabIndex={0}
              onClick={() => updateOCP({ controller_resource_preset: preset.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  updateOCP({ controller_resource_preset: preset.id });
                }
              }}
            >
              <div className="aap-selection-card__indicator" aria-hidden="true">
                <CheckIcon />
              </div>
              <div className="aap-selection-card__title">{preset.label}</div>
              <div className="aap-selection-card__description">{preset.desc}</div>
              <div className="aap-text-mono aap-text-sm aap-mt-sm">
                {preset.cpu} / {preset.mem}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="aap-card">
        <h3 className="aap-card__title">Scaling Guidelines</h3>
        <table className="aap-table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Gateway</th>
              <th>Controller</th>
              <th>Hub</th>
              <th>EDA</th>
              <th>Preset</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Development', '1', '1', '1', '1', 'Small'],
              ['Staging', '1', '2', '1', '1', 'Medium'],
              ['Production', '2', '3', '2', '2', 'Large'],
              ['High Availability', '3', '3', '3', '3', 'Large'],
            ].map(([env, gw, ctrl, hub, eda, preset]) => (
              <tr key={env}>
                <td><strong>{env}</strong></td>
                <td>{gw}</td>
                <td>{ctrl}</td>
                <td>{hub}</td>
                <td>{eda}</td>
                <td><span className="aap-badge aap-badge--info">{preset}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
