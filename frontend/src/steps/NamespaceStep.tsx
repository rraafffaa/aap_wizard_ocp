import React from 'react';
import type { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

const STORAGE_PRESETS = [
  { label: 'Small', postgres: '20Gi', hub: '50Gi', desc: 'Dev/test environments' },
  { label: 'Medium', postgres: '50Gi', hub: '100Gi', desc: 'Standard workloads' },
  { label: 'Large', postgres: '100Gi', hub: '250Gi', desc: 'Large production deployments' },
];

export function NamespaceStep({ config, updateConfig }: Props) {
  const ocp = config.ocp;

  const updateOCP = (partial: Partial<typeof ocp>) => {
    updateConfig({ ocp: { ...ocp, ...partial } });
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Namespace & Storage</h2>
        <p className="aap-step__description">
          Configure the OpenShift namespace where AAP will be deployed and the storage settings
          for persistent data.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Namespace</h3>
        <div className="aap-form-group aap-mt-md">
          <label htmlFor="ocp-namespace" className="aap-label">
            Target Namespace <span className="aap-required">*</span>
          </label>
          <input
            id="ocp-namespace"
            type="text"
            className="aap-input"
            placeholder="aap"
            value={ocp.namespace}
            onChange={(e) => updateOCP({ namespace: e.target.value })}
          />
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            The namespace will be created if it doesn't exist. Use a dedicated namespace for AAP.
          </p>
        </div>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Storage Class</h3>
        <div className="aap-form-group aap-mt-md">
          <label htmlFor="ocp-storage-class" className="aap-label">
            Storage Class <span className="aap-required">*</span>
          </label>
          <input
            id="ocp-storage-class"
            type="text"
            className="aap-input"
            placeholder="gp3-csi"
            value={ocp.storage_class}
            onChange={(e) => updateOCP({ storage_class: e.target.value })}
          />
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            The Kubernetes StorageClass for PersistentVolumeClaims. Common values: <code>gp3-csi</code> (AWS),
            <code> managed-premium</code> (Azure), <code> standard</code> (GCP).
          </p>
        </div>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Storage Sizing</h3>
        <p className="aap-text-muted aap-text-sm aap-mb-md">
          Choose a preset or customize PVC sizes for each component.
        </p>

        <div className="aap-selection-grid aap-selection-grid--3col aap-mb-lg" role="radiogroup" aria-label="Storage preset">
          {STORAGE_PRESETS.map((preset) => {
            const isSelected = ocp.postgres_storage_size === preset.postgres && ocp.hub_storage_size === preset.hub;
            return (
              <div
                key={preset.label}
                className={`aap-selection-card ${isSelected ? 'aap-selection-card--selected' : ''}`}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => updateOCP({ postgres_storage_size: preset.postgres, hub_storage_size: preset.hub })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    updateOCP({ postgres_storage_size: preset.postgres, hub_storage_size: preset.hub });
                  }
                }}
              >
                <div className="aap-selection-card__title">{preset.label}</div>
                <div className="aap-selection-card__description">{preset.desc}</div>
                <div className="aap-text-mono aap-text-sm aap-mt-sm">
                  PostgreSQL: {preset.postgres} | Hub: {preset.hub}
                </div>
              </div>
            );
          })}
        </div>

        <div className="aap-flex-row" style={{ gap: 16 }}>
          <div className="aap-form-group" style={{ flex: 1 }}>
            <label htmlFor="pg-storage" className="aap-label">PostgreSQL PVC Size</label>
            <input
              id="pg-storage"
              type="text"
              className="aap-input"
              value={ocp.postgres_storage_size}
              onChange={(e) => updateOCP({ postgres_storage_size: e.target.value })}
            />
          </div>
          <div className="aap-form-group" style={{ flex: 1 }}>
            <label htmlFor="hub-storage" className="aap-label">Hub PVC Size</label>
            <input
              id="hub-storage"
              type="text"
              className="aap-input"
              value={ocp.hub_storage_size}
              onChange={(e) => updateOCP({ hub_storage_size: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="aap-card">
        <h3 className="aap-card__title">Hub Storage Backend</h3>
        <div className="aap-form-group aap-mt-md">
          <label htmlFor="hub-backend" className="aap-label">Backend Type</label>
          <select
            id="hub-backend"
            className="aap-input"
            value={ocp.hub_storage_backend}
            onChange={(e) => updateOCP({ hub_storage_backend: e.target.value as 'file' | 's3' | 'azure' })}
          >
            <option value="file">File (PVC)</option>
            <option value="s3">S3-compatible Object Storage</option>
            <option value="azure">Azure Blob Storage</option>
          </select>
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            File storage uses a PersistentVolumeClaim. S3 or Azure Blob are recommended for multi-replica Hub deployments.
          </p>
        </div>
      </div>
    </div>
  );
}
