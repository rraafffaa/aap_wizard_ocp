import React, { useState, useEffect, useRef } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon, SyncAltIcon, InProgressIcon } from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';
import { getStoredToken } from '../api';
import { StatusFeed } from '../components/StatusFeed';
import { useOperationStatus } from '../hooks/useOperationStatus';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

type OperatorStatus = 'unknown' | 'checking' | 'not_installed' | 'installing' | 'installed' | 'error';

const INSTALL_STEPS = [
  { id: 'subscription', label: 'Creating operator subscription' },
  { id: 'catalog', label: 'Resolving from catalog source' },
  { id: 'pods', label: 'Starting operator pods' },
  { id: 'csv', label: 'Waiting for ClusterServiceVersion' },
  { id: 'ready', label: 'Operator ready' },
];

export function OperatorStep({ config, updateConfig }: Props) {
  const ocp = config.ocp;
  const [status, setStatus] = useState<OperatorStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const [installing, setInstalling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const { items: installItems, startStep, completeStep, failStep, reset, isRunning: feedActive, isComplete: feedComplete } = useOperationStatus(INSTALL_STEPS);
  const [showFeed, setShowFeed] = useState(false);

  const updateOCP = (partial: Partial<typeof ocp>) => {
    updateConfig({ ocp: { ...ocp, ...partial } });
  };

  const checkOperatorStatus = async () => {
    setStatus('checking');
    try {
      const qs = new URLSearchParams({ api_url: ocp.api_url, token: ocp.token, namespace: ocp.namespace });
      const res = await fetch(`/api/ocp/operator/status?${qs}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
      });
      const data = await res.json();
      if (data.installed) {
        setStatus('installed');
        setStatusMessage(`AAP Operator ${data.version || ''} is installed and ready.`);
        updateOCP({ operator_installed: true });
      } else {
        setStatus('not_installed');
        setStatusMessage('AAP Operator is not installed on this cluster.');
      }
    } catch {
      setStatus('error');
      setStatusMessage('Could not check operator status. Is the cluster connected?');
    }
  };

  const installOperator = async () => {
    setInstalling(true);
    setStatus('installing');
    setStatusMessage('Installing AAP Operator from OperatorHub...');
    reset();
    setShowFeed(true);
    startStep('subscription');
    pollCountRef.current = 0;
    try {
      const res = await fetch('/api/ocp/operator/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({ api_url: ocp.api_url, token: ocp.token, channel: ocp.operator_channel, namespace: ocp.namespace }),
      });
      const data = await res.json();
      if (data.status === 'started' || data.success) {
        completeStep('subscription');
        startStep('catalog');
        // Start polling for installation completion
        pollRef.current = setInterval(async () => {
          pollCountRef.current += 1;
          const count = pollCountRef.current;
          // Advance feed steps based on poll count
          if (count === 3) {
            completeStep('catalog');
            startStep('pods');
          } else if (count === 5) {
            completeStep('pods');
            startStep('csv');
          }
          try {
            const pollQs = new URLSearchParams({ api_url: ocp.api_url, token: ocp.token, namespace: ocp.namespace });
            const pollRes = await fetch(`/api/ocp/operator/status?${pollQs}`, {
              headers: { 'Authorization': `Bearer ${getStoredToken()}` },
            });
            const pollData = await pollRes.json();
            if (pollData.installed) {
              // Complete all remaining steps
              completeStep('catalog');
              completeStep('pods');
              completeStep('csv');
              completeStep('ready', `Version ${pollData.version || 'detected'}`);
              setStatus('installed');
              setStatusMessage(`AAP Operator ${pollData.version || ''} installed successfully.`);
              updateOCP({ operator_installed: true });
              setInstalling(false);
              if (pollRef.current) clearInterval(pollRef.current);
            } else if (pollData.error) {
              // Fail the current active step
              const activeId = count < 3 ? 'catalog' : count < 5 ? 'pods' : 'csv';
              failStep(activeId, pollData.error);
              setStatus('error');
              setStatusMessage(pollData.error);
              setInstalling(false);
              if (pollRef.current) clearInterval(pollRef.current);
            }
          } catch {}
        }, 5000);
      } else {
        failStep('subscription', data.error || 'Failed to install operator.');
        setStatus('error');
        setStatusMessage(data.error || 'Failed to install operator.');
        setInstalling(false);
      }
    } catch {
      failStep('subscription', 'Could not reach the backend API.');
      setStatus('error');
      setStatusMessage('Could not reach the backend API.');
      setInstalling(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const statusIcon = () => {
    switch (status) {
      case 'checking':
      case 'installing':
        return <SyncAltIcon className="aap-spin" />;
      case 'installed':
        return <CheckCircleIcon />;
      case 'error':
      case 'not_installed':
        return <ExclamationCircleIcon />;
      default:
        return <InProgressIcon />;
    }
  };

  const statusColor = () => {
    switch (status) {
      case 'installed': return 'aap-alert--success';
      case 'error': return 'aap-alert--danger';
      case 'not_installed': return 'aap-alert--warning';
      default: return 'aap-alert--info';
    }
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">AAP Operator</h2>
        <p className="aap-step__description">
          Install the operator from OperatorHub before deploying.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Operator Channel</h3>
        <div className="aap-form-group aap-mt-md">
          <label htmlFor="operator-channel" className="aap-label">Update Channel</label>
          <select
            id="operator-channel"
            className="aap-input"
            value={ocp.operator_channel}
            onChange={(e) => updateOCP({ operator_channel: e.target.value })}
            disabled={installing}
          >
            <option value="stable-2.6">stable-2.6 (Recommended)</option>
            <option value="stable-2.5">stable-2.5</option>
          </select>
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            Determines the AAP version deployed.
          </p>
        </div>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Operator Status</h3>

        {status !== 'unknown' && (
          <div className={`aap-alert ${statusColor()} aap-mt-md`} role="status">
            {statusIcon()}
            <div>
              <strong>
                {status === 'checking' && 'Checking...'}
                {status === 'installing' && 'Installing...'}
                {status === 'installed' && 'Installed'}
                {status === 'not_installed' && 'Not Installed'}
                {status === 'error' && 'Error'}
              </strong>
              <p className="aap-text-sm">{statusMessage}</p>
            </div>
          </div>
        )}

        <div className="aap-flex-row aap-mt-lg" style={{ gap: 12 }}>
          <button
            type="button"
            className="aap-btn aap-btn--secondary"
            onClick={checkOperatorStatus}
            disabled={status === 'checking' || installing}
          >
            {status === 'checking' ? (
              <><SyncAltIcon className="aap-spin" /> Checking...</>
            ) : (
              'Check Status'
            )}
          </button>

          {(status === 'not_installed' || status === 'error') && (
            <button
              type="button"
              className="aap-btn aap-btn--primary"
              onClick={installOperator}
              disabled={installing}
            >
              {installing ? (
                <><SyncAltIcon className="aap-spin" /> Installing...</>
              ) : (
                'Install Operator'
              )}
            </button>
          )}
        </div>

        {showFeed && (installing || feedComplete) && (
          <div className="aap-mt-lg">
            <StatusFeed items={installItems} title="Installation Progress" />
          </div>
        )}
      </div>

    </div>
  );
}
