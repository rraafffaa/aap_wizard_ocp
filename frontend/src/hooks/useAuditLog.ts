import { useState, useCallback, useRef } from 'react';
import type { DeploymentConfig, WizardStep } from '../types';
import { computeDiff, flattenDiff } from '../utils/diffEngine';
import type { DiffEntry } from '../utils/diffEngine';
import { generateId } from '../utils/formatters';

export type AuditAction =
  | 'step_enter' | 'step_leave' | 'step_complete'
  | 'config_change' | 'config_import' | 'config_export' | 'config_reset'
  | 'profile_apply' | 'profile_save'
  | 'validation_run' | 'validation_pass' | 'validation_fail'
  | 'preflight_start' | 'preflight_complete'
  | 'deploy_start' | 'deploy_complete' | 'deploy_fail' | 'deploy_cancel'
  | 'session_resume' | 'session_start';

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: AuditAction;
  category: 'navigation' | 'config' | 'deploy' | 'system';
  step?: WizardStep;
  details: string;
  diff?: DiffEntry[];
  metadata?: Record<string, any>;
}

export interface AuditStats {
  totalEntries: number;
  configChanges: number;
  stepsVisited: number;
  timeSpent: Record<string, number>;
  firstEntry: number;
  lastEntry: number;
}

export interface AuditLog {
  entries: AuditEntry[];
  log: (action: AuditAction, details: string, metadata?: Record<string, any>) => void;
  logConfigChange: (oldConfig: DeploymentConfig, newConfig: DeploymentConfig) => void;
  getEntries: (filter?: { category?: string; step?: WizardStep; since?: number }) => AuditEntry[];
  getEntriesByStep: (step: WizardStep) => AuditEntry[];
  exportLog: () => string;
  clearLog: () => void;
  getStats: () => AuditStats;
}

const ACTION_CATEGORIES: Record<AuditAction, AuditEntry['category']> = {
  step_enter: 'navigation',
  step_leave: 'navigation',
  step_complete: 'navigation',
  config_change: 'config',
  config_import: 'config',
  config_export: 'config',
  config_reset: 'config',
  profile_apply: 'config',
  profile_save: 'config',
  validation_run: 'system',
  validation_pass: 'system',
  validation_fail: 'system',
  preflight_start: 'deploy',
  preflight_complete: 'deploy',
  deploy_start: 'deploy',
  deploy_complete: 'deploy',
  deploy_fail: 'deploy',
  deploy_cancel: 'deploy',
  session_resume: 'system',
  session_start: 'system',
};

const AUDIT_STORAGE_KEY = 'aap-wizard-audit';
const MAX_ENTRIES = 2000;

function loadPersistedEntries(): AuditEntry[] {
  try {
    const stored = localStorage.getItem(AUDIT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistEntries(entries: AuditEntry[]): void {
  try {
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage full or unavailable
  }
}

export function useAuditLog(): AuditLog {
  const [entries, setEntries] = useState<AuditEntry[]>(() => loadPersistedEntries());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const log = useCallback(
    (action: AuditAction, details: string, metadata?: Record<string, any>) => {
      const entry: AuditEntry = {
        id: generateId('audit'),
        timestamp: Date.now(),
        action,
        category: ACTION_CATEGORIES[action],
        details,
        metadata,
      };

      if (metadata?.step) {
        entry.step = metadata.step as WizardStep;
      }

      setEntries((prev) => {
        const next = [...prev, entry];
        persistEntries(next);
        return next;
      });
    },
    [],
  );

  const logConfigChange = useCallback(
    (oldConfig: DeploymentConfig, newConfig: DeploymentConfig) => {
      const diff = computeDiff(oldConfig, newConfig);
      const flat = flattenDiff(diff).filter((d) => d.type !== 'unchanged');

      if (flat.length === 0) return;

      const summary =
        flat.length === 1
          ? `Changed ${flat[0].label}`
          : `Changed ${flat.length} settings`;

      const entry: AuditEntry = {
        id: generateId('audit'),
        timestamp: Date.now(),
        action: 'config_change',
        category: 'config',
        details: summary,
        diff: flat,
        metadata: { changeCount: flat.length },
      };

      setEntries((prev) => {
        const next = [...prev, entry];
        persistEntries(next);
        return next;
      });
    },
    [],
  );

  const getEntries = useCallback(
    (filter?: { category?: string; step?: WizardStep; since?: number }): AuditEntry[] => {
      if (!filter) return entriesRef.current;

      return entriesRef.current.filter((e) => {
        if (filter.category && e.category !== filter.category) return false;
        if (filter.step && e.step !== filter.step) return false;
        if (filter.since && e.timestamp < filter.since) return false;
        return true;
      });
    },
    [],
  );

  const getEntriesByStep = useCallback(
    (step: WizardStep): AuditEntry[] => {
      return entriesRef.current.filter((e) => e.step === step);
    },
    [],
  );

  const exportLog = useCallback((): string => {
    const exportData = {
      exported: new Date().toISOString(),
      totalEntries: entriesRef.current.length,
      entries: entriesRef.current.map((e) => ({
        ...e,
        timestampISO: new Date(e.timestamp).toISOString(),
      })),
    };
    return JSON.stringify(exportData, null, 2);
  }, []);

  const clearLog = useCallback(() => {
    setEntries([]);
    localStorage.removeItem(AUDIT_STORAGE_KEY);
  }, []);

  const getStats = useCallback((): AuditStats => {
    const current = entriesRef.current;

    const configChanges = current.filter((e) => e.action === 'config_change').length;

    const stepsVisited = new Set(
      current
        .filter((e) => e.action === 'step_enter' && e.step)
        .map((e) => e.step),
    ).size;

    const timeSpent: Record<string, number> = {};
    const stepEnters: Record<string, number> = {};

    for (const entry of current) {
      if (entry.action === 'step_enter' && entry.step) {
        stepEnters[entry.step] = entry.timestamp;
      }
      if (entry.action === 'step_leave' && entry.step && stepEnters[entry.step]) {
        const duration = entry.timestamp - stepEnters[entry.step];
        timeSpent[entry.step] = (timeSpent[entry.step] || 0) + duration;
        delete stepEnters[entry.step];
      }
    }

    return {
      totalEntries: current.length,
      configChanges,
      stepsVisited,
      timeSpent,
      firstEntry: current.length > 0 ? current[0].timestamp : 0,
      lastEntry: current.length > 0 ? current[current.length - 1].timestamp : 0,
    };
  }, []);

  return {
    entries,
    log,
    logConfigChange,
    getEntries,
    getEntriesByStep,
    exportLog,
    clearLog,
    getStats,
  };
}
