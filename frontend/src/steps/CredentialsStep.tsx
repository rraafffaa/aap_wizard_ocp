import React, { useState } from 'react';
import type { DeploymentConfig } from '../types';
import { FormField, TextInput } from '../components/FormField';
import { KeyIcon } from '@patternfly/react-icons';
import { ProductIcon, type ProductName } from '../components/ProductIcon';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export function generatePassword(length = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}

const COMPONENTS = [
  { key: 'gateway' as const, label: 'Platform Gateway', product: 'gateway' as ProductName, desc: 'Gateway admin account' },
  { key: 'controller' as const, label: 'Automation Controller', product: 'controller' as ProductName, desc: 'Controller admin account' },
  { key: 'hub' as const, label: 'Automation Hub', product: 'hub' as ProductName, desc: 'Hub admin account' },
  { key: 'eda' as const, label: 'Event-Driven Ansible', product: 'eda' as ProductName, desc: 'EDA admin account' },
] as const;

export function CredentialsStep({ config, updateConfig }: Props) {
  const [sharedPassword, setSharedPassword] = useState('');

  const applySharedPassword = () => {
    if (sharedPassword) {
      updateConfig({
        gateway: { ...config.gateway, admin_password: sharedPassword },
        controller: { ...config.controller, admin_password: sharedPassword },
        hub: { ...config.hub, admin_password: sharedPassword },
        eda: { ...config.eda, admin_password: sharedPassword },
      });
    }
  };

  const generateAll = () => {
    const gw = generatePassword();
    const ctrl = generatePassword();
    const hub = generatePassword();
    const eda = generatePassword();
    updateConfig({
      gateway: { ...config.gateway, admin_password: gw },
      controller: { ...config.controller, admin_password: ctrl },
      hub: { ...config.hub, admin_password: hub },
      eda: { ...config.eda, admin_password: eda },
    });
  };

  return (
    <div className="aap-step">
      <header className="aap-step__header">
        <h2 className="aap-step__title">Admin Credentials</h2>
      </header>

      <section className="aap-step__section">
        <div className="aap-card">
          <h3 className="aap-card__title">Quick Setup</h3>
          <div className="aap-flex-row">
            <button
              type="button"
              className="aap-btn aap-btn--secondary"
              onClick={generateAll}
              aria-label="Generate unique passwords for each component"
            >
              <KeyIcon aria-hidden />
              Generate passwords
            </button>
            <span className="aap-text-muted aap-text-sm">— or —</span>
            <FormField label="Shared password" required={false}>
              <TextInput
                value={sharedPassword}
                onChange={setSharedPassword}
                placeholder="Enter shared password"
                type="password"
              />
            </FormField>
            <button
              type="button"
              className="aap-btn aap-btn--primary aap-btn--sm"
              onClick={applySharedPassword}
              disabled={!sharedPassword}
              aria-label="Apply shared password to all components"
            >
              Apply to all
            </button>
          </div>
        </div>
      </section>

      {COMPONENTS.map(({ key, label, product, desc }) => (
        <section key={key} className="aap-step__section">
          <div className="aap-card">
            <div className="aap-flex-row aap-mb-md">
              <div className="aap-selection-card__icon" aria-hidden>
                <ProductIcon product={product} size={32} />
              </div>
              <div>
                <div className="aap-selection-card__title">{label}</div>
                <div className="aap-selection-card__description">{desc}</div>
              </div>
            </div>
            <div className="aap-form-row">
              <FormField label="Admin Password" required>
                <TextInput
                  value={config[key].admin_password}
                  onChange={(v) => updateConfig({ [key]: { ...config[key], admin_password: v } })}
                  placeholder={`${label} admin password`}
                  type="password"
                />
              </FormField>
              <button
                type="button"
                className="aap-btn aap-btn--tertiary aap-btn--sm"
                onClick={() =>
                  updateConfig({
                    [key]: { ...config[key], admin_password: generatePassword() },
                  })
                }
                title="Generate random password"
                aria-label={`Generate random password for ${label}`}
              >
                <KeyIcon aria-hidden />
              </button>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
