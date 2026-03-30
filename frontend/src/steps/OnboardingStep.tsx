import React, { useState } from 'react';
import {
  CheckCircleIcon,
  ExternalLinkAltIcon,
  SyncAltIcon,
  ArrowRightIcon,
  OutlinedPlayCircleIcon,
} from '@patternfly/react-icons';
import type { DeploymentConfig, OnboardingProgress } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

interface OnboardingTask {
  key: keyof OnboardingProgress;
  title: string;
  description: string;
  doItForMeLabel: string;
  apiEndpoint: string;
  helpUrl: string;
}

const TASKS: OnboardingTask[] = [
  {
    key: 'manifest_uploaded',
    title: 'Upload Subscription Manifest',
    description:
      'Download your subscription manifest from access.redhat.com and upload it to the AAP Gateway to activate your entitlements.',
    doItForMeLabel: 'Upload Manifest',
    apiEndpoint: '/api/onboard/manifest',
    helpUrl: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/getting_started',
  },
  {
    key: 'project_created',
    title: 'Create Your First Project',
    description:
      'Connect a Git repository containing your Ansible playbooks, roles, or collections to the Automation Controller.',
    doItForMeLabel: 'Create Sample Project',
    apiEndpoint: '/api/onboard/project',
    helpUrl: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/using_automation_controller',
  },
  {
    key: 'inventory_created',
    title: 'Add Managed Hosts',
    description:
      'Create an inventory with the hosts you want to automate. Add machine credentials for SSH access.',
    doItForMeLabel: 'Create Demo Inventory',
    apiEndpoint: '/api/onboard/inventory',
    helpUrl: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/using_automation_controller',
  },
  {
    key: 'template_created',
    title: 'Create a Job Template',
    description:
      'Combine your project, inventory, and credentials into a reusable job template that can be launched on demand or on a schedule.',
    doItForMeLabel: 'Create Demo Template',
    apiEndpoint: '/api/onboard/template',
    helpUrl: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/using_automation_controller',
  },
  {
    key: 'job_launched',
    title: 'Run Your First Job',
    description:
      'Launch your job template and watch the automation run in real time. Review the output to verify everything works.',
    doItForMeLabel: 'Launch Demo Job',
    apiEndpoint: '/api/onboard/launch',
    helpUrl: 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/using_automation_controller',
  },
];

export function OnboardingStep({ config, updateConfig }: Props) {
  const progress = config.onboarding;
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  const host = config.target_host || config.gateway.hosts[0];
  const port = config.network.https_port;
  const gatewayUrl = `https://${host}${port === 443 ? '' : `:${port}`}`;

  const updateProgress = (key: keyof OnboardingProgress, value: boolean) => {
    updateConfig({
      onboarding: { ...progress, [key]: value },
    });
  };

  const handleDoItForMe = async (task: OnboardingTask) => {
    setRunningTask(task.key);
    setTaskError(null);
    try {
      const res = await fetch(task.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway_url: gatewayUrl, config }),
      });
      const data = await res.json();
      if (data.success) {
        updateProgress(task.key, true);
      } else {
        setTaskError(data.error || `Failed to ${task.title.toLowerCase()}`);
      }
    } catch {
      setTaskError('Could not reach the backend API.');
    } finally {
      setRunningTask(null);
    }
  };

  const completedCount = Object.values(progress).filter(Boolean).length;
  const allComplete = completedCount === TASKS.length;

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Get Started with AAP</h2>
        <p className="aap-step__description">
          Follow these steps to set up your first automation workflow. You can do each step manually
          in the AAP UI or let the wizard do it for you.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <div className="aap-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 className="aap-card__title">Onboarding Progress</h3>
            <p className="aap-text-muted aap-text-sm">
              {allComplete
                ? 'All done! You\'re ready to automate.'
                : `${completedCount} of ${TASKS.length} steps completed`}
            </p>
          </div>
          <a
            href={gatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="aap-btn aap-btn--primary"
          >
            Open AAP <ExternalLinkAltIcon aria-hidden="true" />
          </a>
        </div>

        <div
          className="aap-mt-md"
          style={{
            height: 8,
            borderRadius: 4,
            background: 'var(--pf-v6-global--BorderColor--100)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${(completedCount / TASKS.length) * 100}%`,
              height: '100%',
              background: 'var(--pf-v6-global--success-color--100)',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      <div className="aap-deploy-phases" role="list">
        {TASKS.map((task, i) => {
          const isDone = progress[task.key];
          const isRunning = runningTask === task.key;
          const isPrevDone = i === 0 || progress[TASKS[i - 1].key];

          return (
            <div
              key={task.key}
              className={`aap-card aap-mb-md ${isDone ? 'aap-phase--complete' : ''}`}
              role="listitem"
              style={{ opacity: isPrevDone || isDone ? 1 : 0.5 }}
            >
              <div className="aap-flex-row" style={{ gap: 16, alignItems: 'flex-start' }}>
                <div
                  className="aap-nav-indicator"
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    background: isDone ? 'var(--pf-v6-global--success-color--100)' : undefined,
                    color: isDone ? '#fff' : undefined,
                  }}
                >
                  {isDone ? <CheckCircleIcon /> : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="aap-card__title aap-mb-sm">{task.title}</div>
                  <p className="aap-text-muted aap-text-sm">{task.description}</p>

                  {taskError && runningTask === null && i === TASKS.findIndex(t => !progress[t.key]) && (
                    <div className="aap-alert aap-alert--danger aap-mt-sm" role="alert">
                      <p className="aap-text-sm">{taskError}</p>
                    </div>
                  )}

                  {!isDone && isPrevDone && (
                    <div className="aap-flex-row aap-mt-md" style={{ gap: 12 }}>
                      <button
                        type="button"
                        className="aap-btn aap-btn--primary aap-btn--sm"
                        onClick={() => handleDoItForMe(task)}
                        disabled={isRunning}
                      >
                        {isRunning ? (
                          <><SyncAltIcon className="aap-spin" /> Working...</>
                        ) : (
                          <><OutlinedPlayCircleIcon /> {task.doItForMeLabel}</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="aap-btn aap-btn--secondary aap-btn--sm"
                        onClick={() => updateProgress(task.key, true)}
                      >
                        Mark as Done <ArrowRightIcon />
                      </button>
                      <a
                        href={task.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aap-btn aap-btn--tertiary aap-btn--sm"
                      >
                        Documentation <ExternalLinkAltIcon />
                      </a>
                    </div>
                  )}

                  {isDone && (
                    <div className="aap-text-success aap-text-sm aap-mt-sm">
                      <CheckCircleIcon /> Completed
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {allComplete && (
        <div className="aap-card aap-mt-lg" style={{ textAlign: 'center', padding: 32 }}>
          <CheckCircleIcon style={{ fontSize: 48, color: 'var(--pf-v6-global--success-color--100)' }} />
          <h3 className="aap-card__title aap-mt-md">You're All Set!</h3>
          <p className="aap-text-muted aap-mt-sm">
            Your AAP deployment is configured and your first automation workflow is ready.
            Explore the platform to discover more capabilities.
          </p>
          <a
            href={gatewayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="aap-btn aap-btn--primary aap-mt-lg"
          >
            Go to AAP <ExternalLinkAltIcon aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}
