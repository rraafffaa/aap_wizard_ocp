import React, { useState, useRef } from 'react';
import { CheckCircleIcon, ExclamationCircleIcon, SyncAltIcon, KeyIcon, UserIcon } from '@patternfly/react-icons';
import type { DeploymentConfig, OCPClusterInfo } from '../types';
import { getStoredToken, clearAuth, BASE } from '../api';
import { StatusFeed } from '../components/StatusFeed';
import { useOperationStatus } from '../hooks/useOperationStatus';

type AuthMode = 'credentials' | 'token';

const CRED_CONNECTION_STEPS = [
  { id: 'connect', label: 'Connecting to cluster API' },
  { id: 'login', label: 'Authenticating with credentials' },
  { id: 'details', label: 'Retrieving cluster details' },
];

const TOKEN_CONNECTION_STEPS = [
  { id: 'connect', label: 'Connecting to cluster API' },
  { id: 'auth', label: 'Authenticating with token' },
  { id: 'details', label: 'Retrieving cluster details' },
];

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function ClusterStep({ config, updateConfig }: Props) {
  const [authMode, setAuthMode] = useState<AuthMode>('credentials');
  const [ocpUsername, setOcpUsername] = useState('');
  const [ocpPassword, setOcpPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [clusterInfo, setClusterInfo] = useState<OCPClusterInfo | null>(null);
  const [error, setError] = useState('');
  const connectionSteps = authMode === 'credentials' ? CRED_CONNECTION_STEPS : TOKEN_CONNECTION_STEPS;
  const { items, startStep, completeStep, failStep, reset } = useOperationStatus(connectionSteps);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClusterInfoSuccess = (data: any) => {
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
  };

  const connectWithToken = async (token: string) => {
    const res = await fetch(`${BASE}/api/ocp/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getStoredToken()}`,
      },
      body: JSON.stringify({ api_url: ocp.api_url, token }),
    });
    if (res.status === 401) {
      clearAuth();
      window.location.reload();
      return null;
    }
    return res;
  };

  const verifyWithCredentials = async () => {
    setVerifying(true);
    setError('');
    setClusterInfo(null);
    clearStepTimers();
    reset();
    activeStepRef.current = 'connect';
    startStep('connect');

    try {
      // Step 1: Login with username/password to get token
      stepTimersRef.current.push(
        setTimeout(() => {
          completeStep('connect');
          activeStepRef.current = 'login';
          startStep('login');
        }, 1500),
      );

      const loginRes = await fetch(`${BASE}/api/ocp/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({
          api_url: ocp.api_url,
          username: ocpUsername,
          password: ocpPassword,
        }),
      });

      clearStepTimers();

      if (loginRes.status === 401) {
        const loginData = await loginRes.json();
        completeStep('connect');
        failStep('login', loginData.detail || 'Invalid username or password');
        setError(loginData.detail || 'Invalid username or password');
        return;
      }
      if (!loginRes.ok) {
        const loginData = await loginRes.json();
        const msg = loginData.detail || `Login failed (${loginRes.status})`;
        failStep(activeStepRef.current, msg);
        setError(msg);
        return;
      }

      const loginData = await loginRes.json();
      const token = loginData.token;

      // Store the obtained token
      updateOCP({ token });
      completeStep('connect');
      completeStep('login');
      activeStepRef.current = 'details';
      startStep('details');

      // Step 2: Connect with the obtained token
      const connectRes = await connectWithToken(token);
      if (!connectRes) return;

      const data = await connectRes.json();
      if (!connectRes.ok) {
        failStep('details', data.detail || data.error || `Server error (${connectRes.status})`);
        setError(data.detail || data.error || 'Failed to get cluster details');
        return;
      }

      if (data.connected) {
        completeStep('details');
        handleClusterInfoSuccess(data);
      } else {
        failStep('details', data.error || 'Failed to connect');
        setError(data.error || 'Failed to connect');
      }
    } catch {
      clearStepTimers();
      failStep(activeStepRef.current, 'Connection unavailable');
      setError('Could not reach the service. Please check your connection.');
    } finally {
      setVerifying(false);
    }
  };

  const verifyWithToken = async () => {
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
      const res = await connectWithToken(ocp.token);
      clearStepTimers();
      if (!res) return;

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
        handleClusterInfoSuccess(data);
      } else {
        failStep(activeStepRef.current, data.error || 'Failed to connect to cluster');
        setError(data.error || 'Failed to connect to cluster');
      }
    } catch {
      clearStepTimers();
      failStep(activeStepRef.current, 'Connection unavailable');
      setError('Could not reach the service. Please check your connection.');
    } finally {
      setVerifying(false);
    }
  };

  const verifyConnection = () => {
    if (authMode === 'credentials') {
      verifyWithCredentials();
    } else {
      verifyWithToken();
    }
  };

  const canVerify = authMode === 'credentials'
    ? !!(ocp.api_url && ocpUsername && ocpPassword)
    : !!(ocp.api_url && ocp.token);

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

        {/* Auth mode toggle */}
        <div className="aap-form-group aap-mt-lg">
          <label className="aap-label">Authentication Method</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              className={`aap-btn aap-btn--sm ${authMode === 'credentials' ? 'aap-btn--primary' : 'aap-btn--secondary'}`}
              onClick={() => { setAuthMode('credentials'); setError(''); setClusterInfo(null); reset(); }}
              disabled={verifying}
            >
              <UserIcon aria-hidden="true" /> Username &amp; Password
            </button>
            <button
              type="button"
              className={`aap-btn aap-btn--sm ${authMode === 'token' ? 'aap-btn--primary' : 'aap-btn--secondary'}`}
              onClick={() => { setAuthMode('token'); setError(''); setClusterInfo(null); reset(); }}
              disabled={verifying}
            >
              <KeyIcon aria-hidden="true" /> Token
            </button>
          </div>
        </div>

        {authMode === 'credentials' ? (
          <>
            <div className="aap-form-group aap-mt-md">
              <label htmlFor="ocp-username" className="aap-label">
                Username <span className="aap-required">*</span>
              </label>
              <input
                id="ocp-username"
                type="text"
                className="aap-input"
                placeholder="kubeadmin"
                value={ocpUsername}
                onChange={(e) => setOcpUsername(e.target.value)}
              />
            </div>
            <div className="aap-form-group aap-mt-md">
              <label htmlFor="ocp-password" className="aap-label">
                Password <span className="aap-required">*</span>
              </label>
              <input
                id="ocp-password"
                type="password"
                className="aap-input"
                placeholder="Enter your OpenShift password"
                value={ocpPassword}
                onChange={(e) => setOcpPassword(e.target.value)}
              />
              <p className="aap-text-muted aap-text-sm aap-mt-sm">
                The wizard will securely obtain a bearer token on your behalf &mdash; no need to run <code>oc login</code>.
              </p>
            </div>
          </>
        ) : (
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
              Requires <code>cluster-admin</code>. Get via <code>oc whoami -t</code> or OpenShift console &rarr; Copy login command.
            </p>
          </div>
        )}

        <div className="aap-mt-lg">
          <button
            type="button"
            className="aap-btn aap-btn--primary"
            onClick={verifyConnection}
            disabled={verifying || !canVerify}
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
                {authMode === 'credentials' && ' — token obtained automatically'}
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
