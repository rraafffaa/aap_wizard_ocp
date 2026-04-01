import React, { useState, useRef } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon, SyncAltIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, OCPClusterInfo } from '../types';
import { getStoredToken, clearAuth } from '../api';
import { StatusFeed } from '../components/StatusFeed';
import { useOperationStatus } from '../hooks/useOperationStatus';

const CONNECTION_STEPS = [
  { id: 'connect', label: 'Connecting to cluster API' },
  { id: 'auth', label: 'Authenticating with token' },
  { id: 'details', label: 'Retrieving cluster details' },
];

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function ClusterStep({ config, updateConfig }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [clusterInfo, setClusterInfo] = useState<OCPClusterInfo | null>(null);
  const [error, setError] = useState('');
  const { items, startStep, completeStep, failStep, reset } = useOperationStatus(CONNECTION_STEPS);
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeStepRef = useRef<string>('connect');

  const ocp = config.ocp;

  const updateOCP = (partial: Partial<typeof ocp>) => {
    updateConfig({ ocp: { ...ocp, ...partial } });
  };

  const clearStepTimers = () => {
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
  };

  const verifyConnection = async () => {
    setVerifying(true);
    setError('');
    setClusterInfo(null);
    clearStepTimers();
    reset();
    activeStepRef.current = 'connect';
    startStep('connect');

    stepTimersRef.current.push(
      setTimeout(() => {
        completeStep('connect');
        activeStepRef.current = 'auth';
        startStep('auth');
      }, 2000),
    );
    stepTimersRef.current.push(
      setTimeout(() => {
        completeStep('auth');
        activeStepRef.current = 'details';
        startStep('details');
      }, 4000),
    );

    try {
      const res = await fetch('/api/ocp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({ api_url: ocp.api_url, token: ocp.token }),
      });
      clearStepTimers();
      if (res.status === 401) {
        clearAuth();
        window.location.reload();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        const msg = data.detail || data.error || `Server error (${res.status})`;
        failStep(activeStepRef.current, msg);
        setError(msg);
        return;
      }
      if (data.connected) {
        completeStep('connect');
        completeStep('auth');
        completeStep('details');
        const ci = data.cluster_info || data;
        const mapped: OCPClusterInfo = {
          connected: true,
          api_url: ocp.api_url,
          version: typeof ci.version === 'object' ? ci.version.kubernetes || '' : ci.version || '',
          platform: typeof ci.version === 'object' ? ci.version.platform || '' : ci.platform || '',
          nodes: ci.nodes || [],
          storage_classes: ci.storage_classes || [],
          operators: ci.installed_operators || ci.operators || [],
        };
        setClusterInfo(mapped);
        if (mapped.storage_classes.length > 0 && !ocp.storage_class) {
          updateOCP({ storage_class: mapped.storage_classes[0] });
        }
      } else {
        failStep(activeStepRef.current, data.error || 'Failed to connect to cluster');
        setError(data.error || 'Failed to connect to cluster');
      }
    } catch (err) {
      clearStepTimers();
      failStep(activeStepRef.current, 'Could not reach the backend API');
      setError('Could not reach the backend API. Is the backend running?');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Connect to OpenShift</h2>
      </div>

      <div className="aap-card aap-mb-lg">
        <h3 className="aap-card__title">Cluster Connection</h3>

        <div className="aap-form-group aap-mt-md">
          <label htmlFor="ocp-api-url" className="aap-label">
            API Server URL <span className="aap-required">*</span>
          </label>
          <input
            id="ocp-api-url"
            type="url"
            className="aap-input"
            placeholder="https://api.mycluster.example.com:6443"
            value={ocp.api_url}
            onChange={(e) => updateOCP({ api_url: e.target.value })}
          />
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            Usually <code>https://api.&lt;cluster&gt;:6443</code>
          </p>
        </div>

        <div className="aap-form-group aap-mt-md">
          <label htmlFor="ocp-token" className="aap-label">
            Authentication Token <span className="aap-required">*</span>
          </label>
          <input
            id="ocp-token"
            type="password"
            className="aap-input"
            placeholder="sha256~xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={ocp.token}
            onChange={(e) => updateOCP({ token: e.target.value })}
          />
          <p className="aap-text-muted aap-text-sm aap-mt-sm">
            Requires <code>cluster-admin</code>. Get via <code>oc whoami -t</code> or OpenShift console → Copy login command.
          </p>
        </div>

        <div className="aap-mt-lg">
          <button
            type="button"
            className="aap-btn aap-btn--primary"
            onClick={verifyConnection}
            disabled={verifying || !ocp.api_url || !ocp.token}
          >
            {verifying ? (
              <>
                <SyncAltIcon className="aap-spin" aria-hidden="true" /> Verifying...
              </>
            ) : (
              'Verify Connection'
            )}
          </button>
          <StatusFeed items={items} compact />
        </div>

        {error && (
          <div className="aap-alert aap-alert--danger aap-mt-md" role="alert">
            <ExclamationCircleIcon aria-hidden="true" />
            <div>
              <strong>Connection Failed</strong>
              <p className="aap-text-sm">{error}</p>
            </div>
          </div>
        )}

        {clusterInfo?.connected && (
          <div className="aap-alert aap-alert--success aap-mt-md" role="status">
            <CheckCircleIcon aria-hidden="true" />
            <div>
              <strong>Connected Successfully</strong>
              <p className="aap-text-sm">
                OpenShift {clusterInfo.version} on {clusterInfo.platform}
              </p>
            </div>
          </div>
        )}
      </div>

      {clusterInfo?.connected && (
        <div className="aap-card aap-mt-lg">
          <h3 className="aap-card__title">Cluster Details</h3>
          <dl className="aap-dl" aria-label="Cluster details">
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Version</dt>
              <dd className="aap-dl__value">{clusterInfo.version}</dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Platform</dt>
              <dd className="aap-dl__value">{clusterInfo.platform}</dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Nodes</dt>
              <dd className="aap-dl__value">
                {clusterInfo.nodes.length} ({clusterInfo.nodes.filter(n => n.ready).length} ready)
              </dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Storage Classes</dt>
              <dd className="aap-dl__value">
                {clusterInfo.storage_classes.length > 0
                  ? clusterInfo.storage_classes.join(', ')
                  : 'None detected'}
              </dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Existing Operators</dt>
              <dd className="aap-dl__value">
                {clusterInfo.operators.length > 0
                  ? clusterInfo.operators.join(', ')
                  : 'None relevant'}
              </dd>
            </div>
          </dl>

          {clusterInfo.nodes.length > 0 && (
            <div className="aap-mt-lg">
              <h4 className="aap-card__title aap-mb-md">Node Status</h4>
              <table className="aap-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>CPU</th>
                    <th>Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {clusterInfo.nodes.map((node) => (
                    <tr key={node.name}>
                      <td className="aap-text-mono aap-text-sm">{node.name}</td>
                      <td>
                        <span className={`aap-badge aap-badge--${node.role === 'master' ? 'warning' : 'info'}`}>
                          {node.role}
                        </span>
                      </td>
                      <td>
                        {node.ready ? (
                          <span className="aap-text-success"><CheckCircleIcon /> Ready</span>
                        ) : (
                          <span className="aap-text-danger"><ExclamationCircleIcon /> Not Ready</span>
                        )}
                      </td>
                      <td className="aap-text-mono aap-text-sm">{node.cpu}</td>
                      <td className="aap-text-mono aap-text-sm">{node.memory}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
