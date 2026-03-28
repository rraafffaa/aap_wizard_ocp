import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  CheckCircleIcon,
  SaveIcon,
  ImportIcon,
  ExportIcon,
  CheckIcon,
  InfoCircleIcon,
  ExclamationCircleIcon,
} from '@patternfly/react-icons';
import {
  WIZARD_STEPS, STEP_SECTIONS, getDefaultConfig, saveConfig, loadSavedConfig, clearSavedConfig,
  exportConfigToFile, saveDeploymentRecord, getLastSuccessfulDeployment, deleteDeploymentRecord,
  type WizardStep, type DeploymentConfig, type DeploymentRecord,
} from './types';
import { WelcomeStep } from './steps/WelcomeStep';
import { EulaStep } from './steps/EulaStep';
import { SubscriptionStep } from './steps/SubscriptionStep';
import { TopologyStep } from './steps/TopologyStep';
import { TargetStep } from './steps/TargetStep';
import { HostsStep } from './steps/HostsStep';
import { ComponentsStep } from './steps/ComponentsStep';
import { DatabaseStep } from './steps/DatabaseStep';
import { NetworkStep } from './steps/NetworkStep';
import { CredentialsStep } from './steps/CredentialsStep';
import { AdvancedVariablesStep } from './steps/AdvancedVariablesStep';
import { PreflightStep } from './steps/PreflightStep';
import { ReviewStep } from './steps/ReviewStep';
import { DeployStep } from './steps/DeployStep';
import { CompleteStep } from './steps/CompleteStep';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './components/LoginPage';
import { setAuthToken, getStoredToken, clearAuth, isTokenExpired } from './api';

type ToastType = 'info' | 'error' | 'success';

function WizardApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const token = getStoredToken();
    return !!token && !isTokenExpired(token);
  });
  const [authUser, setAuthUser] = useState(() => sessionStorage.getItem('aap_wizard_user') || '');

  const handleLogin = (token: string, username: string, password: string) => {
    setAuthToken(token);
    sessionStorage.setItem('aap_wizard_user', username);
    sessionStorage.setItem('aap_wizard_registry_pw', password);
    setAuthUser(username);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearAuth();
    setAuthUser('');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <AuthenticatedWizard username={authUser} onLogout={handleLogout} />;
}

function AuthenticatedWizard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [config, setConfig] = useState<DeploymentConfig>(() => {
    const defaults = getDefaultConfig();
    const registryPw = sessionStorage.getItem('aap_wizard_registry_pw') || '';
    defaults.registry.username = username;
    defaults.registry.password = registryPw;
    return defaults;
  });
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());
  const [deploySessionId, setDeploySessionId] = useState('');
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [viewingPastDeploy, setViewingPastDeploy] = useState<DeploymentRecord | null>(null);
  const savedState = useRef(loadSavedConfig());
  const stepKey = useRef(0);

  useEffect(() => {
    if (savedState.current) setShowResumePrompt(true);
  }, []);

  useEffect(() => {
    if (currentStep !== 'welcome' && currentStep !== 'deploy' && currentStep !== 'complete') {
      saveConfig(config, currentStep);
    }
  }, [config, currentStep]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === currentStep);

  const updateConfig = useCallback((partial: Partial<DeploymentConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const goNext = useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    // Save deployment record when transitioning from deploy → complete
    if (currentStep === 'deploy' && deploySessionId) {
      saveDeploymentRecord(deploySessionId, config, 'completed');
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      stepKey.current++;
      setCurrentStep(WIZARD_STEPS[nextIndex].id);
    }
  }, [currentStep, currentIndex, deploySessionId, config]);

  const goBack = useCallback(() => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      stepKey.current++;
      setCurrentStep(WIZARD_STEPS[prevIndex].id);
    }
  }, [currentIndex]);

  const goToStep = useCallback(
    (step: WizardStep) => {
      const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
      if (stepIndex <= currentIndex || completedSteps.has(step) || stepIndex === currentIndex + 1) {
        stepKey.current++;
        setCurrentStep(step);
      }
    },
    [currentIndex, completedSteps],
  );

  const resumeSession = () => {
    if (savedState.current) {
      setConfig(savedState.current.config);
      const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === savedState.current!.step);
      const completed = new Set<WizardStep>();
      for (let i = 0; i < stepIdx; i++) completed.add(WIZARD_STEPS[i].id);
      setCompletedSteps(completed);
      stepKey.current++;
      setCurrentStep(savedState.current.step);
      setToast({ message: 'Session restored successfully', type: 'success' });
    }
    setShowResumePrompt(false);
  };

  const startFresh = () => {
    clearSavedConfig();
    setShowResumePrompt(false);
  };

  const handleImportConfig = () => {
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
          setConfig({ ...getDefaultConfig(), ...imported });
          setToast({ message: 'Configuration imported', type: 'success' });
        } catch {
          setToast({ message: 'Invalid JSON configuration file', type: 'error' });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const viewPastDeployment = useCallback(() => {
    const record = getLastSuccessfulDeployment();
    if (record) {
      setViewingPastDeploy(record);
      setConfig(prev => ({ ...prev, ...record.config }));
      stepKey.current++;
      setCurrentStep('complete');
    }
  }, []);

  const deletePastDeployment = useCallback((id: string) => {
    deleteDeploymentRecord(id);
    setViewingPastDeploy(null);
    setConfig(getDefaultConfig());
    stepKey.current++;
    setCurrentStep('welcome');
    setCompletedSteps(new Set());
    setToast({ message: 'Deployment record deleted', type: 'info' });
  }, []);

  const isDeploying = currentStep === 'deploy';
  const isTerminal = currentStep === 'complete';
  const showFooter = currentStep !== 'welcome' && !isDeploying && !isTerminal;

  const renderStep = () => {
    const common = { config, updateConfig };
    switch (currentStep) {
      case 'welcome': return <WelcomeStep onNext={goNext} onViewPastDeploy={viewPastDeployment} />;
      case 'eula': return <EulaStep {...common} />;
      case 'subscription': return <SubscriptionStep {...common} />;
      case 'topology': return <TopologyStep {...common} />;
      case 'target': return <TargetStep {...common} />;
      case 'hosts': return <HostsStep {...common} />;
      case 'components': return <ComponentsStep {...common} />;
      case 'database': return <DatabaseStep {...common} />;
      case 'network': return <NetworkStep {...common} />;
      case 'credentials': return <CredentialsStep {...common} />;
      case 'advanced': return <AdvancedVariablesStep {...common} />;
      case 'preflight': return <PreflightStep {...common} />;
      case 'review': return <ReviewStep config={config} updateConfig={updateConfig} />;
      case 'deploy':
        return (
          <DeployStep
            config={config}
            sessionId={deploySessionId}
            setSessionId={setDeploySessionId}
            onComplete={goNext}
            onBack={goBack}
          />
        );
      case 'complete': return (
          <CompleteStep
            config={config}
            deploymentRecord={viewingPastDeploy}
            onDelete={viewingPastDeploy ? () => deletePastDeployment(viewingPastDeploy.id) : undefined}
            onNewDeployment={() => {
              setViewingPastDeploy(null);
              setConfig(getDefaultConfig());
              setCompletedSteps(new Set());
              stepKey.current++;
              setCurrentStep('welcome');
            }}
          />
        );
      default: return null;
    }
  };

  return (
    <div className="aap-wizard">
      {showResumePrompt && (
        <div className="aap-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-title">
          <div className="aap-modal">
            <div className="aap-modal__icon">
              <SaveIcon />
            </div>
            <h2 id="resume-title" className="aap-modal__title">Resume previous session?</h2>
            <p className="aap-modal__body">
              A saved configuration was found from a previous session.
              You can continue where you left off or start with a fresh configuration.
            </p>
            <div className="aap-modal__actions">
              <button className="aap-btn aap-btn--secondary" onClick={startFresh}>
                Start Fresh
              </button>
              <button className="aap-btn aap-btn--primary" onClick={resumeSession} autoFocus>
                Resume Session
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`aap-toast aap-toast--${toast.type}`}
          role="status"
          aria-live="polite"
          onClick={() => setToast(null)}
        >
          {toast.type === 'success' && <CheckCircleIcon />}
          {toast.type === 'error' && <ExclamationCircleIcon />}
          {toast.type === 'info' && <InfoCircleIcon />}
          {toast.message}
        </div>
      )}

      <header className="aap-header">
        <div className="aap-header__brand">
          <img
            src="/aap-logo-standard.svg"
            alt="Red Hat Ansible Automation Platform"
            className="aap-header__logo"
          />
        </div>
        <div className="aap-header__actions">
          <button
            className="aap-btn aap-btn--tertiary aap-btn--sm"
            onClick={handleImportConfig}
            aria-label="Import configuration"
          >
            <ImportIcon /> Import
          </button>
          <button
            className="aap-btn aap-btn--tertiary aap-btn--sm"
            onClick={() => exportConfigToFile(config)}
            aria-label="Export configuration"
          >
            <ExportIcon /> Export
          </button>
          <span className="aap-header__version">v2.6</span>
          <span className="aap-header__user">{username}</span>
          <button
            className="aap-btn aap-btn--tertiary aap-btn--sm"
            onClick={onLogout}
          >
            Log Out
          </button>
        </div>
      </header>

      <div className="aap-body">
        <nav className="aap-sidebar" aria-label="Wizard steps">
          <div className="aap-sidebar__nav">
            {STEP_SECTIONS.map((section) => (
              <React.Fragment key={section.label}>
                <div className="aap-sidebar__section-label">{section.label}</div>
                {section.steps.map((stepId) => {
                  const stepDef = WIZARD_STEPS.find((s) => s.id === stepId)!;
                  const index = WIZARD_STEPS.findIndex((s) => s.id === stepId);
                  const isActive = stepId === currentStep;
                  const isCompleted = completedSteps.has(stepId);
                  const isAccessible = index <= currentIndex || completedSteps.has(stepId) || index === currentIndex + 1;

                  return (
                    <button
                      key={stepId}
                      type="button"
                      className={[
                        'aap-nav-item',
                        isActive && 'aap-nav-item--active',
                        isCompleted && !isActive && 'aap-nav-item--completed',
                        !isAccessible && 'aap-nav-item--disabled',
                      ].filter(Boolean).join(' ')}
                      onClick={() => isAccessible && !isDeploying && !isTerminal && goToStep(stepId)}
                      disabled={!isAccessible || isDeploying || isTerminal}
                      aria-current={isActive ? 'step' : undefined}
                    >
                      <span className="aap-nav-indicator" aria-hidden="true">
                        {isCompleted && !isActive ? <CheckIcon /> : index + 1}
                      </span>
                      <span>{stepDef.label}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </nav>

        <main className="aap-content" aria-label="Step content">
          <div className="aap-content__inner">
            <div className="aap-step-enter" key={stepKey.current}>
              {renderStep()}
            </div>
          </div>
        </main>
      </div>

      {showFooter && (
        <footer className="aap-footer">
          <div className="aap-footer__actions">
            <button
              className="aap-btn aap-btn--secondary"
              onClick={goBack}
              disabled={currentIndex === 0}
            >
              Back
            </button>
            <button
              className="aap-btn aap-btn--tertiary"
              onClick={() => {
                if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
                  clearSavedConfig();
                  setConfig(getDefaultConfig());
                  setCompletedSteps(new Set());
                  stepKey.current++;
                  setCurrentStep('welcome');
                }
              }}
            >
              Cancel
            </button>
          </div>
          <div className="aap-footer__actions">
            <span className="aap-footer__meta">
              {currentIndex + 1} of {WIZARD_STEPS.length}
            </span>
            <button className="aap-btn aap-btn--primary" onClick={goNext}>
              {currentStep === 'review' ? 'Start Deployment' : 'Next'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <WizardApp />
    </ErrorBoundary>
  );
}
