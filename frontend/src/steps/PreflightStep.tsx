import React, { useState, useCallback, useRef } from 'react';
import type { DeploymentConfig, PreflightCheck, PreflightResult } from '../types';
import { runPreflight, prepareHost, prepareHostStream, type PrepareResult, type PrepareStreamEvent } from '../api';
import { getStoredToken, BASE } from '../api';
import {
  CheckIcon,
  TimesIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  TimesCircleIcon,
  InfoCircleIcon,
  WrenchIcon,
} from '@patternfly/react-icons';
import { StatusFeed } from '../components/StatusFeed';
import { useOperationStatus } from '../hooks/useOperationStatus';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

const REQUIREMENTS = [
  ['Operating System', 'RHEL 9.4+ or RHEL 10+'],
  ['CPU Cores', 'Minimum 4 cores'],
  ['Memory (RAM)', 'Minimum 16 GB'],
  ['Disk Space', 'Minimum 60 GB available'],
  ['Python 3', 'Required for ansible-core'],
  ['Ansible Core', 'Installation program dependency'],
  ['Podman', 'Container runtime for AAP'],
  ['FQDN Hostname', 'DNS-resolvable hostname'],
  ['Required Ports', '80, 443, 27199 available'],
  ['SSH Connectivity', 'For multi-node deployments'],
] as const;

const OCP_REQUIREMENTS = [
  ['Cluster Connection', 'API server reachable with valid token'],
  ['AAP Operator', 'Installed and in Succeeded phase'],
  ['Namespace', 'Target namespace exists'],
  ['Storage Class', 'Selected storage class available'],
  ['Node Resources', 'Sufficient CPU and memory on worker nodes'],
] as const;

function StatusIcon({ status }: { status: PreflightCheck['status'] }) {
  switch (status) {
    case 'passed':
      return <span className="aap-check__status aap-check__status--passed" aria-hidden><CheckIcon /></span>;
    case 'failed':
      return <span className="aap-check__status aap-check__status--failed" aria-hidden><TimesIcon /></span>;
    case 'warning':
      return <span className="aap-check__status aap-check__status--warning" aria-hidden><ExclamationTriangleIcon /></span>;
    case 'running':
      return <span className="aap-check__status aap-check__status--running" aria-hidden><span className="aap-spinner" /></span>;
    default:
      return <span className="aap-check__status" aria-hidden><MinusCircleIcon /></span>;
  }
}

function ResultIcon({ overall }: { overall: PreflightResult['overall'] }) {
  const modifier = overall === 'passed' ? 'passed' : overall === 'failed' ? 'failed' : 'warning';
  const Icon = overall === 'passed' ? CheckIcon : overall === 'failed' ? TimesIcon : ExclamationTriangleIcon;
  return <div className={`aap-complete__icon aap-complete__icon--${modifier}`} aria-hidden><Icon /></div>;
}

function Badge({ status }: { status: PreflightCheck['status'] }) {
  const modifier = status === 'passed' ? 'success' : status === 'failed' ? 'danger' : 'warning';
  return <span className={`aap-badge aap-badge--${modifier}`}>{status}</span>;
}

function OCPPreflightStep({ config }: { config: DeploymentConfig }) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${BASE}/api/ocp/preflight`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({
          api_url: config.ocp.api_url,
          token: config.ocp.token,
          namespace: config.ocp.namespace,
          storage_class: config.ocp.storage_class,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Preflight failed (${res.status})`);
      }
      setResult(data);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to run pre-flight checks.');
    } finally {
      setLoading(false);
    }
  }, [config]);

  return (
    <div className="aap-step">
      <header className="aap-step__header">
        <h2 className="aap-step__title">Pre-flight Checks</h2>
        <p className="aap-step__description">
          Validate cluster readiness at <strong className="aap-text-mono">{config.ocp.api_url}</strong>.
        </p>
      </header>

      <section className="aap-step__section">
        <button
          type="button"
          className="aap-btn aap-btn--primary aap-mb-lg"
          onClick={run}
          disabled={loading}
          aria-busy={loading}
        >
          {loading && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
          {loading ? 'Running checks...' : result ? 'Re-run Checks' : 'Run Pre-flight Checks'}
        </button>
      </section>

      {error && (
        <div className="aap-alert aap-alert--danger aap-mb-md">
          <span className="aap-alert__icon" aria-hidden><TimesCircleIcon /></span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">Pre-flight check failed</div>
            <p className="aap-text-sm aap-mt-sm">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="aap-card aap-mb-md">
          <div className="aap-flex-row aap-mb-md">
            <ResultIcon overall={result.overall} />
            <div>
              <div className="aap-card__title">
                {result.overall === 'passed'
                  ? 'All checks passed'
                  : result.overall === 'failed'
                    ? 'Some checks failed'
                    : 'Checks completed with warnings'}
              </div>
              <div className="aap-card__description">
                {result.checks.filter((c) => c.status === 'passed').length} passed,{' '}
                {result.checks.filter((c) => c.status === 'warning').length} warnings,{' '}
                {result.checks.filter((c) => c.status === 'failed').length} failed
              </div>
            </div>
          </div>

          <ul className="aap-check-list" role="list">
            {result.checks.map((check, i) => (
              <li key={i} className="aap-check">
                <StatusIcon status={check.status} />
                <div className="aap-flex-1">
                  <div className="aap-check__name">{check.name}</div>
                  <div className="aap-check__message">{check.message}</div>
                  {check.details && (
                    <div className="aap-text-sm aap-text-muted aap-mt-sm aap-text-italic">{check.details}</div>
                  )}
                </div>
                <Badge status={check.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!result && !error && !loading && (
        <div className="aap-card">
          <h3 className="aap-card__title aap-mb-md">What gets checked</h3>
          <div className="aap-requirements__list">
            {OCP_REQUIREMENTS.map(([name, desc]) => (
              <div key={name} className="aap-requirements__item">
                <MinusCircleIcon aria-hidden />
                <div>
                  <div className="aap-text-sm aap-font-medium">{name}</div>
                  <div className="aap-text-sm aap-text-muted">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PreflightStep({ config, updateConfig }: Props) {
  if (config.platform === 'openshift') {
    return <OCPPreflightStep config={config} />;
  }

  return <ContainerizedPreflightStep config={config} updateConfig={updateConfig} />;
}

const DEFAULT_PREPARE_STEPS = [
  { id: 'podman', label: 'Installing podman' },
  { id: 'ansible', label: 'Installing ansible-core' },
  { id: 'firewall_ports', label: 'Configuring firewall ports' },
  { id: 'utilities', label: 'Installing utility packages' },
];

function ContainerizedPreflightStep({ config, updateConfig }: Props) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [showPrepareFeed, setShowPrepareFeed] = useState(false);
  const { items: prepareItems, startStep, completeStep, failStep, reset: resetPrepare, isComplete: prepareFeedComplete } =
    useOperationStatus(DEFAULT_PREPARE_STEPS);
  const seenStepsRef = useRef<Set<string>>(new Set());

  const targetInfo = {
    host: config.target_host,
    user: config.target_user,
    password: config.target_password,
    port: config.target_ssh_port,
  };

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    setPrepareResult(null);
    try {
      const res = await runPreflight(config.hosts, config.topology, config.installation_type, targetInfo);
      setResult(res);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to run pre-flight checks. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [config, targetInfo]);

  const handlePrepare = useCallback(async () => {
    if (!targetInfo) return;
    setPreparing(true);
    setPrepareResult(null);
    setShowPrepareFeed(true);
    resetPrepare();
    seenStepsRef.current = new Set();

    try {
      let finalSuccess = false;
      let finalErrors: string[] = [];

      await prepareHostStream(targetInfo, ['all'], (event: PrepareStreamEvent) => {
        if (event.type === 'start' && event.id) {
          // Only start a step if we haven't seen it yet (multiple commands per step)
          if (!seenStepsRef.current.has(event.id)) {
            seenStepsRef.current.add(event.id);
            startStep(event.id, event.label);
          }
        } else if (event.type === 'complete' && event.id) {
          if (event.status === 'success') {
            completeStep(event.id);
          } else {
            failStep(event.id, event.output || 'Failed');
          }
        } else if (event.type === 'done') {
          finalSuccess = event.success ?? false;
          finalErrors = event.errors ?? [];
        }
      });

      // Build a PrepareResult-like structure from the stream
      const actions = Array.from(seenStepsRef.current).map(id => ({
        command: id,
        description: `Install/configure ${id}`,
        status: prepareItems.find(i => i.id === id)?.status === 'failed' ? 'failed' as const : 'success' as const,
        output: '',
      }));
      setPrepareResult({ success: finalSuccess, actions, errors: finalErrors });

      if (finalSuccess) {
        await run();
      }
    } catch (err: unknown) {
      // Fail any still-running step
      const running = prepareItems.find(i => i.status === 'running');
      if (running) failStep(running.id, (err as Error).message);
      setPrepareResult({ success: false, actions: [], errors: [(err as Error).message] });
    } finally {
      setPreparing(false);
    }
  }, [targetInfo, run, resetPrepare, startStep, completeStep, failStep, prepareItems]);

  const hasFailures = result && (result.overall === 'failed' || result.overall === 'warning');
  const targetLabel = `${config.target_user}@${config.target_host}`;

  return (
    <div className="aap-step">
      <header className="aap-step__header">
        <h2 className="aap-step__title">Pre-flight Checks</h2>
        <p className="aap-step__description">
          Validate requirements on <strong className="aap-text-mono">{targetLabel}</strong>.
        </p>
      </header>

      <section className="aap-step__section">
        <div className="aap-flex-row aap-mb-lg aap-flex-row--wrap">
          <button
            type="button"
            className="aap-btn aap-btn--primary"
            onClick={run}
            disabled={loading || preparing}
            aria-busy={loading}
          >
            {loading && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
            {loading ? 'Running checks...' : result ? 'Re-run Checks' : 'Run Pre-flight Checks'}
          </button>

          {hasFailures && (
            <button
              type="button"
              className="aap-btn aap-btn--secondary"
              onClick={handlePrepare}
              disabled={preparing || loading}
              aria-busy={preparing}
            >
              {preparing && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
              <WrenchIcon />
              {preparing ? 'Preparing host...' : 'Prepare Host'}
            </button>
          )}
        </div>
      </section>

      {showPrepareFeed && (preparing || prepareFeedComplete) && (
        <div className="aap-mb-md">
          <StatusFeed items={prepareItems} title="Host Preparation Progress" />
        </div>
      )}

      {error && (
        <div className="aap-alert aap-alert--danger aap-mb-md">
          <span className="aap-alert__icon" aria-hidden><TimesCircleIcon /></span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">Pre-flight check failed</div>
            <p className="aap-text-sm aap-mt-sm">{error}</p>
          </div>
        </div>
      )}

      {prepareResult && (
        <div className={`aap-alert ${prepareResult.success ? 'aap-alert--success' : 'aap-alert--danger'} aap-mb-md`}>
          <span className="aap-alert__icon" aria-hidden>
            {prepareResult.success ? <CheckIcon /> : <TimesCircleIcon />}
          </span>
          <div className="aap-alert__content">
            <div className="aap-alert__title">
              {prepareResult.success
                ? 'Host prepared successfully — re-running checks'
                : 'Some preparation steps failed'}
            </div>
            <div className="aap-mt-sm">
              {prepareResult.actions.map((action, i) => (
                <div key={i} className="aap-flex-row aap-mb-sm">
                  {action.status === 'success'
                    ? <span className="aap-check__status aap-check__status--passed"><CheckIcon /></span>
                    : <span className="aap-check__status aap-check__status--failed"><TimesIcon /></span>}
                  <span className="aap-text-sm">{action.description}</span>
                  {action.status === 'failed' && action.output && (
                    <span className="aap-text-sm aap-text-muted"> — {action.output.slice(0, 100)}</span>
                  )}
                </div>
              ))}
            </div>
            {prepareResult.errors.length > 0 && (
              <ul className="aap-list aap-mt-sm">
                {prepareResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="aap-card aap-mb-md">
            <div className="aap-flex-row aap-mb-md">
              <ResultIcon overall={result.overall} />
              <div>
                <div className="aap-card__title">
                  {result.overall === 'passed'
                    ? 'All checks passed'
                    : result.overall === 'failed'
                      ? 'Some checks failed'
                      : 'Checks completed with warnings'}
                </div>
                <div className="aap-card__description">
                  {result.checks.filter((c) => c.status === 'passed').length} passed,{' '}
                  {result.checks.filter((c) => c.status === 'warning').length} warnings,{' '}
                  {result.checks.filter((c) => c.status === 'failed').length} failed
                  <span className="aap-text-muted"> — checked on {config.target_host}</span>
                </div>
              </div>
            </div>

            <ul className="aap-check-list" role="list">
              {result.checks.map((check, i) => (
                <li key={i} className="aap-check">
                  <StatusIcon status={check.status} />
                  <div className="aap-flex-1">
                    <div className="aap-check__name">{check.name}</div>
                    <div className="aap-check__message">{check.message}</div>
                    {check.details && (
                      <div className="aap-text-sm aap-text-muted aap-mt-sm aap-text-italic">{check.details}</div>
                    )}
                  </div>
                  <Badge status={check.status} />
                </li>
              ))}
            </ul>
          </div>


        </>
      )}

      {!result && !error && !loading && (
        <div className="aap-card">
          <h3 className="aap-card__title aap-mb-md">What gets checked</h3>
          <div className="aap-requirements__list">
            {REQUIREMENTS.map(([name, desc]) => (
              <div key={name} className="aap-requirements__item">
                <MinusCircleIcon aria-hidden />
                <div>
                  <div className="aap-text-sm aap-font-medium">{name}</div>
                  <div className="aap-text-sm aap-text-muted">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
