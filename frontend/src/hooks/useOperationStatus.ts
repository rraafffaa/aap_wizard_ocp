import { useState, useRef, useCallback, useEffect } from 'react';

export interface StatusFeedItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail?: string;
  elapsed?: number;
}

interface StepDef {
  id: string;
  label: string;
}

/**
 * Hook to manage multi-step operation progress for the StatusFeed component.
 * Tracks which step is running, elapsed time, and status transitions.
 */
export function useOperationStatus(steps: StepDef[]) {
  const [items, setItems] = useState<StatusFeedItem[]>(
    steps.map(s => ({ id: s.id, label: s.label, status: 'pending' as const }))
  );
  const startTimesRef = useRef<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick elapsed time every second for running items
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setItems(prev => {
        const now = Date.now();
        let changed = false;
        const next = prev.map(item => {
          if (item.status === 'running' && startTimesRef.current[item.id]) {
            changed = true;
            return { ...item, elapsed: now - startTimesRef.current[item.id] };
          }
          return item;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startStep = useCallback((id: string, detail?: string) => {
    startTimesRef.current[id] = Date.now();
    setItems(prev => prev.map(item =>
      item.id === id
        ? { ...item, status: 'running' as const, detail, elapsed: 0 }
        : item
    ));
  }, []);

  const completeStep = useCallback((id: string, detail?: string) => {
    setItems(prev => prev.map(item =>
      item.id === id
        ? { ...item, status: 'success' as const, detail: detail ?? item.detail }
        : item
    ));
  }, []);

  const failStep = useCallback((id: string, detail: string) => {
    setItems(prev => prev.map(item =>
      item.id === id
        ? { ...item, status: 'failed' as const, detail }
        : item
    ));
  }, []);

  const updateDetail = useCallback((id: string, detail: string) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, detail } : item
    ));
  }, []);

  const reset = useCallback(() => {
    startTimesRef.current = {};
    setItems(steps.map(s => ({ id: s.id, label: s.label, status: 'pending' as const })));
  }, [steps]);

  const currentStep = items.find(i => i.status === 'running')?.id ?? null;
  const isRunning = items.some(i => i.status === 'running');
  const isComplete = items.length > 0 && items.every(i => i.status === 'success' || i.status === 'failed');

  return {
    items,
    startStep,
    completeStep,
    failStep,
    updateDetail,
    reset,
    isRunning,
    isComplete,
    currentStep,
  };
}
