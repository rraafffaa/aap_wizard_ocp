import React, { useState } from 'react';
import { ArrowRightIcon, CheckCircleIcon, CheckIcon, HistoryIcon } from '@patternfly/react-icons';
import { UIIcon } from '../components/ProductIcon';
import { getLastSuccessfulDeployment } from '../types';
import type { DeploymentConfig, DeployPlatform } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
  onNext: () => void;
  onViewPastDeploy?: () => void;
}

export function WelcomeStep({ config, updateConfig, onNext, onViewPastDeploy }: Props) {
  const lastDeploy = getLastSuccessfulDeployment();
  const [selected, setSelected] = useState<DeployPlatform | null>(config.platform || null);

  const selectPlatform = (p: DeployPlatform) => {
    setSelected(p);
    updateConfig({ platform: p });
  };

  const handleContinue = () => {
    if (selected) onNext();
  };

  return (
    <div className="aap-welcome">
      <div className="aap-welcome__logo">
        <img
          src="./aap-logo-standard.svg"
          alt="Red Hat Ansible Automation Platform"
          className="aap-welcome__logo-img"
        />
      </div>
      <h2 className="aap-welcome__subheading">Deployment Wizard</h2>
      <p className="aap-welcome__tagline">
        Deploy AAP 2.6 in minutes — select your platform to begin.
      </p>

      {/* Platform Selection Cards */}
      <div className="aap-welcome__cards">
        <fieldset className="aap-selection-group" aria-label="Deployment platform">
          <div className="aap-selection-grid aap-selection-grid--2col">
            <label
              className={`aap-selection-card aap-selection-card--platform ${selected === 'containerized' ? 'aap-selection-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="platform"
                value="containerized"
                checked={selected === 'containerized'}
                onChange={() => selectPlatform('containerized')}
                className="sr-only"
              />
              <div className="aap-selection-card__indicator" aria-hidden="true">
                <CheckIcon />
              </div>
              <div className="aap-selection-card__icon" aria-hidden="true">
                <UIIcon name="server" size={28} />
              </div>
              <div className="aap-selection-card__title">Containerized</div>
              <div className="aap-selection-card__subtitle">RHEL + Podman</div>
              <ul className="aap-selection-card__requirements">
                <li><CheckCircleIcon aria-hidden="true" /> RHEL 9.4+, 16 GB RAM, 4 CPUs</li>
                <li><CheckCircleIcon aria-hidden="true" /> SSH access with sudo privileges</li>
                <li><CheckCircleIcon aria-hidden="true" /> Red Hat registry credentials</li>
              </ul>
            </label>

            <label
              className={`aap-selection-card aap-selection-card--platform ${selected === 'openshift' ? 'aap-selection-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="platform"
                value="openshift"
                checked={selected === 'openshift'}
                onChange={() => selectPlatform('openshift')}
                className="sr-only"
              />
              <div className="aap-selection-card__indicator" aria-hidden="true">
                <CheckIcon />
              </div>
              <div className="aap-selection-card__icon" aria-hidden="true">
                <UIIcon name="cluster" size={28} />
              </div>
              <div className="aap-selection-card__title">OpenShift</div>
              <div className="aap-selection-card__subtitle">Operator-managed</div>
              <ul className="aap-selection-card__requirements">
                <li><CheckCircleIcon aria-hidden="true" /> OpenShift 4.14+ with cluster-admin</li>
                <li><CheckCircleIcon aria-hidden="true" /> AAP Operator in OperatorHub</li>
                <li><CheckCircleIcon aria-hidden="true" /> Bearer token for API access</li>
              </ul>
            </label>
          </div>
        </fieldset>
      </div>

      {/* Action Buttons */}
      <div className="aap-welcome__cta">
        <button
          type="button"
          className="aap-btn aap-btn--primary aap-btn--lg"
          onClick={handleContinue}
          disabled={!selected}
          aria-label="Continue to the deployment wizard"
        >
          Continue
          <ArrowRightIcon />
        </button>
      </div>

      {lastDeploy && onViewPastDeploy && (
        <button
          type="button"
          className="aap-btn aap-btn--link aap-welcome__past-link"
          onClick={onViewPastDeploy}
          aria-label="View your last deployment"
        >
          <HistoryIcon /> View last deployment
        </button>
      )}
    </div>
  );
}
