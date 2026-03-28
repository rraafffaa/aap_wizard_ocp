import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getDefaultConfig } from '../types';
import type { DeploymentConfig, WizardStep } from '../types';

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((idx: number) => Object.keys(store)[idx] ?? null),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// useAuditLog
// ---------------------------------------------------------------------------
describe('useAuditLog', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('starts with empty entries if no persisted data', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());
    expect(result.current.entries).toEqual([]);
  });

  it('logs an entry and persists it', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());

    act(() => {
      result.current.log('session_start', 'Wizard session started');
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].action).toBe('session_start');
    expect(result.current.entries[0].category).toBe('system');
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('filters entries by category', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());

    act(() => {
      result.current.log('step_enter', 'Entered topology', { step: 'topology' });
      result.current.log('deploy_start', 'Deployment started');
    });

    const navEntries = result.current.getEntries({ category: 'navigation' });
    expect(navEntries).toHaveLength(1);
    expect(navEntries[0].action).toBe('step_enter');
  });

  it('exports log as JSON string', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());

    act(() => {
      result.current.log('session_start', 'Started');
    });

    const exported = result.current.exportLog();
    const parsed = JSON.parse(exported);
    expect(parsed.totalEntries).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });

  it('clears log and removes from storage', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());

    act(() => {
      result.current.log('session_start', 'Started');
    });
    expect(result.current.entries).toHaveLength(1);

    act(() => {
      result.current.clearLog();
    });

    expect(result.current.entries).toHaveLength(0);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('aap-wizard-audit');
  });

  it('computes stats correctly', async () => {
    const { useAuditLog } = await import('../hooks/useAuditLog');
    const { result } = renderHook(() => useAuditLog());

    act(() => {
      result.current.log('step_enter', 'Entered topology', { step: 'topology' });
      result.current.log('config_change', 'Changed topology');
      result.current.log('config_change', 'Changed hosts');
    });

    const stats = result.current.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.configChanges).toBe(2);
    expect(stats.stepsVisited).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// useKeyboardShortcuts
// ---------------------------------------------------------------------------
describe('useKeyboardShortcuts', () => {
  it('registers and calls shortcut action on keydown', async () => {
    const { useKeyboardShortcuts } = await import('../hooks/useKeyboardShortcuts');
    const action = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts([
        { key: 's', ctrl: true, description: 'Save', category: 'actions', action },
      ]),
    );

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true });
    document.dispatchEvent(event);

    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire disabled shortcuts', async () => {
    const { useKeyboardShortcuts } = await import('../hooks/useKeyboardShortcuts');
    const action = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts([
        { key: 's', ctrl: true, description: 'Save', category: 'actions', action, enabled: false },
      ]),
    );

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true });
    document.dispatchEvent(event);

    expect(action).not.toHaveBeenCalled();
  });

  it('formats shortcut keys correctly', async () => {
    const { formatShortcut } = await import('../hooks/useKeyboardShortcuts');
    const shortcut = { key: 's', ctrl: true, shift: true, description: 'Test', category: 'actions' as const, action: () => {} };

    const formatted = formatShortcut(shortcut);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// useTheme
// ---------------------------------------------------------------------------
describe('useTheme', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    document.documentElement.setAttribute('data-theme', '');
    document.documentElement.className = '';

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('defaults to system theme', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('switches theme and persists', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('aap-wizard-theme', 'dark');
  });

  it('toggles between dark and light', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => { result.current.setTheme('dark'); });
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => { result.current.toggleTheme(); });
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('applies theme class to DOM', async () => {
    const { useTheme } = await import('../hooks/useTheme');
    const { result } = renderHook(() => useTheme());

    act(() => { result.current.setTheme('dark'); });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('pf-v5-theme-dark')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useNotifications
// ---------------------------------------------------------------------------
describe('useNotifications', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty notifications', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('adds a notification', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.add({
        title: 'Deployment started',
        message: 'AAP deployment is in progress',
        severity: 'info',
        category: 'deploy',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.hasUnread).toBe(true);
  });

  it('marks notification as read', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    let id: string = '';
    act(() => {
      id = result.current.add({
        title: 'Test',
        message: 'Test message',
        severity: 'info',
        category: 'test',
      });
    });

    act(() => { result.current.markRead(id); });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications[0].read).toBe(true);
  });

  it('marks all as read', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.add({ title: 'A', message: 'A', severity: 'info', category: 'test' });
      result.current.add({ title: 'B', message: 'B', severity: 'warning', category: 'test' });
    });

    expect(result.current.unreadCount).toBe(2);

    act(() => { result.current.markAllRead(); });
    expect(result.current.unreadCount).toBe(0);
  });

  it('removes a notification', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    let id: string = '';
    act(() => {
      id = result.current.add({ title: 'A', message: 'A', severity: 'info', category: 'test' });
    });

    act(() => { result.current.remove(id); });
    expect(result.current.notifications).toHaveLength(0);
  });

  it('clears all notifications', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.add({ title: 'A', message: 'A', severity: 'info', category: 'test' });
      result.current.add({ title: 'B', message: 'B', severity: 'error', category: 'test' });
    });

    act(() => { result.current.clear(); });
    expect(result.current.notifications).toHaveLength(0);
  });

  it('counts unread correctly after mixed operations', async () => {
    const { useNotifications } = await import('../hooks/useNotifications');
    const { result } = renderHook(() => useNotifications());

    let id1: string = '';
    act(() => {
      id1 = result.current.add({ title: 'A', message: 'A', severity: 'info', category: 'test' });
      result.current.add({ title: 'B', message: 'B', severity: 'warning', category: 'test' });
      result.current.add({ title: 'C', message: 'C', severity: 'error', category: 'test' });
    });

    expect(result.current.unreadCount).toBe(3);

    act(() => { result.current.markRead(id1); });
    expect(result.current.unreadCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// useWebSocket (mocked)
// ---------------------------------------------------------------------------
describe('useWebSocket', () => {
  let mockWsInstances: any[] = [];

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState = MockWebSocket.CONNECTING;
    onopen: ((ev: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      mockWsInstances.push(this);
    }

    send = vi.fn();
    close = vi.fn((code?: number, reason?: string) => {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code: code ?? 1000, reason });
    });

    simulateOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }

    simulateMessage(data: any) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }

    simulateError() {
      this.onerror?.({});
    }

    simulateClose(code = 1000) {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }

  beforeEach(() => {
    mockWsInstances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects when enabled', async () => {
    const { useWebSocket } = await import('../hooks/useWebSocket');
    const onMessage = vi.fn();

    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost/test',
        onMessage,
        enabled: true,
      }),
    );

    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0].url).toBe('ws://localhost/test');
  });

  it('receives parsed JSON messages', async () => {
    const { useWebSocket } = await import('../hooks/useWebSocket');
    const onMessage = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost/test',
        onMessage,
        enabled: true,
      }),
    );

    act(() => { mockWsInstances[0].simulateOpen(); });
    expect(result.current.connected).toBe(true);

    act(() => { mockWsInstances[0].simulateMessage({ type: 'log', line: 'hello' }); });
    expect(onMessage).toHaveBeenCalledWith({ type: 'log', line: 'hello' });
  });

  it('reports disconnected state on close', async () => {
    const { useWebSocket } = await import('../hooks/useWebSocket');
    const onMessage = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost/test',
        onMessage,
        enabled: true,
        reconnect: false,
      }),
    );

    act(() => { mockWsInstances[0].simulateOpen(); });
    expect(result.current.connected).toBe(true);

    act(() => { mockWsInstances[0].simulateClose(1000); });
    expect(result.current.connected).toBe(false);
  });

  it('does not connect when disabled', async () => {
    const { useWebSocket } = await import('../hooks/useWebSocket');
    const onMessage = vi.fn();

    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost/test',
        onMessage,
        enabled: false,
      }),
    );

    expect(mockWsInstances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// useStepMachine
// ---------------------------------------------------------------------------
describe('useStepMachine', () => {
  let defaultConfig: DeploymentConfig;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    defaultConfig = {
      ...getDefaultConfig(),
      eula_accepted: true,
      registry: { username: 'user', password: 'pass' },
    };
    window.location.hash = '';
  });

  it('starts at the first wizard step', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    expect(result.current.state.currentStep).toBe('welcome');
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.canGoBack).toBe(false);
  });

  it('navigates forward when validation passes', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    let success: boolean = false;
    act(() => { success = result.current.goNext(); });

    expect(success).toBe(true);
    expect(result.current.state.currentStep).toBe('eula');
    expect(result.current.canGoBack).toBe(true);
  });

  it('navigates backward', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.goNext(); });
    expect(result.current.state.currentStep).toBe('eula');

    act(() => { result.current.goBack(); });
    expect(result.current.state.currentStep).toBe('welcome');
  });

  it('marks step as completed on forward navigation', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.goNext(); });
    expect(result.current.isStepCompleted('welcome')).toBe(true);
  });

  it('tracks visited steps', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    expect(result.current.isStepVisited('welcome')).toBe(true);
    expect(result.current.isStepVisited('eula')).toBe(false);

    act(() => { result.current.goNext(); });
    expect(result.current.isStepVisited('eula')).toBe(true);
  });

  it('tracks dirty state', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.markDirty('topology'); });
    expect(result.current.isStepDirty('topology')).toBe(true);

    act(() => { result.current.clearDirty('topology'); });
    expect(result.current.isStepDirty('topology')).toBe(false);
  });

  it('clears dirty on markCompleted', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.markDirty('topology'); });
    expect(result.current.isStepDirty('topology')).toBe(true);

    act(() => { result.current.markCompleted('topology'); });
    expect(result.current.isStepDirty('topology')).toBe(false);
    expect(result.current.isStepCompleted('topology')).toBe(true);
  });

  it('records transition history', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.goNext(); });
    act(() => { result.current.goBack(); });

    const history = result.current.getTransitionHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].direction).toBe('forward');
    expect(history[1].direction).toBe('backward');
  });

  it('respects custom guards', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const guards = [
      {
        step: 'eula' as WizardStep,
        check: () => ({ allowed: false, reason: 'Custom guard blocked' }),
      },
    ];

    const { result } = renderHook(() => useStepMachine(defaultConfig, guards));

    let success: boolean = true;
    act(() => { success = result.current.goNext(); });

    expect(success).toBe(false);
    expect(result.current.state.currentStep).toBe('welcome');
    expect(result.current.nextBlockReason).toBe('Custom guard blocked');
  });

  it('resets to initial state', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => { result.current.goNext(); });
    expect(result.current.state.currentStep).toBe('eula');

    act(() => { result.current.reset(); });
    expect(result.current.state.currentStep).toBe('welcome');
    expect(result.current.state.completedSteps.size).toBe(0);
    expect(result.current.getTransitionHistory()).toHaveLength(0);
  });

  it('restores partial state', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    act(() => {
      result.current.restoreState({
        currentStep: 'topology',
        completedSteps: new Set(['welcome', 'eula', 'subscription']),
      });
    });

    expect(result.current.state.currentStep).toBe('topology');
    expect(result.current.isStepCompleted('welcome')).toBe(true);
    expect(result.current.isStepCompleted('eula')).toBe(true);
  });

  it('reports total duration', async () => {
    const { useStepMachine } = await import('../hooks/useStepMachine');
    const { result } = renderHook(() => useStepMachine(defaultConfig));

    const duration = result.current.getTotalDuration();
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// useDeployment
// ---------------------------------------------------------------------------
describe('useDeployment', () => {
  let defaultConfig: DeploymentConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    defaultConfig = getDefaultConfig();
    mockFetch.mockReset();
  });

  it('starts in idle state', async () => {
    const { useDeployment } = await import('../hooks/useDeployment');
    const { result } = renderHook(() => useDeployment(defaultConfig));

    expect(result.current.state.status).toBe('idle');
    expect(result.current.isActive).toBe(false);
    expect(result.current.canStart).toBe(true);
    expect(result.current.canCancel).toBe(false);
    expect(result.current.canRetry).toBe(false);
  });

  it('has default phases', async () => {
    const { useDeployment } = await import('../hooks/useDeployment');
    const { result } = renderHook(() => useDeployment(defaultConfig));

    expect(result.current.state.phases.length).toBeGreaterThan(0);
    expect(result.current.state.phases.every((p: { status: string }) => p.status === 'pending')).toBe(true);
  });

  it('transitions to failed on start error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useDeployment } = await import('../hooks/useDeployment');
    const { result } = renderHook(() => useDeployment(defaultConfig));

    await act(async () => {
      await result.current.actions.start();
    });

    expect(result.current.state.status).toBe('failed');
    expect(result.current.state.error).toContain('Network error');
    expect(result.current.canRetry).toBe(true);
  });

  it('resets to idle state', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    const { useDeployment } = await import('../hooks/useDeployment');
    const { result } = renderHook(() => useDeployment(defaultConfig));

    await act(async () => { await result.current.actions.start(); });
    expect(result.current.state.status).toBe('failed');

    act(() => { result.current.actions.reset(); });
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.logLines).toEqual([]);
  });

  it('computes isTerminal correctly for completed states', async () => {
    const { useDeployment } = await import('../hooks/useDeployment');
    const { result } = renderHook(() => useDeployment(defaultConfig));

    expect(result.current.isTerminal).toBe(false);

    mockFetch.mockRejectedValueOnce(new Error('fail'));
    await act(async () => { await result.current.actions.start(); });

    expect(result.current.isTerminal).toBe(true);
  });
});
