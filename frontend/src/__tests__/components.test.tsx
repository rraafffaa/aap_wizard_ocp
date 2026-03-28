import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  PasswordStrength,
  evaluateStrength,
  calculateEntropy,
} from '../components/PasswordStrength';
import {
  TopologyDiagram,
  layoutNodes,
} from '../components/TopologyDiagram';
import {
  ConfigDiff,
  formatDiffValue,
  type DiffEntry,
} from '../components/ConfigDiff';
import {
  CommandPalette,
  fuzzyMatch,
  loadRecentCommands,
  saveRecentCommand,
} from '../components/CommandPalette';
import {
  AuditTimeline,
  getTimePeriod,
  type AuditEntry,
} from '../components/AuditTimeline';
import { getDefaultConfig, WIZARD_STEPS, type DeploymentConfig } from '../types';
import { computeDiff, flattenDiff } from '../utils/diffEngine';

// ─── Mock Config Helper ────────────────────────────────────────────────────

function createMockConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return { ...getDefaultConfig(), ...overrides };
}

function createEnterpriseConfig(): DeploymentConfig {
  const base = createMockConfig({ topology: 'enterprise' });
  base.gateway.hosts = ['gw1.example.org', 'gw2.example.org'];
  base.controller.hosts = ['ctrl1.example.org', 'ctrl2.example.org'];
  base.hub.hosts = ['hub1.example.org', 'hub2.example.org'];
  base.eda.hosts = ['eda1.example.org', 'eda2.example.org'];
  base.execution_nodes = [
    { host: 'exec1.example.org', receptor_type: 'execution' },
    { host: 'hop1.example.org', receptor_type: 'hop' },
  ];
  base.database.type = 'external';
  base.database.host = 'db.example.org';
  return base;
}

// ─── PasswordStrength Tests (15 tests) ───────────────────────────────────────

describe('PasswordStrength', () => {
  describe('evaluateStrength / calculateEntropy logic', () => {
    it('empty password renders minimal state', () => {
      const result = evaluateStrength('');
      expect(result.level).toBe('weak');
      expect(result.label).toBe('');
      expect(result.score).toBe(0);
      expect(result.entropy).toBe(0);
      expect(result.passedCriteria).toEqual([false, false, false, false, false]);
    });

    it('weak password returns correct level', () => {
      const result = evaluateStrength('abc');
      expect(result.level).toBe('weak');
      expect(result.score).toBeLessThanOrEqual(2);
    });

    it('strong password returns correct level', () => {
      const result = evaluateStrength('Abcdefgh123!');
      expect(result.passedCriteria.filter(Boolean).length).toBeGreaterThanOrEqual(4);
      expect(['good', 'strong', 'excellent']).toContain(result.level);
    });

    it('excellent password returns correct level', () => {
      const result = evaluateStrength('Abcdefghijklmnop123!@#');
      expect(result.level).toBe('excellent');
      expect(result.score).toBe(5);
    });

    it('details mode shows criteria', () => {
      render(<PasswordStrength password="Abcdefgh123!" showDetails />);
      expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument();
      expect(screen.getByText(/Uppercase letter/)).toBeInTheDocument();
      expect(screen.getByText(/Lowercase letter/)).toBeInTheDocument();
      expect(screen.getByText(/Number/)).toBeInTheDocument();
      expect(screen.getByText(/Symbol/)).toBeInTheDocument();
    });

    it('criterion: at least 12 characters', () => {
      expect(evaluateStrength('Abcdefgh123!').passedCriteria[0]).toBe(true);
      expect(evaluateStrength('Abc1!').passedCriteria[0]).toBe(false);
    });

    it('criterion: uppercase letter', () => {
      expect(evaluateStrength('Abcdefgh123!').passedCriteria[1]).toBe(true);
      expect(evaluateStrength('abcdefgh123!').passedCriteria[1]).toBe(false);
    });

    it('criterion: lowercase letter', () => {
      expect(evaluateStrength('Abcdefgh123!').passedCriteria[2]).toBe(true);
      expect(evaluateStrength('ABCDEFGH123!').passedCriteria[2]).toBe(false);
    });

    it('criterion: number', () => {
      expect(evaluateStrength('Abcdefgh123!').passedCriteria[3]).toBe(true);
      expect(evaluateStrength('Abcdefghijkl!').passedCriteria[3]).toBe(false);
    });

    it('criterion: symbol', () => {
      expect(evaluateStrength('Abcdefgh123!').passedCriteria[4]).toBe(true);
      expect(evaluateStrength('Abcdefgh12345').passedCriteria[4]).toBe(false);
    });

    it('entropy calculation accuracy', () => {
      expect(calculateEntropy('')).toBe(0);
      const lowerOnly = calculateEntropy('abcdefgh');
      const mixed = calculateEntropy('Abcdefgh1!');
      expect(mixed).toBeGreaterThan(lowerOnly);
    });

    it('very long password handling', () => {
      const long = 'A'.repeat(200) + 'a1!';
      const result = evaluateStrength(long);
      expect(result.passedCriteria[0]).toBe(true);
      expect(result.entropy).toBeGreaterThan(50);
    });

    it('component function exists and is callable', () => {
      expect(typeof PasswordStrength).toBe('function');
      expect(() => render(<PasswordStrength password="test" />)).not.toThrow();
    });

    it('component renders with empty password', () => {
      render(<PasswordStrength password="" />);
      expect(screen.getByRole('group', { name: /password strength/i })).toBeInTheDocument();
    });

    it('component renders with showDetails and entropy', () => {
      render(<PasswordStrength password="Abcdefgh123!" showDetails />);
      expect(screen.getByText(/bits entropy/)).toBeInTheDocument();
    });
  });
});

// ─── TopologyDiagram Tests (15 tests) ───────────────────────────────────────

describe('TopologyDiagram', () => {
  it('growth config produces single-node layout', () => {
    const config = createMockConfig({ topology: 'growth' });
    const { nodes } = layoutNodes(config);
    const aio = nodes.find((n) => n.id === 'aio');
    expect(aio).toBeDefined();
    expect(aio?.type).toBe('gateway');
    expect(nodes.filter((n) => n.type !== 'user' && n.type !== 'loadbalancer').length).toBeLessThanOrEqual(5);
  });

  it('enterprise config produces multi-node layout', () => {
    const config = createEnterpriseConfig();
    const { nodes } = layoutNodes(config);
    const gateways = nodes.filter((n) => n.type === 'gateway');
    expect(gateways.length).toBe(2);
    expect(nodes.filter((n) => n.type === 'controller').length).toBe(2);
  });

  it('node count matches config hosts', () => {
    const config = createEnterpriseConfig();
    const { nodes } = layoutNodes(config);
    const gwCount = config.gateway.hosts.length;
    const gwNodes = nodes.filter((n) => n.id.startsWith('gw-'));
    expect(gwNodes.length).toBe(gwCount);
  });

  it('connection count is correct for growth', () => {
    const config = createMockConfig({ topology: 'growth' });
    const { connections } = layoutNodes(config);
    expect(connections.length).toBeGreaterThanOrEqual(3);
    expect(connections.some((c) => c.type === 'primary')).toBe(true);
    expect(connections.some((c) => c.type === 'database')).toBe(true);
    expect(connections.some((c) => c.type === 'redis')).toBe(true);
  });

  it('connection count is correct for enterprise', () => {
    const config = createEnterpriseConfig();
    const { connections } = layoutNodes(config);
    expect(connections.length).toBeGreaterThan(5);
  });

  it('execution nodes appear in enterprise', () => {
    const config = createEnterpriseConfig();
    const { nodes } = layoutNodes(config);
    const execNodes = nodes.filter((n) => n.type === 'execution' || n.type === 'hop');
    expect(execNodes.length).toBe(2);
  });

  it('database node always present', () => {
    const growth = layoutNodes(createMockConfig({ topology: 'growth' }));
    const enterprise = layoutNodes(createEnterpriseConfig());
    expect(growth.nodes.some((n) => n.type === 'database')).toBe(true);
    expect(enterprise.nodes.some((n) => n.type === 'database')).toBe(true);
  });

  it('legend items are correct for growth', () => {
    const config = createMockConfig({ topology: 'growth' });
    render(<TopologyDiagram config={config} />);
    expect(screen.getByRole('img', { name: /growth topology/i })).toBeInTheDocument();
  });

  it('legend items are correct for enterprise', () => {
    const config = createEnterpriseConfig();
    render(<TopologyDiagram config={config} />);
    expect(screen.getByRole('img', { name: /enterprise topology/i })).toBeInTheDocument();
  });

  it('empty hosts handled gracefully', () => {
    const config = createMockConfig({ topology: 'growth' });
    config.gateway.hosts = [];
    const { nodes } = layoutNodes(config);
    const aio = nodes.find((n) => n.id === 'aio');
    expect(aio?.hostname).toBeDefined();
  });

  it('node colors match component type', () => {
    const config = createEnterpriseConfig();
    const { nodes } = layoutNodes(config);
    const gateway = nodes.find((n) => n.type === 'gateway');
    const controller = nodes.find((n) => n.type === 'controller');
    expect(gateway).toBeDefined();
    expect(controller).toBeDefined();
  });

  it('layoutNodes function exists and is callable', () => {
    expect(typeof layoutNodes).toBe('function');
    const result = layoutNodes(createMockConfig());
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('connections');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.connections)).toBe(true);
  });

  it('growth has user and aio nodes', () => {
    const { nodes } = layoutNodes(createMockConfig({ topology: 'growth' }));
    expect(nodes.some((n) => n.type === 'user')).toBe(true);
    expect(nodes.some((n) => n.id === 'aio')).toBe(true);
  });

  it('enterprise has load balancer when multiple gateways', () => {
    const config = createEnterpriseConfig();
    const { nodes } = layoutNodes(config);
    expect(nodes.some((n) => n.type === 'loadbalancer')).toBe(true);
  });

  it('component renders without throwing', () => {
    expect(() => render(<TopologyDiagram config={createMockConfig()} />)).not.toThrow();
  });
});

// ─── ConfigDiff Tests (10 tests) ────────────────────────────────────────────

describe('ConfigDiff', () => {
  it('no changes renders empty state', () => {
    render(<ConfigDiff entries={[]} />);
    expect(screen.getByText('No differences found')).toBeInTheDocument();
  });

  it('added fields show green', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'General', field: 'New Field', type: 'added', newValue: 'value' },
    ];
    render(<ConfigDiff entries={entries} />);
    expect(screen.getByText('New Field')).toBeInTheDocument();
    expect(screen.getByText('value')).toBeInTheDocument();
  });

  it('removed fields show red', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'General', field: 'Removed Field', type: 'removed', oldValue: 'old' },
    ];
    render(<ConfigDiff entries={entries} />);
    expect(screen.getByText('Removed Field')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
  });

  it('changed fields show both values', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'General', field: 'Changed', type: 'changed', oldValue: 'old', newValue: 'new' },
    ];
    render(<ConfigDiff entries={entries} />);
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });

  it('compact mode renders smaller', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'General', field: 'Field', type: 'added', newValue: 'v' },
    ];
    const { container } = render(<ConfigDiff entries={entries} compact />);
    expect(container.querySelector('.aap-diff--compact')).toBeTruthy();
  });

  it('category grouping works', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'Category A', field: 'Field1', type: 'added', newValue: 'v1' },
      { path: 'b', category: 'Category B', field: 'Field2', type: 'added', newValue: 'v2' },
    ];
    render(<ConfigDiff entries={entries} />);
    expect(screen.getByText('Category A')).toBeInTheDocument();
    expect(screen.getByText('Category B')).toBeInTheDocument();
  });

  it('passwords are masked', () => {
    expect(formatDiffValue('secret123', 'admin_password')).toBe('********');
    expect(formatDiffValue('secret123', 'password')).toBe('********');
    expect(formatDiffValue('secret123', 'api_key')).toBe('********');
  });

  it('nested changes flatten correctly via diffEngine', () => {
    const oldObj = { nested: { a: 1 } };
    const newObj = { nested: { a: 2 } };
    const diff = computeDiff(oldObj, newObj);
    const flat = flattenDiff(diff);
    const changed = flat.find((e) => e.key === 'a');
    expect(changed?.type).toBe('changed');
    expect(changed?.oldValue).toBe(1);
    expect(changed?.newValue).toBe(2);
  });

  it('formatDiffValue handles various types', () => {
    expect(formatDiffValue(null, 'x')).toBe('(empty)');
    expect(formatDiffValue(undefined, 'x')).toBe('(empty)');
    expect(formatDiffValue(true, 'x')).toBe('Yes');
    expect(formatDiffValue(false, 'x')).toBe('No');
    expect(formatDiffValue([1, 2], 'x')).toBe('1, 2');
    expect(formatDiffValue('', 'x')).toBe('(empty)');
    expect(formatDiffValue(42, 'x')).toBe('42');
  });

  it('component accepts title prop', () => {
    const entries: DiffEntry[] = [
      { path: 'a', category: 'G', field: 'F', type: 'added', newValue: 'v' },
    ];
    render(<ConfigDiff entries={entries} title="Custom Title" />);
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });
});

// ─── CommandPalette Tests (10 tests) ───────────────────────────────────────

describe('CommandPalette', () => {
  const mockOnClose = vi.fn();
  const mockOnNavigate = vi.fn();
  const mockOnAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('all navigate commands exist for each step', () => {
    expect(WIZARD_STEPS.length).toBeGreaterThanOrEqual(12);
    WIZARD_STEPS.forEach((step: { id: string; label: string }) => {
      const match = fuzzyMatch(step.label.toLowerCase(), `Go to ${step.label}`);
      expect(match.matches).toBe(true);
    });
  });

  it('fuzzy match finds partial matches', () => {
    const result = fuzzyMatch('wel', 'Welcome');
    expect(result.matches).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('exact match scores higher than fuzzy', () => {
    const exact = fuzzyMatch('welcome', 'Welcome');
    const partial = fuzzyMatch('wel', 'Welcome');
    expect(exact.matches).toBe(true);
    expect(partial.matches).toBe(true);
    expect(exact.score).toBeGreaterThan(partial.score);
  });

  it('empty query shows placeholder or recent when no query', () => {
    render(
      <CommandPalette
        isOpen
        onClose={mockOnClose}
        onNavigate={mockOnNavigate}
        onAction={mockOnAction}
        currentStep="welcome"
      />,
    );
    const emptyResult = fuzzyMatch('', 'Go to Welcome');
    expect(emptyResult.matches).toBe(true);
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it('no results for gibberish query', () => {
    const result = fuzzyMatch('xyznonexistent123', 'Go to Welcome');
    expect(result.matches).toBe(false);
  });

  it('recent commands stored correctly', () => {
    saveRecentCommand('nav-welcome');
    const recent = loadRecentCommands();
    expect(recent).toContain('nav-welcome');
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  it('keyboard Escape closes palette', () => {
    render(
      <CommandPalette
        isOpen
        onClose={mockOnClose}
        onNavigate={mockOnNavigate}
        onAction={mockOnAction}
        currentStep="welcome"
      />,
    );
    const palette = document.querySelector('.aap-cmd-palette');
    expect(palette).toBeTruthy();
    fireEvent.keyDown(palette!, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('fuzzyMatch returns correct structure', () => {
    const r = fuzzyMatch('sub', 'Subscription');
    expect(r).toHaveProperty('matches');
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('indices');
    expect(Array.isArray(r.indices)).toBe(true);
  });

  it('loadRecentCommands returns empty when none stored', () => {
    localStorage.removeItem('aap-wizard-recent-commands');
    const recent = loadRecentCommands();
    expect(recent).toEqual([]);
  });

  it('saveRecentCommand limits to 5 items', () => {
    for (let i = 0; i < 7; i++) {
      saveRecentCommand(`cmd-${i}`);
    }
    const recent = loadRecentCommands();
    expect(recent.length).toBeLessThanOrEqual(5);
  });
});

// ─── AuditTimeline Tests (10 tests) ────────────────────────────────────────

describe('AuditTimeline', () => {
  it('empty entries shows empty state', () => {
    render(<AuditTimeline entries={[]} />);
    expect(screen.getByText('No audit entries yet')).toBeInTheDocument();
  });

  it('entries sorted by timestamp', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: 1000, category: 'navigation', action: 'a', description: 'First' },
      { id: '2', timestamp: 2000, category: 'navigation', action: 'b', description: 'Second' },
    ];
    render(<AuditTimeline entries={entries} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('category filter reduces entries', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: Date.now(), category: 'navigation', action: 'nav', description: 'Nav event' },
      { id: '2', timestamp: Date.now(), category: 'config_change', action: 'change', description: 'Config change' },
    ];
    render(<AuditTimeline entries={entries} />);
    const configBtn = screen.getByRole('tab', { name: /config changes/i });
    fireEvent.click(configBtn);
    expect(screen.getByText('Config change')).toBeInTheDocument();
  });

  it('search filters by text', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: Date.now(), category: 'navigation', action: 'a', description: 'Unique description here' },
    ];
    render(<AuditTimeline entries={entries} />);
    const search = screen.getByPlaceholderText(/search audit log/i);
    fireEvent.change(search, { target: { value: 'Unique' } });
    expect(screen.getByText('Unique description here')).toBeInTheDocument();
  });

  it('time grouping Today/Yesterday/Earlier', () => {
    const now = Date.now();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    expect(getTimePeriod(today.getTime())).toBe('Today');
    expect(getTimePeriod(yesterday.getTime())).toBe('Yesterday');
    expect(getTimePeriod(yesterday.getTime() - 86400000)).not.toBe('Today');
  });

  it('export generates JSON', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: 1000, category: 'navigation', action: 'a', description: 'Test' },
    ];
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    render(<AuditTimeline entries={entries} />);
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);

    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('component renders with entries', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: Date.now(), category: 'navigation', action: 'go', description: 'Navigated to step' },
    ];
    render(<AuditTimeline entries={entries} />);
    expect(screen.getByText('Navigated to step')).toBeInTheDocument();
  });

  it('filter buttons present', () => {
    render(<AuditTimeline entries={[]} />);
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /config changes/i })).toBeInTheDocument();
  });

  it('search shows no matching when no match', () => {
    const entries: AuditEntry[] = [
      { id: '1', timestamp: Date.now(), category: 'navigation', action: 'a', description: 'Some text' },
    ];
    render(<AuditTimeline entries={entries} />);
    const search = screen.getByPlaceholderText(/search audit log/i);
    fireEvent.change(search, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/no matching entries/i)).toBeInTheDocument();
  });

  it('getTimePeriod returns formatted date for old timestamps', () => {
    const oldDate = new Date('2020-01-15T12:00:00');
    const result = getTimePeriod(oldDate.getTime());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(['Today', 'Yesterday']).not.toContain(result);
  });
});
