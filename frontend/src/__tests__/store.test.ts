import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultConfig, WIZARD_STEPS, type DeploymentConfig, type WizardStep } from '../types';
import { wizardReducer, type WizardState, type WizardAction } from '../hooks/useWizardStore';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function createTestState(overrides?: Partial<WizardState>): WizardState {
  const config = getDefaultConfig();
  const now = Date.now();
  return {
    config,
    currentStep: 'welcome',
    completedSteps: new Set(),
    visitedSteps: new Set(['welcome']),
    dirtySteps: new Set(),
    deploySessionId: '',
    toast: null,
    showResumePrompt: false,
    showHelpPanel: false,
    showCommandPalette: false,
    showSettings: false,
    showAuditLog: false,
    showProfileManager: false,
    isDeploying: false,
    isComplete: false,
    stepTimestamps: { welcome: now },
    previousConfig: null,
    stepKey: 0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Initial state (5 tests)
// ---------------------------------------------------------------------------
describe('Initial state', () => {
  it('default config matches getDefaultConfig', () => {
    const state = createTestState();
    expect(state.config).toEqual(getDefaultConfig());
  });

  it('welcome step is current', () => {
    const state = createTestState();
    expect(state.currentStep).toBe('welcome');
  });

  it('completedSteps is empty', () => {
    const state = createTestState();
    expect(state.completedSteps.size).toBe(0);
  });

  it('toast is null', () => {
    const state = createTestState();
    expect(state.toast).toBeNull();
  });

  it('no modals are shown', () => {
    const state = createTestState();
    expect(state.showHelpPanel).toBe(false);
    expect(state.showCommandPalette).toBe(false);
    expect(state.showSettings).toBe(false);
    expect(state.showAuditLog).toBe(false);
    expect(state.showProfileManager).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SET_CONFIG (5 tests)
// ---------------------------------------------------------------------------
describe('SET_CONFIG', () => {
  it('partial update merges with existing config', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'SET_CONFIG',
      payload: { topology: 'enterprise' },
    });
    expect(next.config.topology).toBe('enterprise');
    expect(next.config.installation_type).toBe(state.config.installation_type);
  });

  it('full update replaces config', () => {
    const state = createTestState();
    const full: DeploymentConfig = { ...getDefaultConfig(), topology: 'enterprise', installation_type: 'disconnected' };
    const next = wizardReducer(state, { type: 'SET_CONFIG', payload: full });
    expect(next.config.topology).toBe('enterprise');
    expect(next.config.installation_type).toBe('disconnected');
  });

  it('nested partial merge works', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'SET_CONFIG',
      payload: { database: { type: 'external', host: 'db.example.com' } },
    });
    expect(next.config.database.type).toBe('external');
    expect(next.config.database.host).toBe('db.example.com');
  });

  it('does not mutate previous state', () => {
    const state = createTestState();
    const originalTopology = state.config.topology;
    wizardReducer(state, { type: 'SET_CONFIG', payload: { topology: 'enterprise' } });
    expect(state.config.topology).toBe(originalTopology);
  });

  it('registry credentials can be updated', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'SET_CONFIG',
      payload: { registry: { username: 'user', password: 'pass' } },
    });
    expect(next.config.registry.username).toBe('user');
    expect(next.config.registry.password).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// SET_STEP (5 tests)
// ---------------------------------------------------------------------------
describe('SET_STEP', () => {
  it('updates currentStep', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'SET_STEP', payload: 'topology' });
    expect(next.currentStep).toBe('topology');
  });

  it('adds step to visitedSteps', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'SET_STEP', payload: 'eula' });
    expect(next.visitedSteps.has('eula')).toBe(true);
    expect(next.visitedSteps.has('welcome')).toBe(true);
  });

  it('records timestamp for step', () => {
    const before = Date.now();
    const state = createTestState();
    const next = wizardReducer(state, { type: 'SET_STEP', payload: 'hosts' });
    const after = Date.now();
    const ts = next.stepTimestamps['hosts'];
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('preserves existing timestamps', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'SET_STEP', payload: 'eula' });
    expect(next.stepTimestamps['welcome']).toBeDefined();
    expect(next.stepTimestamps['eula']).toBeDefined();
  });

  it('can set to any valid step', () => {
    const state = createTestState();
    for (const { id } of WIZARD_STEPS) {
      const next = wizardReducer(state, { type: 'SET_STEP', payload: id });
      expect(next.currentStep).toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------
// GO_NEXT (8 tests)
// ---------------------------------------------------------------------------
describe('GO_NEXT', () => {
  it('advances from welcome to eula', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.currentStep).toBe('eula');
  });

  it('marks current step as completed', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.completedSteps.has('welcome')).toBe(true);
  });

  it('adds next step to visitedSteps', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.visitedSteps.has('eula')).toBe(true);
  });

  it('wraps at end — does not advance past complete', () => {
    const state = createTestState({ currentStep: 'complete' });
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.currentStep).toBe('complete');
  });

  it('increments stepKey', () => {
    const state = createTestState({ stepKey: 5 });
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.stepKey).toBe(6);
  });

  it('clears dirty for current step', () => {
    const state = createTestState({ dirtySteps: new Set(['welcome']) });
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.dirtySteps.has('welcome')).toBe(false);
  });

  it('advances through multiple steps', () => {
    let state = createTestState();
    state = wizardReducer(state, { type: 'GO_NEXT' });
    state = wizardReducer(state, { type: 'GO_NEXT' });
    state = wizardReducer(state, { type: 'GO_NEXT' });
    expect(state.currentStep).toBe('topology');
    expect(state.completedSteps.has('welcome')).toBe(true);
    expect(state.completedSteps.has('eula')).toBe(true);
    expect(state.completedSteps.has('subscription')).toBe(true);
  });

  it('does not advance when at last step', () => {
    const lastStep = WIZARD_STEPS[WIZARD_STEPS.length - 1].id;
    const state = createTestState({ currentStep: lastStep });
    const next = wizardReducer(state, { type: 'GO_NEXT' });
    expect(next.currentStep).toBe(lastStep);
  });
});

// ---------------------------------------------------------------------------
// GO_BACK (5 tests)
// ---------------------------------------------------------------------------
describe('GO_BACK', () => {
  it('goes to previous step', () => {
    const state = createTestState({ currentStep: 'eula' });
    const next = wizardReducer(state, { type: 'GO_BACK' });
    expect(next.currentStep).toBe('welcome');
  });

  it('does not go before welcome', () => {
    const state = createTestState({ currentStep: 'welcome' });
    const next = wizardReducer(state, { type: 'GO_BACK' });
    expect(next.currentStep).toBe('welcome');
  });

  it('increments stepKey', () => {
    const state = createTestState({ currentStep: 'eula', stepKey: 3 });
    const next = wizardReducer(state, { type: 'GO_BACK' });
    expect(next.stepKey).toBe(4);
  });

  it('adds previous step to visitedSteps', () => {
    const state = createTestState({ currentStep: 'topology' });
    const next = wizardReducer(state, { type: 'GO_BACK' });
    expect(next.visitedSteps.has('subscription')).toBe(true);
  });

  it('does not add to completedSteps when going back', () => {
    const state = createTestState({
      currentStep: 'topology',
      completedSteps: new Set(['welcome', 'eula', 'subscription']),
    });
    const next = wizardReducer(state, { type: 'GO_BACK' });
    expect(next.completedSteps).toEqual(state.completedSteps);
  });
});

// ---------------------------------------------------------------------------
// GO_TO_STEP (5 tests)
// ---------------------------------------------------------------------------
describe('GO_TO_STEP', () => {
  it('jumps to specified step when accessible (current)', () => {
    const state = createTestState({ currentStep: 'topology' });
    const next = wizardReducer(state, { type: 'GO_TO_STEP', payload: 'topology' });
    expect(next.currentStep).toBe('topology');
  });

  it('jumps to previous step (already visited)', () => {
    const state = createTestState({
      currentStep: 'hosts',
      completedSteps: new Set(['welcome', 'eula', 'subscription', 'topology']),
      visitedSteps: new Set(['welcome', 'eula', 'subscription', 'topology', 'hosts']),
    });
    const next = wizardReducer(state, { type: 'GO_TO_STEP', payload: 'topology' });
    expect(next.currentStep).toBe('topology');
  });

  it('jumps to next step (one ahead)', () => {
    const state = createTestState({ currentStep: 'topology' });
    const next = wizardReducer(state, { type: 'GO_TO_STEP', payload: 'target' });
    expect(next.currentStep).toBe('target');
  });

  it('rejects jump to inaccessible future step', () => {
    const state = createTestState({ currentStep: 'welcome' });
    const next = wizardReducer(state, { type: 'GO_TO_STEP', payload: 'deploy' });
    expect(next.currentStep).toBe('welcome');
  });

  it('increments stepKey when jump succeeds', () => {
    const state = createTestState({
      currentStep: 'hosts',
      completedSteps: new Set(['welcome', 'eula', 'subscription', 'topology']),
      visitedSteps: new Set(['welcome', 'eula', 'subscription', 'topology', 'hosts']),
      stepKey: 2,
    });
    const next = wizardReducer(state, { type: 'GO_TO_STEP', payload: 'topology' });
    expect(next.stepKey).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// COMPLETE_STEP (3 tests)
// ---------------------------------------------------------------------------
describe('COMPLETE_STEP', () => {
  it('adds step to completedSteps', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'COMPLETE_STEP', payload: 'eula' });
    expect(next.completedSteps.has('eula')).toBe(true);
  });

  it('removes step from dirtySteps', () => {
    const state = createTestState({ dirtySteps: new Set(['topology']) });
    const next = wizardReducer(state, { type: 'COMPLETE_STEP', payload: 'topology' });
    expect(next.dirtySteps.has('topology')).toBe(false);
  });

  it('preserves other completed steps', () => {
    const state = createTestState({
      completedSteps: new Set(['welcome', 'eula']),
    });
    const next = wizardReducer(state, { type: 'COMPLETE_STEP', payload: 'subscription' });
    expect(next.completedSteps.has('welcome')).toBe(true);
    expect(next.completedSteps.has('eula')).toBe(true);
    expect(next.completedSteps.has('subscription')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MARK_DIRTY / CLEAR_DIRTY (4 tests)
// ---------------------------------------------------------------------------
describe('MARK_DIRTY / CLEAR_DIRTY', () => {
  it('MARK_DIRTY adds step to dirtySteps', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'MARK_DIRTY', payload: 'credentials' });
    expect(next.dirtySteps.has('credentials')).toBe(true);
  });

  it('CLEAR_DIRTY removes step from dirtySteps', () => {
    const state = createTestState({ dirtySteps: new Set(['topology']) });
    const next = wizardReducer(state, { type: 'CLEAR_DIRTY', payload: 'topology' });
    expect(next.dirtySteps.has('topology')).toBe(false);
  });

  it('MARK_DIRTY preserves other dirty steps', () => {
    const state = createTestState({ dirtySteps: new Set(['hosts']) });
    const next = wizardReducer(state, { type: 'MARK_DIRTY', payload: 'database' });
    expect(next.dirtySteps.has('hosts')).toBe(true);
    expect(next.dirtySteps.has('database')).toBe(true);
  });

  it('CLEAR_DIRTY no-ops for non-dirty step', () => {
    const state = createTestState({ dirtySteps: new Set(['hosts']) });
    const next = wizardReducer(state, { type: 'CLEAR_DIRTY', payload: 'topology' });
    expect(next.dirtySteps.has('hosts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SHOW_TOAST / DISMISS_TOAST (4 tests)
// ---------------------------------------------------------------------------
describe('SHOW_TOAST / DISMISS_TOAST', () => {
  it('SHOW_TOAST sets toast with message and type', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'SHOW_TOAST',
      payload: { message: 'Saved!', type: 'success' },
    });
    expect(next.toast).toEqual({ message: 'Saved!', type: 'success' });
  });

  it('DISMISS_TOAST clears toast', () => {
    const state = createTestState({
      toast: { message: 'Error', type: 'error' },
    });
    const next = wizardReducer(state, { type: 'DISMISS_TOAST' });
    expect(next.toast).toBeNull();
  });

  it('SHOW_TOAST supports info and error types', () => {
    const state = createTestState();
    const info = wizardReducer(state, {
      type: 'SHOW_TOAST',
      payload: { message: 'Info', type: 'info' },
    });
    expect(info.toast?.type).toBe('info');
    const err = wizardReducer(state, {
      type: 'SHOW_TOAST',
      payload: { message: 'Error', type: 'error' },
    });
    expect(err.toast?.type).toBe('error');
  });

  it('SHOW_TOAST replaces existing toast', () => {
    const state = createTestState({
      toast: { message: 'First', type: 'info' },
    });
    const next = wizardReducer(state, {
      type: 'SHOW_TOAST',
      payload: { message: 'Second', type: 'success' },
    });
    expect(next.toast?.message).toBe('Second');
  });
});

// ---------------------------------------------------------------------------
// TOGGLE_* modals (6 tests)
// ---------------------------------------------------------------------------
describe('TOGGLE_* modals', () => {
  it('TOGGLE_HELP_PANEL toggles showHelpPanel', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'TOGGLE_HELP_PANEL' });
    expect(next.showHelpPanel).toBe(true);
    const next2 = wizardReducer(next, { type: 'TOGGLE_HELP_PANEL' });
    expect(next2.showHelpPanel).toBe(false);
  });

  it('TOGGLE_COMMAND_PALETTE toggles showCommandPalette', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'TOGGLE_COMMAND_PALETTE' });
    expect(next.showCommandPalette).toBe(true);
  });

  it('TOGGLE_SETTINGS toggles showSettings', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'TOGGLE_SETTINGS' });
    expect(next.showSettings).toBe(true);
  });

  it('TOGGLE_AUDIT_LOG toggles showAuditLog', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'TOGGLE_AUDIT_LOG' });
    expect(next.showAuditLog).toBe(true);
  });

  it('TOGGLE_PROFILE_MANAGER toggles showProfileManager', () => {
    const state = createTestState();
    const next = wizardReducer(state, { type: 'TOGGLE_PROFILE_MANAGER' });
    expect(next.showProfileManager).toBe(true);
  });

  it('each modal toggles independently', () => {
    let state = createTestState();
    state = wizardReducer(state, { type: 'TOGGLE_HELP_PANEL' });
    state = wizardReducer(state, { type: 'TOGGLE_SETTINGS' });
    expect(state.showHelpPanel).toBe(true);
    expect(state.showSettings).toBe(true);
    expect(state.showCommandPalette).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RESUME_SESSION (3 tests)
// ---------------------------------------------------------------------------
describe('RESUME_SESSION', () => {
  it('restores config', () => {
    const state = createTestState();
    const savedConfig = { ...getDefaultConfig(), topology: 'enterprise' as const };
    const next = wizardReducer(state, {
      type: 'RESUME_SESSION',
      payload: { config: savedConfig, step: 'topology' },
    });
    expect(next.config.topology).toBe('enterprise');
  });

  it('restores step', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'RESUME_SESSION',
      payload: { config: getDefaultConfig(), step: 'credentials' },
    });
    expect(next.currentStep).toBe('credentials');
  });

  it('sets completedSteps for steps before resumed step', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'RESUME_SESSION',
      payload: { config: getDefaultConfig(), step: 'hosts' },
    });
    const hostsIdx = WIZARD_STEPS.findIndex((s) => s.id === 'hosts');
    for (let i = 0; i < hostsIdx; i++) {
      expect(next.completedSteps.has(WIZARD_STEPS[i].id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// IMPORT_CONFIG (3 tests)
// ---------------------------------------------------------------------------
describe('IMPORT_CONFIG', () => {
  it('merges imported config with defaults', () => {
    const state = createTestState();
    const imported = { topology: 'enterprise' as const };
    const next = wizardReducer(state, { type: 'IMPORT_CONFIG', payload: imported as DeploymentConfig });
    expect(next.config.topology).toBe('enterprise');
    expect(next.config.installation_type).toBe(getDefaultConfig().installation_type);
  });

  it('stores previous config in previousConfig', () => {
    const state = createTestState();
    const prevConfig = state.config;
    const next = wizardReducer(state, {
      type: 'IMPORT_CONFIG',
      payload: { ...getDefaultConfig(), topology: 'enterprise' } as DeploymentConfig,
    });
    expect(next.previousConfig).toEqual(prevConfig);
  });

  it('replaces config with merged result', () => {
    const state = createTestState();
    const next = wizardReducer(state, {
      type: 'IMPORT_CONFIG',
      payload: {
        ...getDefaultConfig(),
        topology: 'enterprise',
        database: { ...getDefaultConfig().database, type: 'external', host: 'db.example.com' },
      } as DeploymentConfig,
    });
    expect(next.config.topology).toBe('enterprise');
    expect(next.config.database.type).toBe('external');
    expect(next.config.database.host).toBe('db.example.com');
  });
});

// ---------------------------------------------------------------------------
// RESET (2 tests)
// ---------------------------------------------------------------------------
describe('RESET', () => {
  it('returns to initial state structure', () => {
    const state = createTestState({
      currentStep: 'deploy',
      completedSteps: new Set(['welcome', 'eula']),
      toast: { message: 'test', type: 'info' },
    });
    const next = wizardReducer(state, { type: 'RESET' });
    expect(next.currentStep).toBe('welcome');
    expect(next.completedSteps.size).toBe(0);
    expect(next.toast).toBeNull();
    expect(next.config).toEqual(getDefaultConfig());
  });

  it('clears modals and dirty state', () => {
    const state = createTestState({
      showHelpPanel: true,
      showSettings: true,
      dirtySteps: new Set(['topology']),
    });
    const next = wizardReducer(state, { type: 'RESET' });
    expect(next.showHelpPanel).toBe(false);
    expect(next.showSettings).toBe(false);
    expect(next.dirtySteps.size).toBe(0);
  });
});
