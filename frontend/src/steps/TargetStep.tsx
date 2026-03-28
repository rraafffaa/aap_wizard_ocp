import React, { useState, useCallback } from 'react';
import {
  ServerIcon,
  CheckCircleIcon,
  TimesCircleIcon,
  PluggedIcon,
} from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';
import { FormField, TextInput, NumberInput } from '../components/FormField';
import { verifySSH, type SSHVerifyResult } from '../api';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function TargetStep({ config, updateConfig }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<SSHVerifyResult | null>(null);
  const [error, setError] = useState('');

  const canVerify =
    config.target_host.trim() !== '' &&
    config.target_user.trim() !== '' &&
    config.target_password.trim() !== '';

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setResult(null);
    setError('');
    try {
      const res = await verifySSH({
        host: config.target_host,
        user: config.target_user,
        password: config.target_password,
        port: config.target_ssh_port,
      });
      setResult(res);
    } catch (err: unknown) {
      setError((err as Error).message || 'Could not reach the backend. Is the server running on port 8000?');
    } finally {
      setVerifying(false);
    }
  }, [config.target_host, config.target_user, config.target_password, config.target_ssh_port]);

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">SSH Target</h2>
        <p className="aap-step__description">
          Configure the remote RHEL host where AAP will be installed.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <div className="aap-card__title">Connection Details</div>
            <p className="aap-card__description aap-mt-sm">
              Provide SSH connection details, then verify before proceeding.
            </p>
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <ServerIcon />
          </div>
        </div>

        <div className="aap-form-row aap-mb-md">
          <FormField label="Target Host IP / Hostname" required helperText="Example: 10.0.0.15 or aap-vm.example.com">
            <TextInput
              value={config.target_host}
              onChange={(v) => { updateConfig({ target_host: v }); setResult(null); }}
              placeholder="aap-vm.example.com"
              mono
            />
          </FormField>
          <FormField label="SSH Port" required>
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
          <div>
            <div className="aap-card__title">Verify Connection</div>
            <p className="aap-card__description aap-mt-sm">
              Test SSH connectivity to the target host.
            </p>
          </div>
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
                  <div className="aap-dl__row">
                    <dt className="aap-dl__term">Latency</dt>
                    <dd className="aap-dl__value">{result.latency_ms} ms</dd>
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

        {!result && !error && !verifying && (
          <p className="aap-text-sm aap-text-muted aap-mt-md">
            Fill in the fields above and click <strong>Verify Connection</strong> to test SSH access.
          </p>
        )}
      </div>
    </div>
  );
}
