import React from 'react';
import { CheckCircleIcon, ExternalLinkAltIcon, TrashIcon, PlusCircleIcon, ExportIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, DeploymentRecord } from '../types';
import { downloadTextFile, exportConfigToFile } from '../types';

interface Props {
  config: DeploymentConfig;
  deploymentRecord?: DeploymentRecord | null;
  onDelete?: () => void;
  onNewDeployment?: () => void;
}

export function CompleteStep({ config, deploymentRecord, onDelete, onNewDeployment }: Props) {
  const isOCP = config.platform === 'openshift';
  const host = config.target_host || config.gateway.hosts[0];
  const port = config.network.https_port;
  const gatewayUrl = isOCP
    ? config.ocp.api_url
    : `https://${host}${port === 443 ? '' : `:${port}`}`;
  const isHistorical = !!deploymentRecord;

  const nextSteps = [
    {
      step: '1',
      title: 'Upload your subscription manifest',
      desc: 'Upload your subscription manifest in the Gateway to activate your subscription.',
    },
    {
      step: '2',
      title: 'Create your first project',
      desc: 'Connect a Git repository containing your Ansible playbooks and roles to the Automation Controller.',
    },
    {
      step: '3',
      title: 'Add managed hosts',
      desc: 'Create an inventory with the hosts you want to manage and configure machine credentials for SSH access.',
    },
    {
      step: '4',
      title: 'Run your first job',
      desc: 'Create a job template, select your project and inventory, then launch your first automation job.',
    },
    {
      step: '5',
      title: 'Explore Event-Driven Ansible',
      desc: 'Set up webhooks and event sources to automatically trigger automation based on real-time events.',
    },
  ];

  const resources = [
    {
      label: 'AAP 2.6 Documentation',
      url: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6',
    },
    {
      label: 'Getting Started Guide',
      url: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/getting_started',
    },
    {
      label: 'Red Hat Customer Portal',
      url: 'https://access.redhat.com',
    },
    {
      label: 'Ansible Galaxy',
      url: 'https://galaxy.ansible.com',
    },
    {
      label: 'Red Hat Learning',
      url: 'https://www.redhat.com/en/services/training/all-courses-exams',
    },
    {
      label: 'Community Support',
      url: 'https://forum.ansible.com',
    },
  ];

  return (
    <div className="aap-step">
      <div className="aap-complete">
        <div className="aap-complete__icon" aria-hidden="true">
          <CheckCircleIcon />
        </div>
        <h1 className="aap-complete__title">
          {isHistorical ? 'Active Deployment' : 'Deployment Successful!'}
        </h1>
        <p className="aap-complete__subtitle">
          {isHistorical
            ? `Deployed on ${new Date(deploymentRecord!.timestamp).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
            : 'AAP 2.6 has been deployed and is ready to use.'}
        </p>
        <div className="aap-flex-row aap-mt-lg" style={{ gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href={gatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="aap-btn aap-btn--primary"
            aria-label="Open AAP Platform in new tab"
          >
            Open Platform <ExternalLinkAltIcon aria-hidden="true" />
          </a>
          {onNewDeployment && (
            <button
              type="button"
              className="aap-btn aap-btn--secondary"
              onClick={onNewDeployment}
              aria-label="Start a new deployment"
            >
              <PlusCircleIcon aria-hidden="true" /> New Deployment
            </button>
          )}
          <button
            type="button"
            className="aap-btn aap-btn--secondary"
            onClick={() => {
              const summaryLines = [
                'AAP Deployment Summary',
                '═'.repeat(40),
                `Date:       ${deploymentRecord ? new Date(deploymentRecord.timestamp).toLocaleString() : new Date().toLocaleString()}`,
                `Platform:   ${isOCP ? 'OpenShift' : 'Containerized'}`,
                `URL:        ${gatewayUrl}`,
              ];
              if (isOCP) {
                summaryLines.push(
                  `Namespace:  ${config.ocp.namespace}`,
                  `Operator:   ${config.ocp.operator_channel}`,
                );
              } else {
                summaryLines.push(
                  `Topology:   ${config.topology === 'growth' ? 'Growth (All-in-One)' : 'Enterprise'}`,
                  `Host:       ${host}`,
                );
              }
              summaryLines.push(
                `Components: Gateway, Controller, Hub, EDA`,
                `Admin User: admin`,
                `Session:    ${deploymentRecord?.id || 'N/A'}`,
                '',
                'Configuration (JSON):',
                '─'.repeat(40),
                JSON.stringify(config, null, 2),
              );
              const summary = summaryLines.join('\n');
              downloadTextFile(summary, `aap-deploy-summary-${deploymentRecord?.id || 'export'}.txt`);
            }}
            aria-label="Export deployment summary"
          >
            <ExportIcon aria-hidden="true" /> Export Summary
          </button>
          {onDelete && (
            <button
              type="button"
              className="aap-btn aap-btn--danger"
              onClick={() => {
                if (confirm('Delete this deployment record? This only removes it from the wizard — it does not affect the running AAP instance.')) {
                  onDelete();
                }
              }}
              aria-label="Delete this deployment record"
            >
              <TrashIcon aria-hidden="true" /> Delete Record
            </button>
          )}
        </div>
      </div>

      <div className="aap-card aap-mt-lg">
        <h2 className="aap-dl__title">Access Details</h2>
        <dl className="aap-dl" aria-label="Access details">
          <div className="aap-dl__row">
            <dt className="aap-dl__term">Platform URL</dt>
            <dd className="aap-dl__value aap-dl__value--mono">
              {isOCP ? (
                <>
                  <span>{config.ocp.api_url}</span>
                  <div className="aap-text-muted aap-text-sm" style={{ marginTop: 4 }}>
                    The AAP web console URL is available via OpenShift Routes once deployment completes.
                  </div>
                </>
              ) : (
                <a href={gatewayUrl} target="_blank" rel="noopener noreferrer">
                  {gatewayUrl}
                </a>
              )}
            </dd>
          </div>
          {isOCP && (
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Namespace</dt>
              <dd className="aap-dl__value aap-dl__value--mono">{config.ocp.namespace}</dd>
            </div>
          )}
          {isOCP && (
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Operator Channel</dt>
              <dd className="aap-dl__value">{config.ocp.operator_channel}</dd>
            </div>
          )}
          <div className="aap-dl__row">
            <dt className="aap-dl__term">{isOCP ? 'Management' : 'Topology'}</dt>
            <dd className="aap-dl__value">
              {isOCP ? 'Operator-Managed' : config.topology === 'growth' ? 'Growth (All-in-One)' : 'Enterprise'}
            </dd>
          </div>
          {!isOCP && (
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Target Host</dt>
              <dd className="aap-dl__value aap-dl__value--mono">{host}</dd>
            </div>
          )}
          <div className="aap-dl__row">
            <dt className="aap-dl__term">Components</dt>
            <dd className="aap-dl__value">Gateway, Controller, Hub, EDA</dd>
          </div>
          <div className="aap-dl__row">
            <dt className="aap-dl__term">Admin Username</dt>
            <dd className="aap-dl__value aap-dl__value--mono">admin</dd>
          </div>
          {deploymentRecord && (
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Session ID</dt>
              <dd className="aap-dl__value aap-dl__value--mono" style={{ fontSize: 12 }}>{deploymentRecord.id}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="aap-card aap-mt-lg">
        <h2 className="aap-card__title">Next Steps</h2>
        <div className="aap-deploy-phases" role="list">
          {nextSteps.map(({ step, title, desc }) => (
            <div key={step} className="aap-phase aap-phase--complete" role="listitem">
              <div className="aap-phase__indicator aap-nav-indicator" aria-hidden="true">
                {step}
              </div>
              <div>
                <div className="aap-card__title aap-mb-md">{title}</div>
                <div className="aap-text-muted aap-text-sm">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="aap-card aap-mt-lg">
        <h2 className="aap-card__title">Useful Resources</h2>
        <div className="aap-selection-grid aap-selection-grid--2col" role="list">
          {resources.map(({ label, url }) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="aap-selection-card"
              role="listitem"
              aria-label={`${label} (opens in new tab)`}
            >
              <ExternalLinkAltIcon className="aap-selection-card__icon" aria-hidden="true" />
              <span className="aap-selection-card__title">{label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
