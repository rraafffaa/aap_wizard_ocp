import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlatformStep } from '../steps/PlatformStep';
import { ClusterStep } from '../steps/ClusterStep';
import { NamespaceStep } from '../steps/NamespaceStep';
import { OperatorStep } from '../steps/OperatorStep';
import { ReplicasStep } from '../steps/ReplicasStep';
import { OnboardingStep } from '../steps/OnboardingStep';
import { getDefaultConfig, type DeploymentConfig } from '../types';

// ─── Mock Config Helper ────────────────────────────────────────────────────

function createMockConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return { ...getDefaultConfig(), ...overrides };
}

// ─── Global Fetch Mock ─────────────────────────────────────────────────────

global.fetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response);
});

// ─── PlatformStep Tests (5 tests) ──────────────────────────────────────────

describe('PlatformStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both platform cards', () => {
    const config = createMockConfig();
    render(<PlatformStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Containerized (RHEL)')).toBeInTheDocument();
    expect(screen.getByText('Operator (OpenShift)')).toBeInTheDocument();
  });

  it('containerized is selected by default', () => {
    const config = createMockConfig({ platform: 'containerized' });
    render(<PlatformStep config={config} updateConfig={mockUpdateConfig} />);
    const containerizedCard = screen.getByText('Containerized (RHEL)').closest('.aap-selection-card');
    expect(containerizedCard).toHaveClass('aap-selection-card--selected');
  });

  it('clicking OpenShift card calls updateConfig with platform: openshift', () => {
    const config = createMockConfig({ platform: 'containerized' });
    render(<PlatformStep config={config} updateConfig={mockUpdateConfig} />);
    const openshiftCard = screen.getByText('Operator (OpenShift)').closest('.aap-selection-card');
    fireEvent.click(openshiftCard!);
    expect(mockUpdateConfig).toHaveBeenCalledWith({ platform: 'openshift' });
  });

  it('comparison table toggles on button click', () => {
    const config = createMockConfig();
    render(<PlatformStep config={config} updateConfig={mockUpdateConfig} />);
    const toggleButton = screen.getByRole('button', { name: /compare platforms/i });
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(screen.queryByText('Infrastructure')).not.toBeInTheDocument();
  });

  it('shows documentation links for both platforms', () => {
    const config = createMockConfig({ platform: 'openshift' });
    render(<PlatformStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Containerized Installation Guide')).toBeInTheDocument();
    expect(screen.getByText('OpenShift Installation Guide')).toBeInTheDocument();
  });
});

// ─── ClusterStep Tests (5 tests) ───────────────────────────────────────────

describe('ClusterStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders API URL and token inputs', () => {
    const config = createMockConfig();
    render(<ClusterStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByLabelText(/API Server URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Authentication Token/i)).toBeInTheDocument();
  });

  it('verify button is disabled when fields are empty', () => {
    const config = createMockConfig();
    render(<ClusterStep config={config} updateConfig={mockUpdateConfig} />);
    const verifyButton = screen.getByRole('button', { name: /verify connection/i });
    expect(verifyButton).toBeDisabled();
  });

  it('verify button is enabled when both fields have values', () => {
    const config = createMockConfig();
    config.ocp.api_url = 'https://api.example.com:6443';
    config.ocp.token = 'sha256~test-token';
    render(<ClusterStep config={config} updateConfig={mockUpdateConfig} />);
    const verifyButton = screen.getByRole('button', { name: /verify connection/i });
    expect(verifyButton).not.toBeDisabled();
  });

  it('updates config when API URL is changed', () => {
    const config = createMockConfig();
    render(<ClusterStep config={config} updateConfig={mockUpdateConfig} />);
    const apiInput = screen.getByLabelText(/API Server URL/i);
    fireEvent.change(apiInput, { target: { value: 'https://api.test.com:6443' } });
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ api_url: 'https://api.test.com:6443' }),
    });
  });

  it('shows success message on successful connection verification', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        connected: true,
        version: '4.14',
        platform: 'AWS',
        nodes: [],
        storage_classes: ['gp3-csi'],
        operators: [],
      }),
    } as Response);

    const config = createMockConfig();
    config.ocp.api_url = 'https://api.example.com:6443';
    config.ocp.token = 'sha256~test-token';
    render(<ClusterStep config={config} updateConfig={mockUpdateConfig} />);

    const verifyButton = screen.getByRole('button', { name: /verify connection/i });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText(/connected successfully/i)).toBeInTheDocument();
    });
  });
});

// ─── NamespaceStep Tests (6 tests) ─────────────────────────────────────────

describe('NamespaceStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders namespace input with default value', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    const namespaceInput = screen.getByLabelText(/Target Namespace/i) as HTMLInputElement;
    expect(namespaceInput.value).toBe('aap');
  });

  it('renders storage class input', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByLabelText(/Storage Class/i)).toBeInTheDocument();
  });

  it('storage presets render', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Small')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
  });

  it('clicking storage preset updates config', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    const largePreset = screen.getByText('Large').closest('.aap-selection-card');
    fireEvent.click(largePreset!);
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({
        postgres_storage_size: '100Gi',
        hub_storage_size: '250Gi',
      }),
    });
  });

  it('hub backend selector has file/s3/azure options', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    const backendSelect = screen.getByLabelText(/Backend Type/i) as HTMLSelectElement;
    expect(backendSelect.value).toBe('file');
    expect(backendSelect.querySelector('option[value="file"]')).toBeInTheDocument();
    expect(backendSelect.querySelector('option[value="s3"]')).toBeInTheDocument();
    expect(backendSelect.querySelector('option[value="azure"]')).toBeInTheDocument();
  });

  it('updates namespace when input changes', () => {
    const config = createMockConfig();
    render(<NamespaceStep config={config} updateConfig={mockUpdateConfig} />);
    const namespaceInput = screen.getByLabelText(/Target Namespace/i);
    fireEvent.change(namespaceInput, { target: { value: 'my-aap' } });
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ namespace: 'my-aap' }),
    });
  });
});

// ─── OperatorStep Tests (4 tests) ──────────────────────────────────────────

describe('OperatorStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders channel selector with stable-2.6 default', () => {
    const config = createMockConfig();
    render(<OperatorStep config={config} updateConfig={mockUpdateConfig} />);
    const channelSelect = screen.getByLabelText(/Update Channel/i) as HTMLSelectElement;
    expect(channelSelect.value).toBe('stable-2.6');
  });

  it('check status button renders', () => {
    const config = createMockConfig();
    render(<OperatorStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByRole('button', { name: /check status/i })).toBeInTheDocument();
  });

  it('shows operator channel and status sections', () => {
    const config = createMockConfig();
    render(<OperatorStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Operator Channel')).toBeInTheDocument();
    expect(screen.getByText('Operator Status')).toBeInTheDocument();
  });

  it('updates channel when selector changes', () => {
    const config = createMockConfig();
    render(<OperatorStep config={config} updateConfig={mockUpdateConfig} />);
    const channelSelect = screen.getByLabelText(/Update Channel/i);
    fireEvent.change(channelSelect, { target: { value: 'stable-2.5' } });
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ operator_channel: 'stable-2.5' }),
    });
  });
});

// ─── ReplicasStep Tests (6 tests) ──────────────────────────────────────────

describe('ReplicasStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 4 component replica counters', () => {
    const config = createMockConfig();
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Platform Gateway')).toBeInTheDocument();
    expect(screen.getByText('Automation Controller')).toBeInTheDocument();
    expect(screen.getByText('Automation Hub')).toBeInTheDocument();
    expect(screen.getByText('Event-Driven Ansible')).toBeInTheDocument();
  });

  it('increment button increases replica count', () => {
    const config = createMockConfig();
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    const incrementButton = screen.getAllByLabelText(/increase.*replicas/i)[0];
    fireEvent.click(incrementButton);
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ gateway_replicas: 2 }),
    });
  });

  it('decrement button decreases replica count', () => {
    const config = createMockConfig();
    config.ocp.gateway_replicas = 3;
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    const decrementButton = screen.getAllByLabelText(/decrease.*replicas/i)[0];
    fireEvent.click(decrementButton);
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ gateway_replicas: 2 }),
    });
  });

  it('minimum replica is 1 - decrement disabled at 1', () => {
    const config = createMockConfig();
    config.ocp.gateway_replicas = 1;
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    const decrementButton = screen.getAllByLabelText(/decrease.*replicas/i)[0];
    expect(decrementButton).toBeDisabled();
  });

  it('resource presets render and are selectable', () => {
    const config = createMockConfig();
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Resource Preset')).toBeInTheDocument();
    const presetCards = screen.getAllByRole('radio');
    expect(presetCards.length).toBeGreaterThanOrEqual(3);

    const largePreset = screen.getAllByText('Large')[0].closest('.aap-selection-card');
    fireEvent.click(largePreset!);
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      ocp: expect.objectContaining({ controller_resource_preset: 'large' }),
    });
  });

  it('displays total pods count', () => {
    const config = createMockConfig();
    config.ocp.gateway_replicas = 2;
    config.ocp.controller_replicas = 3;
    config.ocp.hub_replicas = 2;
    config.ocp.eda_replicas = 1;
    render(<ReplicasStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});

// ─── OnboardingStep Tests (6 tests) ────────────────────────────────────────

describe('OnboardingStep', () => {
  const mockUpdateConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 5 onboarding tasks', () => {
    const config = createMockConfig();
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText('Upload Subscription Manifest')).toBeInTheDocument();
    expect(screen.getByText('Create Your First Project')).toBeInTheDocument();
    expect(screen.getByText('Add Managed Hosts')).toBeInTheDocument();
    expect(screen.getByText('Create a Job Template')).toBeInTheDocument();
    expect(screen.getByText('Run Your First Job')).toBeInTheDocument();
  });

  it('progress bar shows 0 of 5 initially', () => {
    const config = createMockConfig();
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText(/0 of 5 steps completed/i)).toBeInTheDocument();
  });

  it('mark as done button updates progress', () => {
    const config = createMockConfig();
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    const markDoneButton = screen.getAllByRole('button', { name: /mark as done/i })[0];
    fireEvent.click(markDoneButton);
    expect(mockUpdateConfig).toHaveBeenCalledWith({
      onboarding: expect.objectContaining({ manifest_uploaded: true }),
    });
  });

  it('completed tasks show checkmark', () => {
    const config = createMockConfig();
    config.onboarding.manifest_uploaded = true;
    config.onboarding.project_created = true;
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    const completedBadges = screen.getAllByText('Completed');
    expect(completedBadges.length).toBe(2);
  });

  it('progress updates when tasks are completed', () => {
    const config = createMockConfig();
    config.onboarding.manifest_uploaded = true;
    config.onboarding.project_created = true;
    config.onboarding.inventory_created = true;
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText(/3 of 5 steps completed/i)).toBeInTheDocument();
  });

  it('shows success message when all tasks complete', () => {
    const config = createMockConfig();
    config.onboarding.manifest_uploaded = true;
    config.onboarding.project_created = true;
    config.onboarding.inventory_created = true;
    config.onboarding.template_created = true;
    config.onboarding.job_launched = true;
    render(<OnboardingStep config={config} updateConfig={mockUpdateConfig} />);
    expect(screen.getByText("You're All Set!")).toBeInTheDocument();
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
  });
});
