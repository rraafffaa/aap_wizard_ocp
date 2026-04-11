import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CheckIcon,
  TimesIcon,
  TimesCircleIcon,
  SpinnerIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ExportIcon,
  AngleDownIcon,
} from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';
import { downloadTextFile } from '../types';
import { startDeploy, cancelDeploy, getDeployStatus, connectDeployWebSocket, diagnoseError, generateInventory, generateCRYaml, type AIDiagnosis } from '../api';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  onComplete: () => void;
  onBack: () => void;
}

interface Phase {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export const INITIAL_PHASES: Phase[] = [
  { id: 'validate', label: 'Validating configuration', status: 'pending' },
  { id: 'prepare', label: 'Preparing target host', status: 'pending' },
  { id: 'inventory', label: 'Generating inventory file', status: 'pending' },
  { id: 'upload', label: 'Uploading installer to target host', status: 'pending' },
  { id: 'preflight', label: 'Running pre-flight checks', status: 'pending' },
  { id: 'install', label: 'Running AAP installer playbook', status: 'pending' },
  { id: 'post_install', label: 'Post-install validation', status: 'pending' },
  { id: 'complete', label: 'Deployment complete', status: 'pending' },
];

export const OCP_PHASES: Phase[] = [
  { id: 'connecting', label: 'Connecting to cluster', status: 'pending' },
  { id: 'namespace', label: 'Creating namespace', status: 'pending' },
  { id: 'operator_check', label: 'Checking for AAP operator', status: 'pending' },
  { id: 'operator_install', label: 'Installing AAP operator', status: 'pending' },
  { id: 'operator_wait', label: 'Waiting for operator readiness', status: 'pending' },
  { id: 'cr_apply', label: 'Applying AnsibleAutomationPlatform CR', status: 'pending' },
  { id: 'reconciliation', label: 'Waiting for AAP reconciliation', status: 'pending' },
  { id: 'routes', label: 'Retrieving access routes', status: 'pending' },
  { id: 'validation', label: 'Validating deployment', status: 'pending' },
];

type Status = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export function getLineVariant(line: string): string {
  if (line.includes('[ERROR]') || line.includes('FAILED')) return 'aap-console__line--error';
  if (line.includes('[OK]') || line.includes('ok=')) return 'aap-console__line--ok';
  if (line.includes('[INFO]') || line.includes('[WARN]')) return 'aap-console__line--info';
  if (line.includes('changed=')) return 'aap-console__line--changed';
  return '';
}

/** Safely render a line of markdown-like text (bold + inline code) without dangerouslySetInnerHTML. */
function renderMarkdownLine(line: string): React.ReactNode {
  // Split on **bold** and `code` patterns, rendering as React elements
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;
  const pattern = /(\*\*(.+?)\*\*|`([^`]+)`)/;
  while (remaining) {
    const match = pattern.exec(remaining);
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<code key={key++}>{match[3]}</code>);
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return parts;
}

export function DeployStep({ config, updateConfig, sessionId, setSessionId, onComplete, onBack }: Props) {
  const [phases, setPhases] = useState<Phase[]>(INITIAL_PHASES);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [aiDiagnosis, setAiDiagnosis] = useState<AIDiagnosis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollStatus = useCallback(async (sid: string) => {
    try {
      const st = await getDeployStatus(sid);
      setProgress(st.progress);
      if (st.log_lines?.length) {
        setLogLines(st.log_lines);
      }
      if (st.current_phase) {
        setPhases(prev => prev.map(p => {
          const phaseIdx = prev.findIndex(ph => ph.id === p.id);
          const currentIdx = prev.findIndex(ph => ph.id === st.current_phase);
          if (phaseIdx < currentIdx) return { ...p, status: 'complete' };
          if (phaseIdx === currentIdx) return { ...p, status: 'running' };
          return p;
        }));
      }
      if (st.status === 'completed' || st.status === 'success') {
        setStatus('completed');
        setProgress(100);
        setPhases(prev => prev.map(p => ({ ...p, status: 'complete' })));
        if (st.access_url) {
          updateConfig({ ocp: { ...config.ocp, access_url: st.access_url } });
        }
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (st.status === 'failed') {
        setStatus('failed');
        setError(st.error || 'Deployment failed — see logs for details');
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (st.status === 'cancelled') {
        setStatus('cancelled');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('Session not found') || msg.includes('404')) {
        // Session gone — check if deployment had already finished
        setLogLines(prev => {
          const alreadyDone = prev.some(
            l => l.includes('Deployment — Complete') || l.includes('[PROGRESS] 100%'),
          );
          if (alreadyDone) {
            setStatus('completed');
            setProgress(100);
            setPhases(p => p.map(ph => ({ ...ph, status: 'complete' })));
          } else {
            setStatus('failed');
            setError('Deployment session lost — backend may have restarted. Check cluster status manually.');
          }
          if (pollRef.current) clearInterval(pollRef.current);
          return prev; // no mutation
        });
      }
      // For other errors, keep polling (backend temporarily unreachable)
    }
  }, []);

  const handleWsMessage = useCallback((event: any) => {
    switch (event.type) {
      case 'ws_connected':
        setWsConnected(true);
        break;
      case 'phase_start':
        setPhases(prev => prev.map(p => p.id === event.phase ? { ...p, status: 'running' } : p));
        break;
      case 'phase_complete':
        setPhases(prev => prev.map(p => p.id === event.phase ? { ...p, status: 'complete' } : p));
        if (event.progress != null) setProgress(event.progress);
        break;
      case 'phase_error':
        setPhases(prev => prev.map(p => p.id === event.phase ? { ...p, status: 'error' } : p));
        break;
      case 'log':
        setLogLines(prev => [...prev, event.line]);
        break;
      case 'complete':
        setStatus('completed');
        setProgress(100);
        if (event.access_url) {
          updateConfig({ ocp: { ...config.ocp, access_url: event.access_url } });
        }
        if (pollRef.current) clearInterval(pollRef.current);
        break;
      case 'error':
        setStatus('failed');
        setError(event.message || 'Unknown deployment error');
        break;
      case 'cancelled':
        setStatus('cancelled');
        setError(event.message || 'Deployment cancelled');
        break;
    }
  }, []);

  const isOCP = config.platform === 'openshift';
  const initialPhases = isOCP ? OCP_PHASES : INITIAL_PHASES;

  const handleStart = async () => {
    // Pre-flight validation before starting deploy
    if (isOCP && !config.ocp.token) {
      setStatus('failed');
      setError('OCP authentication token is missing. Go back to the Cluster Connection step and re-enter your token.');
      return;
    }

    setStatus('running');
    setLogLines([]);
    setPhases(initialPhases.map(p => ({ ...p, status: 'pending' })));
    setError('');
    setProgress(0);
    setWsConnected(false);

    let sid = '';
    try {
      const resp = await startDeploy(config);
      sid = resp.session_id;
      setSessionId(sid);
    } catch (err: any) {
      setStatus('failed');
      setError(err.message || 'Failed to start deployment. Please check your connection and try again.');
      return;
    }

    // Start status polling
    pollRef.current = setInterval(() => pollStatus(sid), 3000);

    // OCP deploys use polling only (no WebSocket streaming support)
    if (!isOCP) {
      try {
        wsRef.current = connectDeployWebSocket(sid, {
          onMessage: handleWsMessage,
          onError: (errMsg) => {
            setWsConnected(false);
            setLogLines(prev => [...prev, `[WARN] ${errMsg}`]);
            // don't set failed — polling will recover
          },
          onClose: () => {
            setWsConnected(false);
            // Final poll to get latest status
            setTimeout(() => pollStatus(sid), 1000);
          },
        });
      } catch {
        // WebSocket failed to connect — polling is the fallback
        setLogLines(prev => [...prev, '[WARN] WebSocket unavailable — using polling for status updates']);
      }
    }
  };

  const handleCancel = async () => {
    if (sessionId) {
      try {
        await cancelDeploy(sessionId);
      } catch {}
    }
    wsRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('cancelled');
    setError('Deployment cancelled by user');
  };

  const handleRetry = () => {
    wsRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('idle');
    setError('');
    setAiDiagnosis(null);
    setAiLoading(false);
    setLogLines([]);
    setProgress(0);
    setPhases(INITIAL_PHASES.map(p => ({ ...p, status: 'pending' })));
  };

  const handleAIDiagnose = useCallback(async () => {
    setAiLoading(true);
    setAiDiagnosis(null);
    try {
      const errorLogs = logLines.slice(-50).join('\n');
      const result = await diagnoseError(errorLogs, config as unknown as Record<string, unknown>, sessionId);
      setAiDiagnosis(result);
    } catch {
      setAiDiagnosis({ diagnosis: 'Failed to reach AI service.', commands: [], available: false });
    } finally {
      setAiLoading(false);
    }
  }, [logLines, config, sessionId]);

  // Auto-diagnose on failure
  useEffect(() => {
    if (status === 'failed' && logLines.length > 0 && !aiDiagnosis && !aiLoading) {
      handleAIDiagnose();
    }
  }, [status]);

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showExportMenu]);

  const buildLogContent = () => {
    const header = [
      `AAP Deployment ${status === 'failed' ? 'FAILED' : status === 'completed' ? 'SUCCESS' : status.toUpperCase()} Log`,
      `Session: ${sessionId || 'N/A'}`,
      `Date: ${new Date().toISOString()}`,
      `Target: ${config.target_host}`,
      `Topology: ${config.topology}`,
      `Progress: ${progress}%`,
      '─'.repeat(60),
      '',
    ].join('\n');
    return header + logLines.join('\n');
  };

  const handleExportLogs = () => {
    downloadTextFile(buildLogContent(), `aap-deploy-${sessionId || 'logs'}.txt`);
    setShowExportMenu(false);
  };

  const handleExportInventory = async () => {
    try {
      const data = await generateInventory(config);
      downloadTextFile(data.inventory, `aap-inventory-${sessionId || 'config'}.ini`);
    } catch {
      downloadTextFile(
        '# Inventory generation unavailable.\n# Export the config JSON from the header instead.',
        'aap-inventory-unavailable.ini',
      );
    }
    setShowExportMenu(false);
  };

  const handleExportBundle = async () => {
    const sections: string[] = [];

    // Header
    const headerLines = [
      '╔══════════════════════════════════════════════╗',
      '║   AAP DEPLOYMENT BUNDLE                      ║',
      '╚══════════════════════════════════════════════╝',
      '',
      `Session:   ${sessionId || 'N/A'}`,
      `Date:      ${new Date().toISOString()}`,
    ];
    if (isOCP) {
      headerLines.push(`Cluster:   ${config.ocp.api_url}`);
      headerLines.push(`Namespace: ${config.ocp.namespace}`);
      headerLines.push(`Platform:  OpenShift (Operator)`);
    } else {
      headerLines.push(`Target:    ${config.target_host}`);
      headerLines.push(`Topology:  ${config.topology === 'growth' ? 'Growth (All-in-One)' : 'Enterprise'}`);
      headerLines.push(`Platform:  Containerized (RHEL)`);
    }
    headerLines.push(`Status:    ${status}`);
    headerLines.push(`Progress:  ${progress}%`);
    headerLines.push('');
    sections.push(headerLines.join('\n'));

    // Inventory or CR section depending on platform
    if (isOCP) {
      sections.push('═'.repeat(60));
      sections.push('SECTION: CUSTOM RESOURCE (CR)');
      sections.push('═'.repeat(60));
      sections.push('');
      try {
        const data = await generateCRYaml(config);
        sections.push(data.yaml);
      } catch {
        sections.push('# CR generation unavailable');
      }
      sections.push('');
    } else {
      sections.push('═'.repeat(60));
      sections.push('SECTION: INVENTORY FILE');
      sections.push('═'.repeat(60));
      sections.push('');
      try {
        const data = await generateInventory(config);
        sections.push(data.inventory);
      } catch {
        sections.push('# Inventory unavailable');
      }
      sections.push('');
    }

    // Deploy logs section
    sections.push('═'.repeat(60));
    sections.push(`SECTION: DEPLOYMENT LOG (${logLines.length} lines)`);
    sections.push('═'.repeat(60));
    sections.push('');
    sections.push(logLines.join('\n'));
    sections.push('');

    // Warnings/errors summary
    const warnings = logLines.filter(l => l.includes('[WARN]') || l.includes('warning'));
    const errors = logLines.filter(l => l.includes('[ERROR]') || l.includes('FAILED') || l.includes('fatal'));
    if (warnings.length > 0 || errors.length > 0) {
      sections.push('═'.repeat(60));
      sections.push('SECTION: WARNINGS & ERRORS SUMMARY');
      sections.push('═'.repeat(60));
      sections.push('');
      if (errors.length > 0) {
        sections.push(`ERRORS (${errors.length}):`);
        errors.forEach(e => sections.push(`  ✗ ${e.trim()}`));
        sections.push('');
      }
      if (warnings.length > 0) {
        sections.push(`WARNINGS (${warnings.length}):`);
        warnings.forEach(w => sections.push(`  ⚠ ${w.trim()}`));
        sections.push('');
      }
    }

    // AI Diagnosis if available
    if (aiDiagnosis) {
      sections.push('═'.repeat(60));
      sections.push('SECTION: AI DIAGNOSIS');
      sections.push('═'.repeat(60));
      sections.push('');
      sections.push(aiDiagnosis.diagnosis);
      if (aiDiagnosis.commands.length > 0) {
        sections.push('');
        sections.push('Suggested commands:');
        aiDiagnosis.commands.forEach(c => sections.push(`  $ ${c}`));
      }
      sections.push('');
    }

    downloadTextFile(sections.join('\n'), `aap-deploy-bundle-${sessionId || 'export'}.txt`);
    setShowExportMenu(false);
  };

  const phaseIcon = (s: Phase['status']) => {
    switch (s) {
      case 'pending':
        return null;
      case 'running':
        return <span className="aap-spinner aap-spinner--sm" aria-hidden="true" />;
      case 'complete':
        return <CheckIcon aria-hidden="true" />;
      case 'error':
        return <TimesIcon aria-hidden="true" />;
    }
  };

  const isDryRun = config.dry_run;

  const titleText =
    status === 'idle'
      ? isDryRun
        ? 'Dry Run Mode'
        : 'Ready to Deploy'
      : status === 'running'
        ? isDryRun
          ? 'Running Dry Run...'
          : 'Deploying...'
        : status === 'completed'
          ? isDryRun
            ? 'Dry Run Complete!'
            : 'Deployment Complete!'
          : status === 'cancelled'
            ? 'Deployment Cancelled'
            : 'Deployment Failed';

  const descriptionText =
    status === 'idle'
      ? isDryRun
        ? 'Validates configuration and generates inventory without installing.'
        : 'Click below to begin installing AAP 2.6.'
      : status === 'running'
        ? 'Installation in progress. You can monitor each phase below.'
        : status === 'completed'
          ? 'All phases completed successfully.'
          : status === 'cancelled'
            ? 'Cancelled. Retry or go back to adjust settings.'
            : 'Error occurred. Check the logs, then retry or go back.';

  return (
    <div className="aap-step">
      <header className="aap-step__header">
        <h2 className="aap-step__title">{titleText}</h2>
        <p className="aap-step__description">{descriptionText}</p>
      </header>

      <div className="aap-step__section aap-flex-row aap-mb-lg">
        {status === 'idle' && (
          <>
            <button
              type="button"
              onClick={handleStart}
              className="aap-btn aap-btn--primary"
              aria-label={isDryRun ? 'Run dry run' : 'Begin installation'}
            >
              {isDryRun ? 'Run Dry Run' : 'Begin Installation'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="aap-btn aap-btn--secondary"
              aria-label="Back to review"
            >
              <ArrowLeftIcon aria-hidden="true" /> Back to Review
            </button>
          </>
        )}
        {status === 'running' && (
          <button
            type="button"
            onClick={handleCancel}
            className="aap-btn aap-btn--danger"
            aria-label="Cancel deployment"
          >
            Cancel Deployment
          </button>
        )}
        {(status === 'failed' || status === 'cancelled') && (
          <>
            <button
              type="button"
              onClick={handleRetry}
              className="aap-btn aap-btn--primary"
              aria-label="Retry deployment"
            >
              Retry Deployment
            </button>
            <button
              type="button"
              onClick={onBack}
              className="aap-btn aap-btn--secondary"
              aria-label="Back to review"
            >
              <ArrowLeftIcon aria-hidden="true" /> Back to Review
            </button>
          </>
        )}
        {status === 'completed' && (
          <button
            type="button"
            onClick={onComplete}
            className="aap-btn aap-btn--primary"
            aria-label="View summary"
          >
            View Summary <ArrowRightIcon aria-hidden="true" />
          </button>
        )}
        {logLines.length > 0 && (
          <div ref={exportRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="aap-btn aap-btn--tertiary aap-btn--sm"
              aria-label="Export deployment data"
              aria-expanded={showExportMenu}
              aria-haspopup="menu"
            >
              <ExportIcon aria-hidden /> Export <AngleDownIcon aria-hidden />
            </button>
            {showExportMenu && (
              <div
                role="menu"
                className="aap-card"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  minWidth: 220,
                  zIndex: 100,
                  padding: 0,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="aap-export-menu-item"
                  onClick={handleExportLogs}
                  style={{ display: 'block', width: '100%', padding: '10px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
                >
                  <strong>Deploy Logs</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--aap-text-muted, #888)', marginTop: 2 }}>
                    {logLines.length} lines — includes warnings and errors
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="aap-export-menu-item"
                  onClick={handleExportInventory}
                  style={{ display: 'block', width: '100%', padding: '10px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, borderTop: '1px solid var(--aap-border, #333)' }}
                >
                  <strong>Inventory File</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--aap-text-muted, #888)', marginTop: 2 }}>
                    Generated INI inventory used for this deploy
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="aap-export-menu-item"
                  onClick={handleExportBundle}
                  style={{ display: 'block', width: '100%', padding: '10px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, borderTop: '1px solid var(--aap-border, #333)' }}
                >
                  <strong>Full Bundle</strong>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--aap-text-muted, #888)', marginTop: 2 }}>
                    Inventory + logs + errors + AI diagnosis
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {status !== 'idle' && (
        <>
          <div className="aap-flex-row aap-mb-md" role="status" aria-live="polite">
            <span
              className={`aap-badge ${wsConnected ? 'aap-badge--success' : 'aap-badge--neutral'}`}
              aria-label={wsConnected ? 'Live connection' : 'Polling for updates'}
            >
              {wsConnected ? 'Live connection' : 'Polling for updates'}
            </span>
            {sessionId && (
              <span className="aap-text-mono aap-text-sm" aria-label={`Session: ${sessionId}`}>
                Session: {sessionId.slice(0, 8)}…
              </span>
            )}
          </div>

          <div className="aap-mb-lg">
            <div className="aap-dl__row">
              <span className="aap-dl__term">Overall Progress</span>
              <span className="aap-dl__value">{progress}%</span>
            </div>
            <div
              className="aap-progress"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Deployment progress"
            >
              <div
                className={`aap-progress__bar ${status === 'completed' ? 'aap-progress__bar--success' : ''}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="aap-card aap-mb-lg">
            <h3 className="aap-card__title">Installation Phases</h3>
            <div className="aap-deploy-phases" role="list" aria-label="Installation phases">
              {phases.map((phase) => (
                <div
                  key={phase.id}
                  className={`aap-phase aap-phase--${phase.status}`}
                  role="listitem"
                >
                  <div className="aap-phase__indicator" aria-hidden="true">
                    {phaseIcon(phase.status)}
                  </div>
                  <span>
                    {phase.label}
                    {phase.status === 'running' && (
                      <span className="aap-text-sm"> in progress…</span>
                    )}
                    {phase.status === 'error' && (
                      <span className="aap-text-sm"> failed</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="aap-alert aap-alert--danger aap-mb-lg" role="alert">
              <span className="aap-alert__icon" aria-hidden="true">
                <TimesCircleIcon />
              </span>
              <div className="aap-alert__content">
                <strong className="aap-alert__title">
                  {status === 'cancelled' ? 'Deployment Cancelled' : 'Deployment Error'}
                </strong>
                <p className="aap-text-mono aap-text-sm">{error}</p>
              </div>
            </div>
          )}

          {status === 'failed' && (
            <div className="aap-card aap-mb-lg">
              <div className="aap-card__header">
                <div>
                  <h3 className="aap-card__title">AI Diagnosis</h3>
                  <p className="aap-card__description aap-text-sm">
                    Powered by AI — analyzing error against AAP documentation
                  </p>
                </div>
                <button
                  type="button"
                  className="aap-btn aap-btn--secondary aap-btn--sm"
                  onClick={handleAIDiagnose}
                  disabled={aiLoading}
                >
                  {aiLoading && <span className="aap-spinner aap-spinner--sm" aria-hidden />}
                  {aiLoading ? 'Analyzing...' : aiDiagnosis ? 'Re-analyze' : 'Diagnose'}
                </button>
              </div>
              {aiLoading && !aiDiagnosis && (
                <div className="aap-flex-row aap-mt-md">
                  <span className="aap-spinner aap-spinner--sm" aria-hidden />
                  <span className="aap-text-sm aap-text-muted">Analyzing deployment logs...</span>
                </div>
              )}
              {aiDiagnosis && (
                <div className="aap-mt-md">
                  <div className="aap-ai-diagnosis">
                    {aiDiagnosis.diagnosis.split('\n').map((line, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <br />}
                        {renderMarkdownLine(line)}
                      </React.Fragment>
                    ))}
                  </div>
                  {aiDiagnosis.commands.length > 0 && (
                    <div className="aap-mt-md">
                      <strong className="aap-text-sm">Suggested commands:</strong>
                      {aiDiagnosis.commands.map((cmd, i) => (
                        <pre key={i} className="aap-code-block__body aap-mt-sm" style={{ fontSize: '12px' }}>
                          {cmd}
                        </pre>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="aap-card">
            <div className="aap-console__header">
              <div className="aap-console__dots" aria-hidden="true">
                <span className="aap-console__dot" />
                <span className="aap-console__dot" />
                <span className="aap-console__dot" />
              </div>
              <span>Installation Log</span>
              <span className="aap-text-muted">{logLines.length} lines</span>
            </div>
            <div
              className="aap-console__body"
              ref={logRef}
              role="log"
              aria-label="Deployment log output"
              tabIndex={0}
            >
              {logLines.length === 0 ? (
                <span className="aap-text-muted">
                  {status === 'running' ? 'Waiting for log output…' : 'No log output yet.'}
                </span>
              ) : (
                logLines.map((line, i) => (
                  <div
                    key={i}
                    className={`aap-console__line ${getLineVariant(line)}`}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
