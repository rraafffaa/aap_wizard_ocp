import React, { useState, useEffect } from 'react';
import type { DeploymentConfig } from '../types';
import { downloadTextFile } from '../types';
import { FormField, TextInput, SwitchInput } from '../components/FormField';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import { generateInventory, validateInventory } from '../api';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function ReviewStep({ config, updateConfig }: Props) {
  const [inventoryPreview, setInventoryPreview] = useState('');
  const [showInventory, setShowInventory] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // OCP deployments use Custom Resources, not INI inventory files
    if (config.platform === 'openshift') {
      setInventoryPreview('');
      setValidationErrors([]);
      return;
    }

    generateInventory(config)
      .then((data) => {
        if (!cancelled) {
          setInventoryPreview(data.inventory);
          setApiAvailable(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInventoryPreview('# Inventory preview unavailable — backend not running\n# You can still export the configuration as JSON using the Export button.');
          setApiAvailable(false);
        }
      });

    validateInventory(config)
      .then((data) => {
        if (!cancelled) setValidationErrors(data.errors || []);
      })
      .catch(() => {
        if (!cancelled) setValidationErrors([]);
      });

    return () => { cancelled = true; };
  }, [config]);

  const maskPassword = (pw: string) => (pw ? '••••••••' : '(not set)');
  const isGrowth = config.topology === 'growth';
  const isOCP = config.platform === 'openshift';

  const handleCopy = () => {
    navigator.clipboard.writeText(inventoryPreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="aap-step">
      <header className="aap-step__header">
        <h2 className="aap-step__title">Review Configuration</h2>
      </header>

      {!apiAvailable && (
        <div className="aap-alert aap-alert--warning aap-mb-md">
          <span className="aap-alert__icon" aria-hidden>
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <span className="aap-text-sm">
              Backend API unreachable. Inventory preview and validation unavailable.
            </span>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="aap-alert aap-alert--danger aap-mb-md">
          <span className="aap-alert__icon" aria-hidden>
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">Configuration Issues</div>
            <ul className="aap-mt-sm aap-list">
              {validationErrors.map((err, i) => (
                <li key={i} className="aap-mb-sm">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {isOCP ? (
        <section className="aap-step__section">
          <div className="aap-card">
            <h3 className="aap-card__title">OpenShift Cluster</h3>
            <dl className="aap-dl">
              {[
                ['API URL', config.ocp.api_url],
                ['Namespace', config.ocp.namespace],
                ['Storage Class', config.ocp.storage_class || '(default)'],
                ['Operator Channel', config.ocp.operator_channel],
                ['Operator Installed', config.ocp.operator_installed ? 'Yes' : 'No'],
              ].map(([label, value]) => (
                <div key={String(label)} className="aap-dl__row">
                  <dt className="aap-dl__term">{label}</dt>
                  <dd className={`aap-dl__value ${label === 'API URL' ? 'aap-dl__value--mono' : ''}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : (
        <section className="aap-step__section">
          <div className="aap-card">
            <h3 className="aap-card__title">SSH Target</h3>
            <div className="aap-form-row">
              <FormField label="Target Host IP / Hostname" required>
                <TextInput
                  value={config.target_host}
                  onChange={(v) => updateConfig({ target_host: v })}
                  placeholder="192.0.2.1"
                />
              </FormField>
              <FormField label="SSH User" required>
                <TextInput
                  value={config.target_user}
                  onChange={(v) => updateConfig({ target_user: v })}
                  placeholder="aap"
                />
              </FormField>
            </div>
            <FormField label="SSH Password" required>
              <TextInput
                value={config.target_password}
                onChange={(v) => updateConfig({ target_password: v })}
                placeholder="SSH password"
                type="password"
              />
            </FormField>
          </div>
        </section>
      )}

      <section className="aap-step__section">
        <div className="aap-card">
          <div className="aap-card__header">
            <div>
              <h3 className="aap-card__title">Deployment Mode</h3>
            </div>
            <SwitchInput
              checked={config.dry_run}
              onChange={(v) => updateConfig({ dry_run: v })}
              label={config.dry_run ? 'Dry Run' : 'Full Install'}
            />
          </div>
        </div>
      </section>

      <section className="aap-step__section">
        <div className="aap-card">
          <dl className="aap-dl">
            <dt className="aap-dl__title">Deployment Overview</dt>
            {(isOCP
              ? [
                  ['Platform', 'OpenShift (Operator)'],
                  ['Topology', isGrowth ? 'Growth (All-in-One)' : 'Enterprise (Multi-Node)'],
                  ['EULA Accepted', config.eula_accepted ? 'Yes' : 'No'],
                ]
              : [
                  ['Platform', 'Containerized (RHEL)'],
                  ['Topology', isGrowth ? 'Growth (All-in-One)' : 'Enterprise (Multi-Node)'],
                  ['Installation Type', config.installation_type === 'online' ? 'Online' : 'Disconnected (Bundled)'],
                  ['Install Directory', config.install_dir],
                  ['Redis Mode', config.redis_mode],
                  ['EULA Accepted', config.eula_accepted ? 'Yes' : 'No'],
                ]
            ).map(([label, value]) => (
              <div key={String(label)} className="aap-dl__row">
                <dt className="aap-dl__term">{label}</dt>
                <dd className={`aap-dl__value ${label === 'Install Directory' ? 'aap-dl__value--mono' : ''}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {!isOCP && (
        <section className="aap-step__section">
          <div className="aap-card">
            <dl className="aap-dl">
              <dt className="aap-dl__title">Hosts</dt>
              {[
                ['Gateway', config.gateway.hosts.join(', ')],
                ['Controller', config.controller.hosts.join(', ')],
                ['Hub', config.hub.hosts.join(', ')],
                ['EDA', config.eda.hosts.join(', ')],
              ].map(([label, value]) => (
                <div key={String(label)} className="aap-dl__row">
                  <dt className="aap-dl__term">{label}</dt>
                  <dd className="aap-dl__value aap-dl__value--mono">{value}</dd>
                </div>
              ))}
              {config.execution_nodes.length > 0 && (
                <div className="aap-dl__row">
                  <dt className="aap-dl__term">Execution/Hop Nodes</dt>
                  <dd className="aap-dl__value aap-dl__value--mono">
                    {config.execution_nodes.map((n) => `${n.host} (${n.receptor_type})`).join(', ')}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </section>
      )}

      {!isOCP && (
        <section className="aap-step__section">
          <div className="aap-card">
            <dl className="aap-dl">
              <dt className="aap-dl__title">Network & Security</dt>
              {[
                ['HTTPS Port', String(config.network.https_port)],
                ['HTTP Port', String(config.network.http_port)],
                [
                  'TLS',
                  config.network.tls.disable_https
                    ? 'Disabled'
                    : config.network.tls.custom_ca_cert
                      ? 'Custom certificates'
                      : 'Self-signed (auto-generated)',
                ],
              ].map(([label, value]) => (
                <div key={String(label)} className="aap-dl__row">
                  <dt className="aap-dl__term">{label}</dt>
                  <dd className="aap-dl__value">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      <section className="aap-step__section">
        <div className="aap-card">
          <dl className="aap-dl">
            <dt className="aap-dl__title">Database</dt>
            {[
              ['Type', config.database.type === 'managed' ? 'Managed (Included)' : 'External'],
              ['Admin User', config.database.admin_username],
              ['Admin Password', maskPassword(config.database.admin_password)],
            ].map(([label, value]) => (
              <div key={String(label)} className="aap-dl__row">
                <dt className="aap-dl__term">{label}</dt>
                <dd className="aap-dl__value">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="aap-step__section">
        <div className="aap-card">
          <dl className="aap-dl">
            <dt className="aap-dl__title">Admin Credentials</dt>
            {[
              ['Gateway', config.gateway.admin_password],
              ['Controller', config.controller.admin_password],
              ['Hub', config.hub.admin_password],
              ['EDA', config.eda.admin_password],
            ].map(([label, pw]) => (
              <div key={String(label)} className="aap-dl__row">
                <dt className="aap-dl__term">{label} Admin Password</dt>
                <dd className="aap-dl__value">{maskPassword(pw)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {!isOCP && <section className="aap-step__section">
        <div className="aap-code-block">
          <div className="aap-code-block__header">
            <span className="aap-code-block__title">Generated Inventory File</span>
            <div className="aap-code-block__actions">
              <button
                type="button"
                className="aap-btn aap-btn--secondary aap-btn--sm"
                onClick={() => setShowInventory(!showInventory)}
                aria-expanded={showInventory}
              >
                {showInventory ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="aap-btn aap-btn--secondary aap-btn--sm"
                onClick={handleCopy}
                aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                className="aap-btn aap-btn--secondary aap-btn--sm"
                onClick={() => downloadTextFile(inventoryPreview, 'inventory')}
                aria-label="Download inventory file"
              >
                Download
              </button>
            </div>
          </div>
          {showInventory && (
            <pre className="aap-code-block__body">{inventoryPreview}</pre>
          )}
        </div>
      </section>}
    </div>
  );
}
