import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Toaster, toast as sonnerToast } from 'sonner';
import {
  SaveIcon,
  CheckIcon,
  CogIcon,
} from '@patternfly/react-icons';
import {
  getWizardSteps, getStepSections, getDefaultConfig, saveConfig, loadSavedConfig, clearSavedConfig,
  saveDeploymentRecord, getLastSuccessfulDeployment, deleteDeploymentRecord,
  type WizardStep, type DeploymentConfig, type DeploymentRecord,
} from './types';
import { WelcomeStep } from './steps/WelcomeStep';
import { EulaStep } from './steps/EulaStep';
import { SubscriptionStep } from './steps/SubscriptionStep';
import { TopologyStep } from './steps/TopologyStep';
import { TargetStep } from './steps/TargetStep';
import { HostsStep } from './steps/HostsStep';
import { DatabaseStep } from './steps/DatabaseStep';
import { NetworkStep } from './steps/NetworkStep';
import { CredentialsStep } from './steps/CredentialsStep';
import { AdvancedVariablesStep } from './steps/AdvancedVariablesStep';
import { PreflightStep } from './steps/PreflightStep';
import { DeployStep } from './steps/DeployStep';
import { CompleteStep } from './steps/CompleteStep';
import { ClusterStep } from './steps/ClusterStep';
import { NamespaceStep } from './steps/NamespaceStep';
import { OperatorStep } from './steps/OperatorStep';
import { ReplicasStep } from './steps/ReplicasStep';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProfileManager } from './components/ProfileManager';
import { ConfirmModal } from './components/ConfirmModal';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { BASE, setAuthToken, getStoredToken, isTokenExpired } from './api';

type ToastType = 'info' | 'error' | 'success';

function showToast(message: string, type: ToastType = 'info') {
  if (type === 'success') sonnerToast.success(message);
  else if (type === 'error') sonnerToast.error(message);
  else sonnerToast.info(message);
}

function WizardApp() {
  // Auto-authenticate on startup (Electron desktop app — no login needed)
  useEffect(() => {
    const token = getStoredToken();
    if (!token || isTokenExpired(token)) {
      fetch(`${BASE}/api/auth/sso`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(res => res.json())
        .then(data => {
          if (data.token) {
            setAuthToken(data.token);
            sessionStorage.setItem('aap_wizard_user', data.username || 'user');
          }
        })
        .catch(() => { /* backend not yet ready — API calls will retry */ });
    }
  }, []);

  return <AuthenticatedWizard />;
}

function AuthenticatedWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [config, setConfig] = useState<DeploymentConfig>(() => {
    return getDefaultConfig();
  });
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());
  const [deploySessionId, setDeploySessionId] = useState('');
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [viewingPastDeploy, setViewingPastDeploy] = useState<DeploymentRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [stepDirection, setStepDirection] = useState(1); // 1 = forward, -1 = back
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

  // Cmd+K command palette shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const wizardSteps = getWizardSteps(config.platform);
  const stepSections = getStepSections(config.platform);
  const currentIndex = wizardSteps.findIndex((s) => s.id === currentStep);

  const updateConfig = useCallback((partial: Partial<DeploymentConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const scrollContentToTop = () => {
    const el = document.querySelector('.aap-content');
    if (el) el.scrollTo({ top: 0, behavior: 'instant' });
  };

  const goNext = useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    // Save deployment record when transitioning from deploy → complete
    if (currentStep === 'deploy' && deploySessionId) {
      saveDeploymentRecord(deploySessionId, config, 'completed');
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex < wizardSteps.length) {
      setStepDirection(1);
      stepKey.current++;
      setCurrentStep(wizardSteps[nextIndex].id);
      scrollContentToTop();
    }
  }, [currentStep, currentIndex, deploySessionId, config]);

  const goBack = useCallback(() => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setStepDirection(-1);
      stepKey.current++;
      setCurrentStep(wizardSteps[prevIndex].id);
      scrollContentToTop();
    }
  }, [currentIndex]);

  const goToStep = useCallback(
    (step: WizardStep) => {
      const stepIndex = wizardSteps.findIndex((s) => s.id === step);
      if (stepIndex <= currentIndex || completedSteps.has(step) || stepIndex === currentIndex + 1) {
        setStepDirection(stepIndex > currentIndex ? 1 : -1);
        stepKey.current++;
        setCurrentStep(step);
        scrollContentToTop();
      }
    },
    [currentIndex, completedSteps],
  );

  const resumeSession = () => {
    if (savedState.current) {
      const restoredConfig = savedState.current.config;
      setConfig(restoredConfig);
      const restoredSteps = getWizardSteps(restoredConfig.platform ?? 'containerized');
      const stepIdx = restoredSteps.findIndex((s) => s.id === savedState.current!.step);
      const completed = new Set<WizardStep>();
      for (let i = 0; i < stepIdx; i++) completed.add(restoredSteps[i].id);
      setCompletedSteps(completed);
      stepKey.current++;
      setCurrentStep(savedState.current.step);
      showToast('Session restored successfully', 'success');
    }
    setShowResumePrompt(false);
  };

  const startFresh = () => {
    clearSavedConfig();
    setShowResumePrompt(false);
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
    showToast('Deployment record deleted', 'info');
  }, []);

  const isDeploying = currentStep === 'deploy';
  const isTerminal = currentStep === 'complete';
  const showFooter = currentStep !== 'welcome' && !isDeploying && !isTerminal;

  const renderStep = () => {
    const common = { config, updateConfig };
    switch (currentStep) {
      case 'welcome': return <WelcomeStep {...common} onNext={goNext} onViewPastDeploy={viewPastDeployment} />;
      case 'eula': return <EulaStep {...common} />;
      case 'subscription': return <SubscriptionStep {...common} />;
      case 'topology': return <TopologyStep {...common} />;
      case 'target': return <TargetStep {...common} />;
      case 'hosts': return <HostsStep {...common} />;
      // OCP branch steps
      case 'cluster': return <ClusterStep {...common} />;
      case 'namespace': return <NamespaceStep {...common} />;
      case 'operator': return <OperatorStep {...common} />;
      case 'replicas': return <ReplicasStep {...common} />;
      case 'database': return <DatabaseStep {...common} />;
      case 'network': return <NetworkStep {...common} />;
      case 'credentials': return <CredentialsStep {...common} />;
      case 'advanced': return <AdvancedVariablesStep {...common} />;
      case 'preflight': return <PreflightStep {...common} />;
      case 'deploy':
        return (
          <DeployStep
            config={config}
            updateConfig={updateConfig}
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
    <MotionConfig reducedMotion="user">
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

      <Toaster position="bottom-right" richColors closeButton duration={4000} />

      <header className="aap-header">
        <div className="aap-header__brand">
          <img
            src="./aap-logo-standard.svg"
            alt="Red Hat Ansible Automation Platform"
            className="aap-header__logo"
          />
        </div>
        <div className="aap-header__actions">
          <ProfileManager
            config={config}
            onLoadProfile={(newConfig) => {
              setConfig(newConfig);
              stepKey.current++;
              setCurrentStep('platform');
            }}
            onToast={(message, type) => showToast(message, type)}
          />
          <button
            className="aap-btn aap-btn--tertiary aap-btn--sm"
            onClick={() => setCmdPaletteOpen(true)}
            aria-label="Open command palette"
            title="Search steps and actions (⌘K)"
          >
            <kbd className="aap-header__kbd">⌘K</kbd>
          </button>
          <button
            className="aap-btn aap-btn--tertiary aap-btn--sm"
            onClick={() => setSettingsOpen(true)}
            aria-label="AI Settings"
            title="AI Configuration"
          >
            <CogIcon /> Settings
          </button>
          <span className="aap-header__version">v2.6</span>
        </div>
      </header>

      {/* Segmented progress bar — hidden on welcome/complete */}
      {currentStep !== 'welcome' && currentStep !== 'complete' && (
        <div className="aap-progress-segments" role="progressbar" aria-valuenow={currentIndex + 1} aria-valuemax={wizardSteps.length}>
          {wizardSteps.map((step, i) => (
            <div
              key={step.id}
              className={[
                'aap-progress-segment',
                i < currentIndex && 'aap-progress-segment--completed',
                i === currentIndex && 'aap-progress-segment--active',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>
      )}

      <div className="aap-body">
        <nav className="aap-sidebar" aria-label="Wizard steps">
          <div className="aap-sidebar__nav">
            {stepSections.map((section) => (
              <React.Fragment key={section.label}>
                <div className="aap-sidebar__section-label">{section.label}</div>
                {section.steps.map((stepId) => {
                  const stepDef = wizardSteps.find((s) => s.id === stepId)!;
                  const index = wizardSteps.findIndex((s) => s.id === stepId);
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
            <AnimatePresence mode="wait" initial={false} custom={stepDirection}>
              <motion.div
                key={stepKey.current}
                custom={stepDirection}
                variants={{
                  enter: (dir: number) => ({ opacity: 0, x: dir * 40 }),
                  center: { opacity: 1, x: 0 },
                  exit: (dir: number) => ({ opacity: 0, x: dir * -40 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  type: 'spring',
                  stiffness: 500,
                  damping: 35,
                  mass: 0.5,
                }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
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
              onClick={() => setShowCancelConfirm(true)}
            >
              Cancel
            </button>
          </div>
          <div className="aap-footer__actions">
            <span className="aap-footer__meta">
              {currentIndex + 1} of {wizardSteps.length}
            </span>
            <button className="aap-btn aap-btn--primary" onClick={goNext}>
              {currentStep === 'preflight' ? 'Start Deployment' : 'Next'}
            </button>
          </div>
        </footer>
      )}

      <ConfirmModal
        isOpen={showCancelConfirm}
        title="Cancel wizard?"
        message="This will reset all configuration to defaults. Your current progress will be cleared."
        confirmLabel="Yes, cancel"
        variant="warning"
        onConfirm={() => {
          setShowCancelConfirm(false);
          clearSavedConfig();
          setConfig(getDefaultConfig());
          setCompletedSteps(new Set());
          stepKey.current++;
          setCurrentStep('welcome');
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette
        isOpen={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onNavigate={(step) => goToStep(step)}
        onAction={(action) => {
          if (action === 'settings') setSettingsOpen(true);
        }}
        currentStep={currentStep}
        platform={config.platform}
      />
    </div>
    </MotionConfig>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <WizardApp />
    </ErrorBoundary>
  );
}
