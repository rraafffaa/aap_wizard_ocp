import React, { useState, useCallback } from 'react';
import { InfoCircleIcon, CheckIcon, TimesIcon } from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';
import { FormField, TextInput, NumberInput, SwitchInput } from '../components/FormField';
import { checkPorts, type PortCheckResult } from '../api';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function NetworkStep({ config, updateConfig }: Props) {
  const [portResults, setPortResults] = useState<PortCheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [portError, setPortError] = useState('');

  const updateNetwork = (partial: Partial<DeploymentConfig['network']>) => {
    updateConfig({ network: { ...config.network, ...partial } });
  };

  const updateTLS = (partial: Partial<DeploymentConfig['network']['tls']>) => {
    updateConfig({
      network: {
        ...config.network,
        tls: { ...config.network.tls, ...partial },
      },
    });
  };

  const canCheckPorts = config.target_host && config.target_password;

  const handleCheckPorts = useCallback(async () => {
    setChecking(true);
    setPortError('');
    setPortResults([]);
    try {
      const ports = [
        config.network.https_port,
        config.network.http_port,
        config.network.receptor_port,
      ];
      const res = await checkPorts(
        { host: config.target_host, user: config.target_user, password: config.target_password, port: config.target_ssh_port },
        ports,
      );
      setPortResults(res.results);
    } catch (err: unknown) {
      setPortError((err as Error).message || 'Port check failed');
    } finally {
      setChecking(false);
    }
  }, [config]);

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Network & TLS</h2>
      </div>

      {/* Port configuration */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">Service Ports</h3>
        </div>
        <div className="aap-form-row aap-form-row--3col">
          <FormField label="HTTPS Port">
            <NumberInput
              value={config.network.https_port}
              onChange={(v) => updateNetwork({ https_port: v })}
              min={1}
              max={65535}
            />
          </FormField>
          <FormField label="HTTP Port">
            <NumberInput
              value={config.network.http_port}
              onChange={(v) => updateNetwork({ http_port: v })}
              min={1}
              max={65535}
            />
          </FormField>
          <FormField label="Receptor Port" tooltip="Receptor enables mesh networking between AAP nodes for job distribution and remote execution across isolated networks.">
            <NumberInput
              value={config.network.receptor_port}
              onChange={(v) => updateNetwork({ receptor_port: v })}
              min={1}
              max={65535}
            />
          </FormField>
        </div>
      </div>

      {/* TLS Configuration */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <h3 className="aap-card__title">TLS Configuration</h3>
        </div>

        <div className="aap-mb-md">
          <SwitchInput
            checked={!config.network.tls.disable_https}
            onChange={(v) => updateTLS({ disable_https: !v })}
            label="Enable HTTPS (recommended)"
          />
        </div>

        {!config.network.tls.disable_https && (
          <>
            <FormField
              label="Custom CA Certificate (PEM)"
              tooltip="Provide your organization's Certificate Authority if you want browsers and API clients to trust AAP without extra configuration."
            >
              <TextInput
                value={config.network.tls.custom_ca_cert}
                onChange={(v) => updateTLS({ custom_ca_cert: v })}
                placeholder="/path/to/ca-cert.pem"
              />
            </FormField>

            <div className="aap-form-row">
              <FormField
                label="Server Certificate (PEM)"
                helperText="Path to the server certificate file"
              >
                <TextInput
                  value={config.network.tls.custom_server_cert}
                  onChange={(v) => updateTLS({ custom_server_cert: v })}
                  placeholder="/path/to/server-cert.pem"
                />
              </FormField>
              <FormField
                label="Server Private Key (PEM)"
                helperText="Path to the server private key file"
              >
                <TextInput
                  value={config.network.tls.custom_server_key}
                  onChange={(v) => updateTLS({ custom_server_key: v })}
                  placeholder="/path/to/server-key.pem"
                />
              </FormField>
            </div>
          </>
        )}
      </div>

      {/* Required ports info */}
      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <h3 className="aap-card__title">Required Firewall Ports</h3>
          </div>
          {canCheckPorts && (
            <button
              type="button"
              className="aap-btn aap-btn--secondary aap-btn--sm"
              onClick={handleCheckPorts}
              disabled={checking}
              aria-busy={checking}
            >
              {checking && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
              {checking ? 'Checking...' : portResults.length > 0 ? 'Re-check Ports' : 'Test Ports'}
            </button>
          )}
        </div>

        {portError && (
          <div className="aap-alert aap-alert--danger aap-mb-md">
            <span className="aap-alert__icon" aria-hidden><TimesIcon /></span>
            <div className="aap-alert__content">
              <span className="aap-text-sm">{portError}</span>
            </div>
          </div>
        )}

        <table className="aap-table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Protocol</th>
              <th>Service</th>
              <th>Direction</th>
              {portResults.length > 0 && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {[
              [config.network.https_port, 'TCP', 'Platform Gateway (HTTPS)', 'Inbound'],
              [config.network.http_port, 'TCP', 'Platform Gateway (HTTP redirect)', 'Inbound'],
              [config.network.receptor_port, 'TCP', 'Receptor mesh network', 'Bidirectional'],
              [5432, 'TCP', 'PostgreSQL database', 'Internal'],
              [6379, 'TCP', 'Redis', 'Internal'],
              [22, 'TCP', 'SSH (installation)', 'Installer → Hosts'],
            ].map(([port, proto, service, direction], i) => {
              const result = portResults.find((r) => r.port === port);
              return (
                <tr key={i}>
                  <td className="aap-text-mono">{port}</td>
                  <td>{proto}</td>
                  <td>{service}</td>
                  <td>{direction}</td>
                  {portResults.length > 0 && (
                    <td>
                      {result ? (
                        <span className={`aap-badge ${result.open ? 'aap-badge--success' : 'aap-badge--danger'}`}>
                          {result.open ? (
                            <><CheckIcon aria-hidden /> {result.status === 'listening' ? 'In use' : 'Available'}</>
                          ) : (
                            <><TimesIcon aria-hidden /> Blocked</>
                          )}
                        </span>
                      ) : (
                        <span className="aap-text-muted aap-text-sm">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
