import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { DeploymentConfig, DeployStatus } from '../types';
import { startDeploy, cancelDeploy, getDeployStatus } from '../api';
import { useWebSocket } from './useWebSocket';

export interface DeploymentPhase {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  duration?: number;
  error?: string;
}

export type DeploymentStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolling_back';

export interface DeploymentState {
  status: DeploymentStatus;
  sessionId: string;
  phases: DeploymentPhase[];
  progress: number;
  logLines: string[];
  error: string;
  wsConnected: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  isDryRun: boolean;
  currentPhase: string;
}

export interface DeploymentActions {
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => void;
  reset: () => void;
  exportLogs: () => void;
  retryFromPhase: (phase: string) => Promise<void>;
}

export interface UseDeploymentReturn {
  state: DeploymentState;
  actions: DeploymentActions;
  isActive: boolean;
  isTerminal: boolean;
  canStart: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

const DEFAULT_PHASES: DeploymentPhase[] = [
  { id: 'preflight', label: 'Pre-flight Checks', status: 'pending' },
  { id: 'inventory', label: 'Generate Inventory', status: 'pending' },
  { id: 'setup', label: 'Setup Environment', status: 'pending' },
  { id: 'install', label: 'Install AAP', status: 'pending' },
  { id: 'configure', label: 'Configure Services', status: 'pending' },
  { id: 'verify', label: 'Verification', status: 'pending' },
];

const MAX_LOG_LINES = 10_000;
const POLL_INTERVAL = 3000;

function createInitialState(): DeploymentState {
  return {
    status: 'idle',
    sessionId: '',
    phases: DEFAULT_PHASES.map((p) => ({ ...p })),
    progress: 0,
    logLines: [],
    error: '',
    wsConnected: false,
    startTime: 0,
    endTime: 0,
    duration: 0,
    isDryRun: false,
    currentPhase: '',
  };
}

function computeDuration(startTime: number, endTime: number): number {
  if (!startTime) return 0;
  const end = endTime || Date.now();
  return end - startTime;
}

export function useDeployment(config: DeploymentConfig): UseDeploymentReturn {
  const [state, setState] = useState<DeploymentState>(createInitialState);
  const configRef = useRef(config);
  configRef.current = config;

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, []);

  const wsUrl = useMemo(() => {
    if (!state.sessionId) return '';
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8000';
    return `${protocol}//${host}/ws/deploy/${state.sessionId}`;
  }, [state.sessionId]);

  const handleWsMessage = useCallback((data: any) => {
    if (!mountedRef.current) return;

    setState((prev) => {
      const next = { ...prev };

      if (data.type === 'ws_connected') {
        return { ...prev, wsConnected: true };
      }

      if (data.type === 'log' && data.line) {
        const newLines = [...prev.logLines, data.line];
        if (newLines.length > MAX_LOG_LINES) {
          newLines.splice(0, newLines.length - MAX_LOG_LINES);
        }
        next.logLines = newLines;
      }

      if (data.type === 'phase_update' && data.phase) {
        next.phases = prev.phases.map((p) => {
          if (p.id !== data.phase) return p;
          const updated = { ...p };
          if (data.status) updated.status = data.status;
          if (data.status === 'running' && !updated.startTime) updated.startTime = Date.now();
          if (data.status === 'complete' || data.status === 'error') {
            updated.endTime = Date.now();
            updated.duration = computeDuration(updated.startTime ?? Date.now(), updated.endTime);
          }
          if (data.error) updated.error = data.error;
          return updated;
        });
        next.currentPhase = data.phase;
      }

      if (data.type === 'progress' && typeof data.progress === 'number') {
        next.progress = Math.min(100, Math.max(0, data.progress));
      }

      if (data.type === 'status_update') {
        if (data.status === 'completed') {
          next.status = 'completed';
          next.progress = 100;
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        } else if (data.status === 'failed') {
          next.status = 'failed';
          next.error = data.error || prev.error;
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        } else if (data.status === 'cancelled') {
          next.status = 'cancelled';
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        }
      }

      if (data.type === 'error') {
        next.error = data.message || data.error || 'Unknown deployment error';
      }

      return next;
    });
  }, []);

  const handleWsError = useCallback((error: string) => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, wsConnected: false }));
    startPolling();
  }, []);

  const handleWsClose = useCallback(() => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, wsConnected: false }));
  }, []);

  const wsEnabled = !!state.sessionId && (state.status === 'starting' || state.status === 'running');

  useWebSocket({
    url: wsUrl,
    onMessage: handleWsMessage,
    onError: handleWsError,
    onClose: handleWsClose,
    reconnect: true,
    reconnectInterval: 2000,
    maxReconnectAttempts: 15,
    enabled: wsEnabled,
  });

  const pollStatus = useCallback(async () => {
    if (!mountedRef.current || !state.sessionId) return;

    try {
      const status: DeployStatus = await getDeployStatus(state.sessionId);

      setState((prev) => {
        const next = { ...prev };

        if (status.progress !== undefined) {
          next.progress = status.progress;
        }
        if (status.current_phase) {
          next.currentPhase = status.current_phase;
        }
        if (status.log_lines && status.log_lines.length > prev.logLines.length) {
          next.logLines = status.log_lines.slice(-MAX_LOG_LINES);
        }
        if (status.error) {
          next.error = status.error;
        }

        if (status.status === 'completed' || status.status === 'complete') {
          next.status = 'completed';
          next.progress = 100;
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        } else if (status.status === 'failed' || status.status === 'error') {
          next.status = 'failed';
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        } else if (status.status === 'cancelled') {
          next.status = 'cancelled';
          next.endTime = Date.now();
          next.duration = computeDuration(next.startTime, next.endTime);
        }

        return next;
      });
    } catch {
      // polling failures are non-fatal; next tick will retry
    }
  }, [state.sessionId]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      pollStatus();
    }, POLL_INTERVAL);
  }, [pollStatus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback(() => {
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    durationTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      setState((prev) => {
        if (prev.status !== 'running' && prev.status !== 'starting') return prev;
        return { ...prev, duration: computeDuration(prev.startTime, 0) };
      });
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const isActive = state.status === 'running' || state.status === 'starting';
    if (!isActive) {
      stopPolling();
      stopDurationTimer();
    }
  }, [state.status, stopPolling, stopDurationTimer]);

  const start = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      status: 'starting',
      error: '',
      logLines: [],
      progress: 0,
      phases: DEFAULT_PHASES.map((p) => ({ ...p })),
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      isDryRun: configRef.current.dry_run,
      currentPhase: '',
    }));

    try {
      const result = await startDeploy(configRef.current);
      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        status: 'running',
        sessionId: result.session_id,
      }));

      startDurationTimer();
    } catch (err: any) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'failed',
        error: err.message || 'Failed to start deployment',
        endTime: Date.now(),
        duration: computeDuration(prev.startTime, Date.now()),
      }));
    }
  }, [startDurationTimer]);

  const cancel = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      await cancelDeploy(state.sessionId);
      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        status: 'cancelled',
        endTime: Date.now(),
        duration: computeDuration(prev.startTime, Date.now()),
      }));
    } catch (err: any) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        error: `Cancel failed: ${err.message}`,
      }));
    }
  }, [state.sessionId]);

  const retry = useCallback(() => {
    start();
  }, [start]);

  const resetDeployment = useCallback(() => {
    stopPolling();
    stopDurationTimer();
    setState(createInitialState());
  }, [stopPolling, stopDurationTimer]);

  const exportLogs = useCallback(() => {
    const header = [
      `AAP Deployment Log`,
      `Session: ${state.sessionId || 'N/A'}`,
      `Status: ${state.status}`,
      `Start: ${state.startTime ? new Date(state.startTime).toISOString() : 'N/A'}`,
      `End: ${state.endTime ? new Date(state.endTime).toISOString() : 'N/A'}`,
      `Duration: ${Math.round(state.duration / 1000)}s`,
      `Dry Run: ${state.isDryRun ? 'Yes' : 'No'}`,
      `---`,
      '',
    ];

    const content = [...header, ...state.logLines].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aap-deploy-${state.sessionId || 'log'}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const retryFromPhase = useCallback(
    async (phaseId: string) => {
      setState((prev) => ({
        ...prev,
        status: 'starting',
        error: '',
        progress: 0,
        phases: prev.phases.map((p) => {
          const phaseIdx = prev.phases.findIndex((pp) => pp.id === phaseId);
          const currentIdx = prev.phases.findIndex((pp) => pp.id === p.id);
          if (currentIdx < phaseIdx) return p;
          return { ...p, status: 'pending' as const, startTime: undefined, endTime: undefined, duration: undefined, error: undefined };
        }),
        startTime: Date.now(),
        endTime: 0,
        duration: 0,
        currentPhase: phaseId,
      }));

      try {
        const result = await startDeploy(configRef.current);
        if (!mountedRef.current) return;

        setState((prev) => ({
          ...prev,
          status: 'running',
          sessionId: result.session_id,
        }));

        startDurationTimer();
      } catch (err: any) {
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: err.message || 'Failed to restart deployment',
          endTime: Date.now(),
          duration: computeDuration(prev.startTime, Date.now()),
        }));
      }
    },
    [startDurationTimer],
  );

  const isActive = state.status === 'running' || state.status === 'starting' || state.status === 'rolling_back';
  const isTerminal = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const canStart = state.status === 'idle' || isTerminal;
  const canCancel = state.status === 'running' || state.status === 'starting';
  const canRetry = state.status === 'failed' || state.status === 'cancelled';

  return {
    state,
    actions: {
      start,
      cancel,
      retry,
      reset: resetDeployment,
      exportLogs,
      retryFromPhase,
    },
    isActive,
    isTerminal,
    canStart,
    canCancel,
    canRetry,
  };
}
