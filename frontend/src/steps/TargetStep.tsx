import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ServerIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  PluggedIcon,
} from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';
import { FormField, TextInput, NumberInput } from '../components/FormField';
import { verifySSH, type SSHVerifyResult } from '../api';
import { StatusFeed } from '../components/StatusFeed';
import { useOperationStatus } from '../hooks/useOperationStatus';

const SSH_STEPS = [
  { id: 'resolve', label: 'Resolving hostname' },
  { id: 'ssh', label: 'Establishing SSH connection' },
  { id: 'verify', label: 'Verifying host identity' },
];

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function TargetStep({ config, updateConfig }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<SSHVerifyResult | null>(null);
  const [error, setError] = useState('');
  const { items, startStep, completeStep, failStep, reset, isRunning, isComplete } =
    useOperationStatus(SSH_STEPS);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [showFeed, setShowFeed] = useState(false);

  // Clear timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const clearAllTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const canVerify =
    config.target_host.trim() !== '' &&
    config.target_user.trim() !== '' &&
    config.target_password.trim() !== '';

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setResult(null);
    setError('');
    setShowFeed(true);
    clearAllTimeouts();
    reset();
    startStep('resolve');

    // Simulate staged progress while the actual SSH call runs
    const t1 = setTimeout(() => {
      completeStep('resolve');
      startStep('ssh');
    }, 2000);
    const t2 = setTimeout(() => {
      completeStep('ssh');
      startStep('verify');
    }, 5000);
    timeoutsRef.current = [t1, t2];

    try {
      const res = await verifySSH({
        host: config.target_host,
        user: config.target_user,
        password: config.target_password,
        port: config.target_ssh_port,
      });
      clearAllTimeouts();
      // Complete all steps on success
      completeStep('resolve');
      completeStep('ssh');
      completeStep('verify', res.connected ? 'Connected' : undefined);
      setResult(res);
    } catch (err: unknown) {
      clearAllTimeouts();
      const message = (err as Error).message || 'Could not reach the backend. Is the server running on port 8000?';
      // Fail whichever step is currently running (or the last one)
      const runningItem = items.find(i => i.status === 'running');
      failStep(runningItem?.id ?? 'resolve', message);
      setError(message);
    } finally {
      setVerifying(false);
    }
  }, [config.target_host, config.target_user, config.target_password, config.target_ssh_port, items, reset, startStep, completeStep, failStep]);

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">SSH Target</h2>
      </div>

      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <div className="aap-card__title">Connection Details</div>
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <ServerIcon />
          </div>
        </div>

        <div className="aap-form-row aap-mb-md">
          <FormField label="Target Host IP / Hostname" required>
            <TextInput
              value={config.target_host}
              onChange={(v) => { updateConfig({ target_host: v }); setResult(null); }}
              placeholder="aap-vm.example.com"
              mono
            />
          </FormField>
          <FormField label="SSH Port" required tooltip="The SSH port on the target host. Change only if your host uses a non-standard port for security hardening.">
            <NumberInput
              value={config.target_ssh_port}
              onChange={(v) => { updateConfig({ target_ssh_port: v }); setResult(null); }}
              min={1}
              max={65535}
            />
          </FormField>
        </div>

        <div className="aap-form-row">
          <FormField label="SSH Username" required>
            <TextInput
              value={config.target_user}
              onChange={(v) => { updateConfig({ target_user: v }); setResult(null); }}
              placeholder="aap"
            />
          </FormField>
          <FormField label="SSH Password" required>
            <TextInput
              value={config.target_password}
              onChange={(v) => { updateConfig({ target_password: v }); setResult(null); }}
              placeholder="Enter SSH password"
              type="password"
            />
          </FormField>
        </div>
      </div>

      <div className="aap-card">
        <div className="aap-card__header">
          <div />
          <button
            type="button"
            className="aap-btn aap-btn--primary"
            onClick={handleVerify}
            disabled={!canVerify || verifying}
            aria-busy={verifying}
          >
            {verifying && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
            <PluggedIcon />
            {verifying ? 'Connecting...' : 'Verify Connection'}
          </button>
        </div>

        {showFeed && (isRunning || isComplete) && (
          <div className="aap-mt-md">
            <StatusFeed items={items} compact />
          </div>
        )}

        {error && (
          <div className="aap-alert aap-alert--danger aap-mt-md" role="alert">
            <span className="aap-alert__icon" aria-hidden><TimesCircleIcon /></span>
            <div className="aap-alert__content">
              <div className="aap-alert__title">Connection test failed</div>
              <p className="aap-text-sm aap-mt-sm">{error}</p>
            </div>
          </div>
        )}

        {result && result.connected && (
          <div className="aap-alert aap-alert--success aap-mt-md" role="status">
            <span className="aap-alert__icon" aria-hidden><CheckCircleIcon /></span>
            <div className="aap-alert__content">
              <div className="aap-alert__title">Connection successful</div>
              <div className="aap-mt-sm">
                <dl className="aap-dl aap-dl--inline">
                  <div className="aap-dl__row">
                    <dt className="aap-dl__term">Hostname</dt>
                    <dd className="aap-dl__value aap-dl__value--mono">{result.hostname}</dd>
                  </div>
                  <div className="aap-dl__row">
                    <dt className="aap-dl__term">OS</dt>
                    <dd className="aap-dl__value">{result.os}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}

        {result && !result.connected && (
          <div className="aap-alert aap-alert--danger aap-mt-md" role="alert">
            <span className="aap-alert__icon" aria-hidden><TimesCircleIcon /></span>
            <div className="aap-alert__content">
              <div className="aap-alert__title">Connection failed</div>
              <p className="aap-text-sm aap-mt-sm aap-text-mono">{result.error}</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
