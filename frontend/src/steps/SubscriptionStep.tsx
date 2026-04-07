import React from 'react';
import {
  CheckIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import { UIIcon } from '../components/ProductIcon';
import type { DeploymentConfig, InstallationType } from '../types';
import { FormField, TextInput } from '../components/FormField';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function SubscriptionStep({ config, updateConfig }: Props) {
  const setInstType = (type: InstallationType) => updateConfig({ installation_type: type });
  const isOnline = config.installation_type === 'online';

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Installation Type</h2>
      </div>

      <div className="aap-step__section">
        <div className="aap-selection-grid aap-selection-grid--2col" role="radiogroup" aria-label="Installation type">
          <div
            className={`aap-selection-card ${isOnline ? 'aap-selection-card--selected' : ''}`}
            role="radio"
            aria-checked={isOnline}
            tabIndex={0}
            onClick={() => setInstType('online')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInstType('online'); } }}
          >
            <div className="aap-selection-card__indicator" aria-hidden="true">
              {isOnline && <CheckIcon />}
            </div>
            <div className="aap-selection-card__icon"><UIIcon name="cloud-download" size={24} /></div>
            <div className="aap-selection-card__title">Online Installation</div>
            <div className="aap-selection-card__description">
              Pull images from registry.redhat.io. Requires internet access.
            </div>
          </div>
          <div
            className={`aap-selection-card ${!isOnline ? 'aap-selection-card--selected' : ''}`}
            role="radio"
            aria-checked={!isOnline}
            tabIndex={0}
            onClick={() => setInstType('disconnected')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInstType('disconnected'); } }}
          >
            <div className="aap-selection-card__indicator" aria-hidden="true">
              {!isOnline && <CheckIcon />}
            </div>
            <div className="aap-selection-card__icon"><UIIcon name="package" size={24} /></div>
            <div className="aap-selection-card__title">Disconnected (Bundled)</div>
            <div className="aap-selection-card__description">
              Bundled images for air-gapped environments.
            </div>
          </div>
        </div>
      </div>

      {isOnline && (
        <div className="aap-card aap-mt-lg">
          <h3 className="aap-card__title">Registry Credentials</h3>
          <div className="aap-form-row">
            <FormField label="Registry Username" required>
              <TextInput
                value={config.registry.username}
                onChange={(v) => updateConfig({ registry: { ...config.registry, username: v } })}
                placeholder="Your registry.redhat.io username"
              />
            </FormField>
            <FormField label="Registry Password" required>
              <TextInput
                value={config.registry.password}
                onChange={(v) => updateConfig({ registry: { ...config.registry, password: v } })}
                placeholder="Your registry.redhat.io password or token"
                type="password"
              />
            </FormField>
          </div>
          <div className="aap-alert aap-alert--info aap-mt-md">
            <span className="aap-alert__icon" aria-hidden><InfoCircleIcon /></span>
            <div className="aap-alert__content">
              <span className="aap-text-sm">
                Don't have credentials? Create a service account at{' '}
                <a href="https://access.redhat.com/terms-based-registry/" target="_blank" rel="noopener noreferrer">
                  access.redhat.com/terms-based-registry
                </a>
              </span>
            </div>
          </div>
        </div>
      )}

      {!isOnline && (
        <div className="aap-card aap-mt-lg">
          <h3 className="aap-card__title">Bundle Location</h3>
          <FormField
            label="Bundle Directory Path"
            helperText="Path to the extracted setup bundle on the target host"
          >
            <TextInput
              value={config.bundle_dir}
              onChange={(v) => updateConfig({ bundle_dir: v })}
              placeholder="/path/to/ansible-automation-platform-containerized-setup-bundle-2.6"
              mono
            />
          </FormField>
        </div>
      )}

      <div className="aap-card aap-mt-lg">
        <FormField
          label="Installation Directory"
          tooltip="Root directory for AAP data, container storage, and config files. Ensure this volume has at least 40 GB free."
        >
          <TextInput
            value={config.install_dir}
            onChange={(v) => updateConfig({ install_dir: v })}
            placeholder="/opt/aap"
            mono
          />
        </FormField>
      </div>

    </div>
  );
}
