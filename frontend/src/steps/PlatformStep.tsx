import React, { useState } from 'react';
import { CheckIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';
import { UIIcon } from '../components/ProductIcon';
import type { DeploymentConfig, DeployPlatform } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function PlatformStep({ config, updateConfig }: Props) {
  const [showComparison, setShowComparison] = useState(false);

  const setPlatform = (p: DeployPlatform) => {
    updateConfig({ platform: p });
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Choose Your Platform</h2>
        <p className="aap-step__description">
          AAP 2.6 can be deployed on a RHEL VM using containers (Podman) or on an OpenShift cluster using the AAP Operator.
          Choose the platform that matches your infrastructure.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <div className="aap-card__title">Which platform is right for me?</div>
            <p className="aap-card__description aap-mt-sm">
              Compare both deployment methods to find the best fit for your environment.
            </p>
          </div>
          <button
            type="button"
            className="aap-btn aap-btn--secondary"
            onClick={() => setShowComparison(!showComparison)}
            aria-expanded={showComparison}
            aria-controls="platform-comparison-table"
          >
            {showComparison ? 'Hide Comparison' : 'Compare Platforms'}
          </button>
        </div>

        {showComparison && (
          <div id="platform-comparison-table" className="aap-mt-lg">
            <table className="aap-table">
              <thead>
                <tr>
                  <th>Aspect</th>
                  <th>Containerized (RHEL)</th>
                  <th>Operator (OpenShift)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Infrastructure', 'RHEL 9 VM(s)', 'OpenShift 4.12+ cluster'],
                  ['Container Runtime', 'Podman', 'CRI-O (managed by OCP)'],
                  ['Installer', 'ansible-playbook + INI inventory', 'AAP Operator + Custom Resource YAML'],
                  ['Scaling', 'Add VMs, re-run installer', 'Change replica count in CR'],
                  ['Upgrades', 'Re-run installer with new tarball', 'Operator handles rolling upgrades'],
                  ['Networking', 'Firewall ports + TLS certs', 'OpenShift Routes (auto-TLS)'],
                  ['Storage', 'Local disk / NFS', 'PersistentVolumeClaims (PVC)'],
                  ['HA / Redundancy', 'Enterprise topology (6+ nodes)', 'Built-in via Kubernetes replicas'],
                  ['Database', 'Managed or external PostgreSQL', 'Managed (operator) or external'],
                  ['Best For', 'Traditional infrastructure, air-gapped', 'Cloud-native, GitOps workflows'],
                  ['Time to Deploy', '~30–60 min', '~15–30 min (cluster ready)'],
                  ['Min Resources', '1 VM, 16 GB RAM, 4 CPUs', '3-node cluster, 48 GB RAM total'],
                ].map(([aspect, containerized, openshift]) => (
                  <tr key={aspect}>
                    <td><strong>{aspect}</strong></td>
                    <td>{containerized}</td>
                    <td>{openshift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aap-selection-grid aap-selection-grid--2col" role="radiogroup" aria-label="Deployment platform">
        <div
          className={`aap-selection-card ${config.platform === 'containerized' ? 'aap-selection-card--selected' : ''}`}
          role="radio"
          aria-checked={config.platform === 'containerized'}
          tabIndex={0}
          onClick={() => setPlatform('containerized')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlatform('containerized'); } }}
        >
          <div className="aap-selection-card__indicator" aria-hidden="true">
            <CheckIcon />
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <UIIcon name="server" size={24} />
          </div>
          <div className="aap-selection-card__title">Containerized (RHEL)</div>
          <div className="aap-selection-card__description">
            Deploy AAP on RHEL 9 using Podman containers. The wizard connects via SSH, generates an inventory file,
            and runs the Ansible installer automatically.
          </div>
          <ul className="aap-selection-card__features">
            <li><CheckIcon aria-hidden="true" /> SSH-based deployment to RHEL VMs</li>
            <li><CheckIcon aria-hidden="true" /> Growth (all-in-one) or Enterprise topology</li>
            <li><CheckIcon aria-hidden="true" /> Works in air-gapped environments</li>
            <li><CheckIcon aria-hidden="true" /> Full control over host configuration</li>
            <li><CheckIcon aria-hidden="true" /> Managed or external PostgreSQL</li>
            <li><CheckIcon aria-hidden="true" /> Bundled installer tarball included</li>
          </ul>
        </div>

        <div
          className={`aap-selection-card ${config.platform === 'openshift' ? 'aap-selection-card--selected' : ''}`}
          role="radio"
          aria-checked={config.platform === 'openshift'}
          tabIndex={0}
          onClick={() => setPlatform('openshift')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlatform('openshift'); } }}
        >
          <div className="aap-selection-card__indicator" aria-hidden="true">
            <CheckIcon />
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <UIIcon name="cluster" size={24} />
          </div>
          <div className="aap-selection-card__title">Operator (OpenShift)</div>
          <div className="aap-selection-card__description">
            Deploy AAP on OpenShift using the AAP Operator from OperatorHub. The wizard connects to your cluster,
            installs the operator, and applies a Custom Resource.
          </div>
          <ul className="aap-selection-card__features">
            <li><CheckIcon aria-hidden="true" /> Kubernetes-native deployment</li>
            <li><CheckIcon aria-hidden="true" /> Operator-managed lifecycle & upgrades</li>
            <li><CheckIcon aria-hidden="true" /> Auto-scaling with replica controls</li>
            <li><CheckIcon aria-hidden="true" /> OpenShift Routes with auto-TLS</li>
            <li><CheckIcon aria-hidden="true" /> PVC-based persistent storage</li>
            <li><CheckIcon aria-hidden="true" /> GitOps-friendly CR export</li>
          </ul>
        </div>
      </div>

      <div className="aap-card aap-mt-lg">
        <div className="aap-card__header">
          <div className="aap-card__title">What Happens Next</div>
        </div>
        <div className="aap-deploy-phases" role="list">
          {config.platform === 'containerized' ? (
            <>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">1</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Choose Installation Type</div>
                  <div className="aap-text-muted aap-text-sm">Select online or disconnected installation and set the install directory.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">2</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Configure SSH Target</div>
                  <div className="aap-text-muted aap-text-sm">Provide your RHEL host details and verify the SSH connection.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">3</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Set Up Components</div>
                  <div className="aap-text-muted aap-text-sm">Configure Gateway, Controller, Hub, EDA, database, networking, and credentials.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">4</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Deploy & Get Started</div>
                  <div className="aap-text-muted aap-text-sm">Run pre-flight checks, review your config, and launch the installer.</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">1</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Connect to OpenShift</div>
                  <div className="aap-text-muted aap-text-sm">Provide your cluster API URL and token, then verify the connection.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">2</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Install AAP Operator</div>
                  <div className="aap-text-muted aap-text-sm">Configure namespace, storage, and install the operator from OperatorHub.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">3</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Configure Components</div>
                  <div className="aap-text-muted aap-text-sm">Set replica counts, credentials, database, routes, and advanced settings.</div>
                </div>
              </div>
              <div className="aap-phase" role="listitem">
                <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">4</div>
                <div>
                  <div className="aap-card__title aap-mb-md">Deploy & Get Started</div>
                  <div className="aap-text-muted aap-text-sm">Apply the Custom Resource and watch the operator reconcile your deployment.</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="aap-card aap-mt-lg">
        <div className="aap-card__header">
          <div className="aap-card__title">Documentation</div>
        </div>
        <div className="aap-selection-grid aap-selection-grid--2col" role="list">
          <a
            href="https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/containerized_installation"
            target="_blank"
            rel="noopener noreferrer"
            className="aap-selection-card"
            role="listitem"
            aria-label="Containerized Installation Guide (opens in new tab)"
          >
            <ExternalLinkAltIcon className="aap-selection-card__icon" aria-hidden="true" />
            <span className="aap-selection-card__title">Containerized Installation Guide</span>
            <span className="aap-selection-card__description">Deploy AAP on RHEL with Podman containers</span>
          </a>
          <a
            href="https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/installing_on_openshift_container_platform"
            target="_blank"
            rel="noopener noreferrer"
            className="aap-selection-card"
            role="listitem"
            aria-label="OpenShift Installation Guide (opens in new tab)"
          >
            <ExternalLinkAltIcon className="aap-selection-card__icon" aria-hidden="true" />
            <span className="aap-selection-card__title">OpenShift Installation Guide</span>
            <span className="aap-selection-card__description">Deploy AAP on OCP using the AAP Operator</span>
          </a>
        </div>
      </div>
    </div>
  );
}
