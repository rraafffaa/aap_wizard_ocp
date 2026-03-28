import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import type { DeploymentConfig, WizardStep } from '../types';
import {
  getDefaultConfig,
  saveConfig,
  loadSavedConfig,
  clearSavedConfig,
  exportConfigToFile,
  WIZARD_STEPS,
} from '../types';

// State shape
export interface WizardState {
  config: DeploymentConfig;
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  visitedSteps: Set<WizardStep>;
  dirtySteps: Set<WizardStep>;
  deploySessionId: string;
  toast: { message: string; type: 'info' | 'error' | 'success' } | null;
  showResumePrompt: boolean;
  showHelpPanel: boolean;
  showCommandPalette: boolean;
  showSettings: boolean;
  showAuditLog: boolean;
  showProfileManager: boolean;
  isDeploying: boolean;
  isComplete: boolean;
  stepTimestamps: Record<string, number>;
  previousConfig: DeploymentConfig | null;
  stepKey: number;
}

// Action types (discriminated union)
export type WizardAction =
  | { type: 'SET_CONFIG'; payload: Partial<DeploymentConfig> }
  | { type: 'SET_STEP'; payload: WizardStep }
  | { type: 'COMPLETE_STEP'; payload: WizardStep }
  | { type: 'MARK_DIRTY'; payload: WizardStep }
  | { type: 'CLEAR_DIRTY'; payload: WizardStep }
  | { type: 'SET_DEPLOY_SESSION'; payload: string }
  | { type: 'SHOW_TOAST'; payload: { message: string; type: 'info' | 'error' | 'success' } }
  | { type: 'DISMISS_TOAST' }
  | { type: 'SHOW_RESUME_PROMPT' }
  | { type: 'DISMISS_RESUME_PROMPT' }
  | { type: 'RESUME_SESSION'; payload: { config: DeploymentConfig; step: WizardStep } }
  | { type: 'TOGGLE_HELP_PANEL' }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_AUDIT_LOG' }
  | { type: 'TOGGLE_PROFILE_MANAGER' }
  | { type: 'IMPORT_CONFIG'; payload: DeploymentConfig }
  | { type: 'RESET' }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO_STEP'; payload: WizardStep };

// Reducer (exported for testing)
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_CONFIG': {
      const nextConfig = { ...state.config, ...action.payload };
      return { ...state, config: nextConfig };
    }

    case 'SET_STEP': {
      const step = action.payload;
      const now = Date.now();
      return {
        ...state,
        currentStep: step,
        visitedSteps: new Set([...state.visitedSteps, step]),
        stepTimestamps: { ...state.stepTimestamps, [step]: now },
      };
    }

    case 'COMPLETE_STEP': {
      const step = action.payload;
      return {
        ...state,
        completedSteps: new Set([...state.completedSteps, step]),
        dirtySteps: new Set([...state.dirtySteps].filter((s) => s !== step)),
      };
    }

    case 'MARK_DIRTY':
      return {
        ...state,
        dirtySteps: new Set([...state.dirtySteps, action.payload]),
      };

    case 'CLEAR_DIRTY':
      return {
        ...state,
        dirtySteps: new Set([...state.dirtySteps].filter((s) => s !== action.payload)),
      };

    case 'SET_DEPLOY_SESSION':
      return { ...state, deploySessionId: action.payload };

    case 'SHOW_TOAST':
      return { ...state, toast: action.payload };

    case 'DISMISS_TOAST':
      return { ...state, toast: null };

    case 'SHOW_RESUME_PROMPT':
      return { ...state, showResumePrompt: true };

    case 'DISMISS_RESUME_PROMPT':
      return { ...state, showResumePrompt: false };

    case 'RESUME_SESSION': {
      const { config, step } = action.payload;
      const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === step);
      const completed = new Set<WizardStep>();
      for (let i = 0; i < stepIdx; i++) completed.add(WIZARD_STEPS[i].id);
      return {
        ...state,
        config,
        currentStep: step,
        completedSteps: completed,
        visitedSteps: new Set([...state.visitedSteps, step]),
        showResumePrompt: false,
        stepTimestamps: { ...state.stepTimestamps, [step]: Date.now() },
        stepKey: state.stepKey + 1,
      };
    }

    case 'TOGGLE_HELP_PANEL':
      return { ...state, showHelpPanel: !state.showHelpPanel };

    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, showCommandPalette: !state.showCommandPalette };

    case 'TOGGLE_SETTINGS':
      return { ...state, showSettings: !state.showSettings };

    case 'TOGGLE_AUDIT_LOG':
      return { ...state, showAuditLog: !state.showAuditLog };

    case 'TOGGLE_PROFILE_MANAGER':
      return { ...state, showProfileManager: !state.showProfileManager };

    case 'IMPORT_CONFIG':
      return {
        ...state,
        config: { ...getDefaultConfig(), ...action.payload },
        previousConfig: state.config,
      };

    case 'RESET':
      return createInitialState();

    case 'GO_NEXT': {
      const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === state.currentStep);
      const nextIndex = currentIndex + 1;
      if (nextIndex >= WIZARD_STEPS.length) return state;
      const nextStep = WIZARD_STEPS[nextIndex].id;
      const completed = new Set([...state.completedSteps, state.currentStep]);
      const now = Date.now();
      return {
        ...state,
        currentStep: nextStep,
        completedSteps: completed,
        visitedSteps: new Set([...state.visitedSteps, nextStep]),
        dirtySteps: new Set([...state.dirtySteps].filter((s) => s !== state.currentStep)),
        stepTimestamps: { ...state.stepTimestamps, [nextStep]: now },
        stepKey: state.stepKey + 1,
      };
    }

    case 'GO_BACK': {
      const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === state.currentStep);
      const prevIndex = currentIndex - 1;
      if (prevIndex < 0) return state;
      const prevStep = WIZARD_STEPS[prevIndex].id;
      const now = Date.now();
      return {
        ...state,
        currentStep: prevStep,
        visitedSteps: new Set([...state.visitedSteps, prevStep]),
        stepTimestamps: { ...state.stepTimestamps, [prevStep]: now },
        stepKey: state.stepKey + 1,
      };
    }

    case 'GO_TO_STEP': {
      const step = action.payload;
      const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
      const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === state.currentStep);
      const isAccessible =
        stepIndex <= currentIndex ||
        state.completedSteps.has(step) ||
        stepIndex === currentIndex + 1;
      if (!isAccessible) return state;
      const now = Date.now();
      return {
        ...state,
        currentStep: step,
        visitedSteps: new Set([...state.visitedSteps, step]),
        stepTimestamps: { ...state.stepTimestamps, [step]: now },
        stepKey: state.stepKey + 1,
      };
    }

    default:
      return state;
  }
}

// Initial state factory
function createInitialState(): WizardState {
  const saved = loadSavedConfig();
  const config = saved?.config ?? getDefaultConfig();
  const currentStep = saved?.step ?? 'welcome';
  const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === currentStep);
  const completedSteps = new Set<WizardStep>();
  for (let i = 0; i < stepIdx; i++) completedSteps.add(WIZARD_STEPS[i].id);
  const visitedSteps = new Set<WizardStep>([currentStep]);
  const now = Date.now();
  return {
    config,
    currentStep,
    completedSteps,
    visitedSteps,
    dirtySteps: new Set(),
    deploySessionId: '',
    toast: null,
    showResumePrompt: !!saved,
    showHelpPanel: false,
    showCommandPalette: false,
    showSettings: false,
    showAuditLog: false,
    showProfileManager: false,
    isDeploying: false,
    isComplete: false,
    stepTimestamps: { [currentStep]: now },
    previousConfig: null,
    stepKey: 0,
  };
}

// Context
const WizardContext = createContext<{
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  currentIndex: number;
  canGoNext: boolean;
  canGoBack: boolean;
  showFooter: boolean;
  stepLabel: string;
  progressPercent: number;
  stepKey: number;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
  goNext: () => void;
  goBack: () => void;
  goToStep: (step: WizardStep) => void;
  showToast: (message: string, type: 'info' | 'error' | 'success') => void;
  importConfig: () => void;
  exportConfig: () => void;
  resetWizard: () => void;
} | null>(null);

// Provider component
export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);

  // Auto-save to localStorage on config/step changes
  useEffect(() => {
    const { currentStep, config } = state;
    if (
      currentStep !== 'welcome' &&
      currentStep !== 'deploy' &&
      currentStep !== 'complete'
    ) {
      saveConfig(config, currentStep);
    }
  }, [state.config, state.currentStep]);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: 'DISMISS_TOAST' }), 4000);
    return () => clearTimeout(t);
  }, [state.toast]);

  const currentIndex = useMemo(
    () => WIZARD_STEPS.findIndex((s) => s.id === state.currentStep),
    [state.currentStep]
  );

  const canGoNext = useMemo(
    () => currentIndex < WIZARD_STEPS.length - 1,
    [currentIndex]
  );

  const canGoBack = useMemo(() => currentIndex > 0, [currentIndex]);

  const showFooter = useMemo(
    () =>
      state.currentStep !== 'welcome' &&
      state.currentStep !== 'deploy' &&
      state.currentStep !== 'complete',
    [state.currentStep]
  );

  const stepLabel = useMemo(
    () => WIZARD_STEPS.find((s) => s.id === state.currentStep)?.label ?? '',
    [state.currentStep]
  );

  const progressPercent = useMemo(
    () => Math.round((currentIndex / (WIZARD_STEPS.length - 1)) * 100),
    [currentIndex]
  );

  const updateConfig = useCallback((partial: Partial<DeploymentConfig>) => {
    dispatch({ type: 'SET_CONFIG', payload: partial });
  }, []);

  const goNext = useCallback(() => dispatch({ type: 'GO_NEXT' }), []);

  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), []);

  const goToStep = useCallback((step: WizardStep) => {
    dispatch({ type: 'GO_TO_STEP', payload: step });
  }, []);

  const showToast = useCallback(
    (message: string, type: 'info' | 'error' | 'success') => {
      dispatch({ type: 'SHOW_TOAST', payload: { message, type } });
    },
    []
  );

  const importConfig = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result as string);
          dispatch({ type: 'IMPORT_CONFIG', payload: imported });
          dispatch({
            type: 'SHOW_TOAST',
            payload: { message: 'Configuration imported', type: 'success' },
          });
        } catch {
          dispatch({
            type: 'SHOW_TOAST',
            payload: { message: 'Invalid JSON configuration file', type: 'error' },
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const exportConfig = useCallback(() => {
    exportConfigToFile(state.config);
  }, [state.config]);

  const resetWizard = useCallback(() => {
    clearSavedConfig();
    dispatch({ type: 'DISMISS_RESUME_PROMPT' });
    dispatch({ type: 'RESET' });
  }, []);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      currentIndex,
      canGoNext,
      canGoBack,
      showFooter,
      stepLabel,
      progressPercent,
      stepKey: state.stepKey,
      updateConfig,
      goNext,
      goBack,
      goToStep,
      showToast,
      importConfig,
      exportConfig,
      resetWizard,
    }),
    [
      state,
      currentIndex,
      canGoNext,
      canGoBack,
      showFooter,
      stepLabel,
      progressPercent,
      state.stepKey,
      updateConfig,
      goNext,
      goBack,
      goToStep,
      showToast,
      importConfig,
      exportConfig,
      resetWizard,
    ]
  );

  return React.createElement(WizardContext.Provider, { value }, children);
}

// Hook to consume the store
export function useWizardStore() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizardStore must be used within WizardProvider');
  return ctx;
}

// Selector hooks for performance
export function useConfig(): DeploymentConfig {
  const { state } = useWizardStore();
  return state.config;
}

export function useCurrentStep(): WizardStep {
  const { state } = useWizardStore();
  return state.currentStep;
}

export function useStepNavigation(): {
  goNext: () => void;
  goBack: () => void;
  canGoNext: boolean;
  canGoBack: boolean;
} {
  const { goNext, goBack, canGoNext, canGoBack } = useWizardStore();
  return { goNext, goBack, canGoNext, canGoBack };
}
