import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { WizardStep, DeploymentConfig } from '../types';
import { WIZARD_STEPS } from '../types';
import { canProceed } from './useValidation';

export interface StepState {
  currentStep: WizardStep;
  previousStep: WizardStep | null;
  completedSteps: Set<WizardStep>;
  visitedSteps: Set<WizardStep>;
  dirtySteps: Set<WizardStep>;
  stepHistory: WizardStep[];
  isTransitioning: boolean;
}

export interface StepTransition {
  from: WizardStep;
  to: WizardStep;
  direction: 'forward' | 'backward' | 'jump';
  timestamp: number;
  blocked: boolean;
  blockReason?: string;
}

export interface StepGuard {
  step: WizardStep;
  check: (config: DeploymentConfig) => { allowed: boolean; reason?: string };
}

export interface StepMachine {
  state: StepState;
  currentIndex: number;
  canGoNext: boolean;
  canGoBack: boolean;
  nextBlockReason: string | null;

  goNext: () => boolean;
  goBack: () => boolean;
  goToStep: (step: WizardStep) => boolean;

  markCompleted: (step: WizardStep) => void;
  markDirty: (step: WizardStep) => void;
  clearDirty: (step: WizardStep) => void;

  isStepAccessible: (step: WizardStep) => boolean;
  isStepCompleted: (step: WizardStep) => boolean;
  isStepDirty: (step: WizardStep) => boolean;
  isStepVisited: (step: WizardStep) => boolean;

  getTransitionHistory: () => StepTransition[];
  getStepDuration: (step: WizardStep) => number;
  getTotalDuration: () => number;

  reset: () => void;
  restoreState: (savedState: Partial<StepState>) => void;
}

const STEP_IDS = WIZARD_STEPS.map((s) => s.id);

function stepIndex(step: WizardStep): number {
  return STEP_IDS.indexOf(step);
}

function isDeployActive(step: WizardStep): boolean {
  return step === 'deploy';
}

const STEP_STATE_STORAGE_KEY = 'aap-wizard-step-machine';

function createInitialState(): StepState {
  return {
    currentStep: STEP_IDS[0],
    previousStep: null,
    completedSteps: new Set<WizardStep>(),
    visitedSteps: new Set<WizardStep>([STEP_IDS[0]]),
    dirtySteps: new Set<WizardStep>(),
    stepHistory: [STEP_IDS[0]],
    isTransitioning: false,
  };
}

export function useStepMachine(config: DeploymentConfig, guards?: StepGuard[]): StepMachine {
  const [state, setState] = useState<StepState>(createInitialState);

  const transitionHistoryRef = useRef<StepTransition[]>([]);
  const stepTimersRef = useRef<Map<WizardStep, { enter: number; accumulated: number }>>(new Map());
  const sessionStartRef = useRef(Date.now());
  const guardsRef = useRef(guards);
  guardsRef.current = guards;

  useEffect(() => {
    const step = state.currentStep;
    const existing = stepTimersRef.current.get(step);
    if (!existing) {
      stepTimersRef.current.set(step, { enter: Date.now(), accumulated: 0 });
    } else {
      stepTimersRef.current.set(step, { ...existing, enter: Date.now() });
    }
  }, [state.currentStep]);

  const currentIndex = useMemo(() => stepIndex(state.currentStep), [state.currentStep]);

  const checkGuards = useCallback(
    (targetStep: WizardStep): { allowed: boolean; reason?: string } => {
      if (!guardsRef.current) return { allowed: true };

      for (const guard of guardsRef.current) {
        if (guard.step === targetStep) {
          const result = guard.check(config);
          if (!result.allowed) return result;
        }
      }
      return { allowed: true };
    },
    [config],
  );

  const computeForwardBlock = useCallback((): string | null => {
    if (isDeployActive(state.currentStep)) {
      return 'Navigation is blocked during deployment';
    }

    if (currentIndex >= STEP_IDS.length - 1) {
      return 'Already at the last step';
    }

    if (!canProceed(state.currentStep, config)) {
      return 'Please fix validation errors before proceeding';
    }

    const nextStep = STEP_IDS[currentIndex + 1];
    const guardResult = checkGuards(nextStep);
    if (!guardResult.allowed) {
      return guardResult.reason ?? 'Navigation blocked by a guard';
    }

    return null;
  }, [state.currentStep, currentIndex, config, checkGuards]);

  const nextBlockReason = useMemo(() => computeForwardBlock(), [computeForwardBlock]);
  const canGoNext = nextBlockReason === null;
  const canGoBack = currentIndex > 0 && !isDeployActive(state.currentStep);

  const recordTransition = useCallback(
    (from: WizardStep, to: WizardStep, blocked: boolean, blockReason?: string) => {
      const fromIdx = stepIndex(from);
      const toIdx = stepIndex(to);
      let direction: StepTransition['direction'];
      if (toIdx === fromIdx + 1) direction = 'forward';
      else if (toIdx === fromIdx - 1) direction = 'backward';
      else direction = 'jump';

      const transition: StepTransition = {
        from,
        to,
        direction,
        timestamp: Date.now(),
        blocked,
        blockReason,
      };
      transitionHistoryRef.current.push(transition);
    },
    [],
  );

  const accumulateStepTime = useCallback((step: WizardStep) => {
    const timer = stepTimersRef.current.get(step);
    if (timer && timer.enter > 0) {
      const elapsed = Date.now() - timer.enter;
      stepTimersRef.current.set(step, {
        enter: 0,
        accumulated: timer.accumulated + elapsed,
      });
    }
  }, []);

  const transitionTo = useCallback(
    (targetStep: WizardStep): boolean => {
      const fromStep = state.currentStep;

      accumulateStepTime(fromStep);

      setState((prev) => {
        const visitedSteps = new Set(prev.visitedSteps);
        visitedSteps.add(targetStep);

        return {
          ...prev,
          currentStep: targetStep,
          previousStep: fromStep,
          visitedSteps,
          stepHistory: [...prev.stepHistory, targetStep],
          isTransitioning: false,
        };
      });

      recordTransition(fromStep, targetStep, false);
      return true;
    },
    [state.currentStep, accumulateStepTime, recordTransition],
  );

  const goNext = useCallback((): boolean => {
    const blockReason = computeForwardBlock();
    if (blockReason) {
      recordTransition(state.currentStep, STEP_IDS[currentIndex + 1] ?? state.currentStep, true, blockReason);
      return false;
    }

    const nextStep = STEP_IDS[currentIndex + 1];
    setState((prev) => ({
      ...prev,
      completedSteps: new Set(prev.completedSteps).add(prev.currentStep),
    }));

    return transitionTo(nextStep);
  }, [computeForwardBlock, state.currentStep, currentIndex, recordTransition, transitionTo]);

  const goBack = useCallback((): boolean => {
    if (!canGoBack) {
      recordTransition(state.currentStep, STEP_IDS[currentIndex - 1] ?? state.currentStep, true, 'Cannot go back');
      return false;
    }

    const prevStep = STEP_IDS[currentIndex - 1];
    return transitionTo(prevStep);
  }, [canGoBack, state.currentStep, currentIndex, recordTransition, transitionTo]);

  const goToStep = useCallback(
    (step: WizardStep): boolean => {
      const targetIdx = stepIndex(step);
      if (targetIdx < 0) return false;
      if (step === state.currentStep) return false;

      if (isDeployActive(state.currentStep)) {
        recordTransition(state.currentStep, step, true, 'Navigation blocked during deployment');
        return false;
      }

      const isForwardJump = targetIdx > currentIndex;

      if (isForwardJump) {
        for (let i = currentIndex; i < targetIdx; i++) {
          const intermediateStep = STEP_IDS[i];
          if (!state.completedSteps.has(intermediateStep) && !canProceed(intermediateStep, config)) {
            recordTransition(state.currentStep, step, true, `Step "${intermediateStep}" has validation errors`);
            return false;
          }
        }
      }

      const guardResult = checkGuards(step);
      if (!guardResult.allowed) {
        recordTransition(state.currentStep, step, true, guardResult.reason);
        return false;
      }

      return transitionTo(step);
    },
    [state.currentStep, state.completedSteps, currentIndex, config, checkGuards, recordTransition, transitionTo],
  );

  const markCompleted = useCallback((step: WizardStep) => {
    setState((prev) => {
      const completedSteps = new Set(prev.completedSteps);
      completedSteps.add(step);
      const dirtySteps = new Set(prev.dirtySteps);
      dirtySteps.delete(step);
      return { ...prev, completedSteps, dirtySteps };
    });
  }, []);

  const markDirty = useCallback((step: WizardStep) => {
    setState((prev) => {
      const dirtySteps = new Set(prev.dirtySteps);
      dirtySteps.add(step);
      return { ...prev, dirtySteps };
    });
  }, []);

  const clearDirty = useCallback((step: WizardStep) => {
    setState((prev) => {
      const dirtySteps = new Set(prev.dirtySteps);
      dirtySteps.delete(step);
      return { ...prev, dirtySteps };
    });
  }, []);

  const isStepAccessible = useCallback(
    (step: WizardStep): boolean => {
      const targetIdx = stepIndex(step);
      if (targetIdx <= 0) return true;
      if (state.visitedSteps.has(step)) return true;
      if (state.completedSteps.has(step)) return true;

      for (let i = 0; i < targetIdx; i++) {
        const precedingStep = STEP_IDS[i];
        if (!state.completedSteps.has(precedingStep) && !state.visitedSteps.has(precedingStep)) {
          return false;
        }
      }
      return true;
    },
    [state.visitedSteps, state.completedSteps],
  );

  const isStepCompleted = useCallback(
    (step: WizardStep): boolean => state.completedSteps.has(step),
    [state.completedSteps],
  );

  const isStepDirty = useCallback(
    (step: WizardStep): boolean => state.dirtySteps.has(step),
    [state.dirtySteps],
  );

  const isStepVisited = useCallback(
    (step: WizardStep): boolean => state.visitedSteps.has(step),
    [state.visitedSteps],
  );

  const getTransitionHistory = useCallback((): StepTransition[] => {
    return [...transitionHistoryRef.current];
  }, []);

  const getStepDuration = useCallback(
    (step: WizardStep): number => {
      const timer = stepTimersRef.current.get(step);
      if (!timer) return 0;

      let total = timer.accumulated;
      if (step === state.currentStep && timer.enter > 0) {
        total += Date.now() - timer.enter;
      }
      return total;
    },
    [state.currentStep],
  );

  const getTotalDuration = useCallback((): number => {
    return Date.now() - sessionStartRef.current;
  }, []);

  const reset = useCallback(() => {
    const initial = createInitialState();
    setState(initial);
    transitionHistoryRef.current = [];
    stepTimersRef.current.clear();
    sessionStartRef.current = Date.now();
    try {
      localStorage.removeItem(STEP_STATE_STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const restoreState = useCallback((savedState: Partial<StepState>) => {
    setState((prev) => {
      const merged: StepState = {
        currentStep: savedState.currentStep ?? prev.currentStep,
        previousStep: savedState.previousStep ?? prev.previousStep,
        completedSteps: savedState.completedSteps
          ? new Set(savedState.completedSteps)
          : prev.completedSteps,
        visitedSteps: savedState.visitedSteps
          ? new Set(savedState.visitedSteps)
          : prev.visitedSteps,
        dirtySteps: savedState.dirtySteps
          ? new Set(savedState.dirtySteps)
          : prev.dirtySteps,
        stepHistory: savedState.stepHistory ?? prev.stepHistory,
        isTransitioning: false,
      };
      return merged;
    });
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const hash = window.location.hash.replace('#', '') as WizardStep;
      if (STEP_IDS.includes(hash) && hash !== state.currentStep) {
        goToStep(hash);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [state.currentStep, goToStep]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${state.currentStep}`);
    }
  }, [state.currentStep]);

  return {
    state,
    currentIndex,
    canGoNext,
    canGoBack,
    nextBlockReason,

    goNext,
    goBack,
    goToStep,

    markCompleted,
    markDirty,
    clearDirty,

    isStepAccessible,
    isStepCompleted,
    isStepDirty,
    isStepVisited,

    getTransitionHistory,
    getStepDuration,
    getTotalDuration,

    reset,
    restoreState,
  };
}
