import React from 'react';
import { ArrowRightIcon, CheckCircleIcon, HistoryIcon } from '@patternfly/react-icons';
import { UIIcon } from '../components/ProductIcon';
import { getLastSuccessfulDeployment } from '../types';

interface Props {
  onNext: () => void;
  onViewPastDeploy?: () => void;
}

export function WelcomeStep({ onNext, onViewPastDeploy }: Props) {
  const lastDeploy = getLastSuccessfulDeployment();
  return (
    <div className="aap-welcome">
      <div className="aap-welcome__logo">
        <img
          src="./aap-logo-standard.svg"
          alt="Red Hat Ansible Automation Platform"
          style={{ height: 80, width: 'auto' }}
        />
      </div>
      <h2 className="aap-welcome__subheading" style={{ marginTop: 16 }}>Deployment Wizard — Version 2.6</h2>

      <p className="aap-step__description aap-mb-md">
        Deploy AAP on RHEL (containerized) or OpenShift — guided setup in minutes.
      </p>

      <div className="aap-welcome__cta">
        <button
          type="button"
          className="aap-btn aap-btn--primary"
          onClick={onNext}
          aria-label="Get started with the deployment wizard"
        >
          Get started
          <ArrowRightIcon />
        </button>
        {lastDeploy && onViewPastDeploy && (
          <button
            type="button"
            className="aap-btn aap-btn--secondary aap-ml-md"
            onClick={onViewPastDeploy}
            aria-label="View your last deployment"
          >
            <HistoryIcon /> View Last Deployment
          </button>
        )}
      </div>
      {lastDeploy && (
        <div className="aap-card aap-mt-lg" style={{ maxWidth: 480, margin: '24px auto 0' }}>
          <div className="aap-card__header">
            <h3 className="aap-card__title" style={{ fontSize: 14 }}>Previous Deployment</h3>
            <span className="aap-badge aap-badge--success">Active</span>
          </div>
          <dl className="aap-dl" style={{ fontSize: 13 }}>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Host</dt>
              <dd className="aap-dl__value aap-dl__value--mono">{lastDeploy.target_host}</dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Topology</dt>
              <dd className="aap-dl__value">{lastDeploy.topology === 'growth' ? 'Growth (AIO)' : 'Enterprise'}</dd>
            </div>
            <div className="aap-dl__row">
              <dt className="aap-dl__term">Deployed</dt>
              <dd className="aap-dl__value">{new Date(lastDeploy.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="aap-welcome__features">
        <div className="aap-feature-card">
          <div className="aap-feature-card__icon" aria-hidden="true">
            <UIIcon name="settings" size={18} />
          </div>
          <div className="aap-feature-card__title">Guided Setup</div>
          <div className="aap-feature-card__text">
            Smart defaults and real-time validation.
          </div>
        </div>
        <div className="aap-feature-card">
          <div className="aap-feature-card__icon" aria-hidden="true">
            <UIIcon name="checkup" size={18} />
          </div>
          <div className="aap-feature-card__title">Pre-flight Checks</div>
          <div className="aap-feature-card__text">
            Validates requirements before deployment.
          </div>
        </div>
        <div className="aap-feature-card">
          <div className="aap-feature-card__icon" aria-hidden="true">
            <UIIcon name="speedometer" size={18} />
          </div>
          <div className="aap-feature-card__title">Live Progress</div>
          <div className="aap-feature-card__text">
            Streaming logs and phase tracking.
          </div>
        </div>
      </div>

      <div className="aap-welcome__requirements aap-mt-xl">
        <div className="aap-requirements__title">What you&apos;ll need</div>
        <ul className="aap-requirements__list" role="list">
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            Valid AAP subscription
          </li>
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            Red Hat registry credentials (online install)
          </li>
        </ul>
        <div className="aap-requirements__title" style={{ marginTop: 16 }}>Containerized (RHEL)</div>
        <ul className="aap-requirements__list" role="list">
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            RHEL 9.4+ or 10+ with 16 GB RAM, 4 CPUs, 60 GB disk
          </li>
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            Dedicated non-root user with sudo privileges
          </li>
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            FQDN-resolvable hostname(s)
          </li>
        </ul>
        <div className="aap-requirements__title" style={{ marginTop: 16 }}>OpenShift</div>
        <ul className="aap-requirements__list" role="list">
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            OpenShift 4.14+ cluster with cluster-admin access
          </li>
          <li className="aap-requirements__item">
            <CheckCircleIcon aria-hidden="true" />
            AAP Operator available in OperatorHub
          </li>
        </ul>
      </div>
    </div>
  );
}
