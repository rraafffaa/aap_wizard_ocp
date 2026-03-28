import React, { useState } from 'react';
import { PlusCircleIcon, TrashIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, HostInfo } from '../types';
import { FormField, TextInput, NumberInput } from '../components/FormField';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export const defaultHost = (): HostInfo => ({
  hostname: '',
  ip_address: '',
  ssh_user: 'aap',
  ssh_port: 22,
  ssh_key_path: '~/.ssh/id_rsa',
  ssh_password: '',
});

export function HostsStep({ config, updateConfig }: Props) {
  const isGrowth = config.topology === 'growth';
  const [newHost, setNewHost] = useState<HostInfo>(defaultHost());

  const updateGatewayHost = (index: number, value: string) => {
    const hosts = [...config.gateway.hosts];
    hosts[index] = value;
    updateConfig({ gateway: { ...config.gateway, hosts } });
    if (isGrowth) {
      updateConfig({
        controller: { ...config.controller, hosts: [value] },
        hub: { ...config.hub, hosts: [value] },
        eda: { ...config.eda, hosts: [value] },
      });
    }
  };

  const addGatewayHost = () => {
    updateConfig({
      gateway: { ...config.gateway, hosts: [...config.gateway.hosts, ''] },
    });
  };

  const removeGatewayHost = (index: number) => {
    const hosts = config.gateway.hosts.filter((_, i) => i !== index);
    updateConfig({ gateway: { ...config.gateway, hosts } });
  };

  const addRemoteHost = () => {
    if (newHost.hostname) {
      updateConfig({ hosts: [...config.hosts, { ...newHost }] });
      setNewHost(defaultHost());
    }
  };

  const removeRemoteHost = (index: number) => {
    updateConfig({ hosts: config.hosts.filter((_, i) => i !== index) });
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Hosts</h2>
        <p className="aap-step__description">
          Define the AAP component hosts for this topology.
        </p>
      </div>

      <div className="aap-step__section">
        <h3 className="aap-step__section-title">
          {isGrowth ? 'AAP Host' : 'Component Hosts'}
        </h3>
      </div>

      {isGrowth ? (
        <div className="aap-card aap-mb-lg">
          <div className="aap-card__header">
            <h3 className="aap-card__title">All-in-One Host</h3>
            <p className="aap-card__description aap-text-muted aap-text-sm aap-mb-md">
              All AAP components (Gateway, Controller, Hub, EDA, Database) will be installed on this single host.
            </p>
          </div>
          <FormField label="Hostname (FQDN)" required helperText="Must be a fully qualified domain name resolvable via DNS">
            <TextInput
              value={config.gateway.hosts[0] || ''}
              onChange={(v) => updateGatewayHost(0, v)}
              placeholder="aap.example.org"
            />
          </FormField>
        </div>
      ) : (
        <>
          {/* Gateway hosts */}
          <div className="aap-card aap-mb-lg">
            <div className="aap-card__header">
              <h3 className="aap-card__title">Platform Gateway Hosts</h3>
              <p className="aap-card__description aap-text-muted aap-text-sm aap-mb-md">
                The gateway provides the unified entry point for all AAP services. Enterprise topology requires at least 2 for redundancy.
              </p>
            </div>
            {config.gateway.hosts.map((host, i) => (
              <div key={i} className="aap-host-item aap-mb-sm">
                <TextInput
                  value={host}
                  onChange={(v) => updateGatewayHost(i, v)}
                  placeholder={`gateway${i + 1}.example.org`}
                />
                {config.gateway.hosts.length > 1 && (
                  <button
                    type="button"
                    className="aap-btn aap-btn--danger aap-btn--sm"
                    onClick={() => removeGatewayHost(i)}
                    aria-label={`Remove gateway host ${i + 1}`}
                  >
                    <TrashIcon />
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="aap-btn aap-btn--link aap-mt-sm" onClick={addGatewayHost}>
              <PlusCircleIcon />
              Add gateway host
            </button>
          </div>

          {/* Controller hosts */}
          <div className="aap-card aap-mb-lg">
            <div className="aap-card__header">
              <h3 className="aap-card__title">Automation Controller Hosts</h3>
            </div>
            {config.controller.hosts.map((host, i) => (
              <div key={i} className="aap-host-item aap-mb-sm">
                <TextInput
                  value={host}
                  onChange={(v) => {
                    const hosts = [...config.controller.hosts];
                    hosts[i] = v;
                    updateConfig({ controller: { ...config.controller, hosts } });
                  }}
                  placeholder={`controller${i + 1}.example.org`}
                />
              </div>
            ))}
            <button
              type="button"
              className="aap-btn aap-btn--link aap-mt-sm"
              onClick={() =>
                updateConfig({
                  controller: {
                    ...config.controller,
                    hosts: [...config.controller.hosts, ''],
                  },
                })
              }
            >
              <PlusCircleIcon />
              Add controller host
            </button>
          </div>

          {/* Hub hosts */}
          <div className="aap-card aap-mb-lg">
            <div className="aap-card__header">
              <h3 className="aap-card__title">Automation Hub Hosts</h3>
            </div>
            {config.hub.hosts.map((host, i) => (
              <div key={i} className="aap-host-item aap-mb-sm">
                <TextInput
                  value={host}
                  onChange={(v) => {
                    const hosts = [...config.hub.hosts];
                    hosts[i] = v;
                    updateConfig({ hub: { ...config.hub, hosts } });
                  }}
                  placeholder={`hub${i + 1}.example.org`}
                />
              </div>
            ))}
            <button
              type="button"
              className="aap-btn aap-btn--link aap-mt-sm"
              onClick={() =>
                updateConfig({
                  hub: { ...config.hub, hosts: [...config.hub.hosts, ''] },
                })
              }
            >
              <PlusCircleIcon />
              Add hub host
            </button>
          </div>

          {/* EDA hosts */}
          <div className="aap-card aap-mb-lg">
            <div className="aap-card__header">
              <h3 className="aap-card__title">Event-Driven Ansible Hosts</h3>
            </div>
            {config.eda.hosts.map((host, i) => (
              <div key={i} className="aap-host-item aap-mb-sm">
                <TextInput
                  value={host}
                  onChange={(v) => {
                    const hosts = [...config.eda.hosts];
                    hosts[i] = v;
                    updateConfig({ eda: { ...config.eda, hosts } });
                  }}
                  placeholder={`eda${i + 1}.example.org`}
                />
              </div>
            ))}
            <button
              type="button"
              className="aap-btn aap-btn--link aap-mt-sm"
              onClick={() =>
                updateConfig({
                  eda: { ...config.eda, hosts: [...config.eda.hosts, ''] },
                })
              }
            >
              <PlusCircleIcon />
              Add EDA host
            </button>
          </div>

          {/* Execution nodes */}
          <div className="aap-card aap-mb-lg">
            <div className="aap-card__header">
              <h3 className="aap-card__title">Execution & Hop Nodes</h3>
              <p className="aap-card__description aap-text-muted aap-text-sm aap-mb-md">
                Execution nodes run automation jobs. Hop nodes relay traffic between the controller mesh and isolated networks.
              </p>
            </div>
            {config.execution_nodes.map((node, i) => (
              <div key={i} className="aap-host-item aap-mb-sm">
                <TextInput
                  value={node.host}
                  onChange={(v) => {
                    const nodes = [...config.execution_nodes];
                    nodes[i] = { ...nodes[i], host: v };
                    updateConfig({ execution_nodes: nodes });
                  }}
                  placeholder="exec1.example.org"
                />
                <select
                  className="aap-select"
                  value={node.receptor_type}
                  onChange={(e) => {
                    const nodes = [...config.execution_nodes];
                    nodes[i] = { ...nodes[i], receptor_type: e.target.value as 'execution' | 'hop' };
                    updateConfig({ execution_nodes: nodes });
                  }}
                  aria-label={`Receptor type for node ${i + 1}`}
                >
                  <option value="execution">Execution</option>
                  <option value="hop">Hop</option>
                </select>
                <button
                  type="button"
                  className="aap-btn aap-btn--danger aap-btn--sm"
                  onClick={() =>
                    updateConfig({
                      execution_nodes: config.execution_nodes.filter((_, j) => j !== i),
                    })
                  }
                  aria-label={`Remove execution node ${i + 1}`}
                >
                  <TrashIcon />
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="aap-btn aap-btn--link aap-mt-sm"
              onClick={() =>
                updateConfig({
                  execution_nodes: [
                    ...config.execution_nodes,
                    { host: '', receptor_type: 'execution' },
                  ],
                })
              }
            >
              <PlusCircleIcon />
              Add execution/hop node
            </button>
          </div>
        </>
      )}

      {/* SSH Configuration for remote hosts */}
      {!isGrowth && (
        <div className="aap-card aap-mb-lg">
          <div className="aap-card__header">
            <h3 className="aap-card__title">SSH Connection Settings</h3>
            <p className="aap-card__description aap-text-muted aap-text-sm aap-mb-md">
              Configure SSH access for the installer to connect to remote hosts.
            </p>
          </div>
          {config.hosts.length === 0 ? (
            <div className="aap-host-list__empty aap-text-muted aap-text-sm">No remote hosts added yet.</div>
          ) : (
            <div className="aap-host-list aap-mb-md">
              {config.hosts.map((host, i) => (
                <div key={i} className="aap-host-item">
                  <span className="aap-host-item__hostname">{host.hostname || '(unnamed)'}</span>
                  <span className="aap-host-item__meta aap-text-muted aap-text-sm">
                    {host.ssh_user}@{host.hostname}:{host.ssh_port}
                  </span>
                  <div className="aap-host-item__actions">
                    <button
                      type="button"
                      className="aap-btn aap-btn--danger aap-btn--sm"
                      onClick={() => removeRemoteHost(i)}
                      aria-label={`Remove host ${host.hostname || i + 1}`}
                    >
                      <TrashIcon />
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="aap-step__section">
            <div className="aap-form-row">
              <FormField label="Hostname">
                <TextInput value={newHost.hostname} onChange={(v) => setNewHost({ ...newHost, hostname: v })} placeholder="host.example.org" />
              </FormField>
              <FormField label="SSH User">
                <TextInput value={newHost.ssh_user} onChange={(v) => setNewHost({ ...newHost, ssh_user: v })} placeholder="aap" />
              </FormField>
            </div>
            <div className="aap-form-row">
              <FormField label="SSH Key Path">
                <TextInput value={newHost.ssh_key_path} onChange={(v) => setNewHost({ ...newHost, ssh_key_path: v })} placeholder="~/.ssh/id_rsa" />
              </FormField>
              <FormField label="SSH Port">
                <NumberInput value={newHost.ssh_port} onChange={(v) => setNewHost({ ...newHost, ssh_port: v })} min={1} max={65535} />
              </FormField>
            </div>
            <button type="button" className="aap-btn aap-btn--primary aap-mt-sm" onClick={addRemoteHost}>
              Add Remote Host
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
