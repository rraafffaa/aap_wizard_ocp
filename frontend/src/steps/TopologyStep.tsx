import React, { useState } from 'react';
import { CheckIcon } from '@patternfly/react-icons';
import { UIIcon } from '../components/ProductIcon';
import type { DeploymentConfig, Topology } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

export const SIZING = [
  { label: 'Small', users: '1–10', jobs: '< 100/day', hosts: '< 100', rec: 'growth' as Topology, ram: '16 GB', cpu: '4', disk: '60 GB' },
  { label: 'Medium', users: '10–50', jobs: '100–1,000/day', hosts: '100–500', rec: 'growth' as Topology, ram: '32 GB', cpu: '8', disk: '100 GB' },
  { label: 'Large', users: '50–200', jobs: '1,000–10,000/day', hosts: '500–5,000', rec: 'enterprise' as Topology, ram: '16 GB × 6', cpu: '4 × 6', disk: '60 GB × 6' },
  { label: 'X-Large', users: '200+', jobs: '10,000+/day', hosts: '5,000+', rec: 'enterprise' as Topology, ram: '32 GB × 8+', cpu: '8 × 8+', disk: '100 GB × 8+' },
];

export function TopologyStep({ config, updateConfig }: Props) {
  const [showSizing, setShowSizing] = useState(false);

  const setTopology = (t: Topology) => {
    const newConfig: Partial<DeploymentConfig> = { topology: t };
    if (t === 'growth') {
      newConfig.redis_mode = 'standalone';
    }
    updateConfig(newConfig);
  };

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Deployment Topology</h2>
        <p className="aap-step__description">
          Enterprise is recommended for production workloads.
        </p>
      </div>

      <div className="aap-card aap-mb-lg">
        <div className="aap-card__header">
          <div>
            <div className="aap-card__title">Need help choosing?</div>
            <p className="aap-card__description aap-mt-sm">
              Get a recommendation based on your workload size.
            </p>
          </div>
          <button
            type="button"
            className="aap-btn aap-btn--secondary"
            onClick={() => setShowSizing(!showSizing)}
            aria-expanded={showSizing}
            aria-controls="sizing-calculator-table"
          >
            {showSizing ? 'Hide Calculator' : 'Sizing Calculator'}
          </button>
        </div>

        {showSizing && (
          <div id="sizing-calculator-table" className="aap-mt-lg">
            <table className="aap-table">
              <thead>
                <tr>
                  <th>Size</th>
                  <th>Users</th>
                  <th>Jobs/Day</th>
                  <th>Managed Hosts</th>
                  <th>RAM</th>
                  <th>CPUs</th>
                  <th>Topology</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {SIZING.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td>{s.users}</td>
                    <td>{s.jobs}</td>
                    <td>{s.hosts}</td>
                    <td className="aap-text-mono aap-text-sm">{s.ram}</td>
                    <td className="aap-text-mono aap-text-sm">{s.cpu}</td>
                    <td>
                      <span className={s.rec === 'growth' ? 'aap-badge aap-badge--info' : 'aap-badge aap-badge--warning'}>
                        {s.rec === 'growth' ? 'Growth' : 'Enterprise'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`aap-btn aap-btn--sm ${config.topology === s.rec ? 'aap-btn--primary' : 'aap-btn--secondary'}`}
                        onClick={() => setTopology(s.rec)}
                      >
                        {config.topology === s.rec ? (
                          <>
                            <CheckIcon /> Selected
                          </>
                        ) : (
                          'Select'
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aap-selection-grid aap-selection-grid--2col" role="radiogroup" aria-label="Deployment topology">
        <div
          className={`aap-selection-card ${config.topology === 'growth' ? 'aap-selection-card--selected' : ''}`}
          role="radio"
          aria-checked={config.topology === 'growth'}
          tabIndex={0}
          onClick={() => setTopology('growth')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTopology('growth'); } }}
        >
          <div className="aap-selection-card__indicator" aria-hidden="true">
            <CheckIcon />
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <UIIcon name="server" size={24} />
          </div>
          <div className="aap-selection-card__title">Growth (All-in-One)</div>
          <div className="aap-selection-card__description">
            Single host — ideal for dev and small deployments.
          </div>
          <ul className="aap-selection-card__features">
            <li><CheckIcon aria-hidden="true" /> All components on one host</li>
            <li><CheckIcon aria-hidden="true" /> Managed PostgreSQL included</li>
            <li><CheckIcon aria-hidden="true" /> 16 GB RAM / 4 CPUs minimum</li>
          </ul>
        </div>

        <div
          className={`aap-selection-card ${config.topology === 'enterprise' ? 'aap-selection-card--selected' : ''}`}
          role="radio"
          aria-checked={config.topology === 'enterprise'}
          tabIndex={0}
          onClick={() => setTopology('enterprise')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTopology('enterprise'); } }}
        >
          <div className="aap-selection-card__badge">Recommended</div>
          <div className="aap-selection-card__indicator" aria-hidden="true">
            <CheckIcon />
          </div>
          <div className="aap-selection-card__icon" aria-hidden="true">
            <UIIcon name="cluster" size={24} />
          </div>
          <div className="aap-selection-card__title">Enterprise</div>
          <div className="aap-selection-card__description">
            Multi-node with HA and dedicated execution nodes.
          </div>
          <ul className="aap-selection-card__features">
            <li><CheckIcon aria-hidden="true" /> Multi-node redundancy</li>
            <li><CheckIcon aria-hidden="true" /> Dedicated execution & hop nodes</li>
            <li><CheckIcon aria-hidden="true" /> External database + Redis cluster</li>
          </ul>
        </div>
      </div>

      <div className="aap-card aap-mt-lg">
        <div className="aap-card__header">
          <div className="aap-card__title">Topology Comparison</div>
        </div>
        <table className="aap-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Growth</th>
              <th>Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Minimum hosts', '1', '6+'],
              ['Platform Gateway nodes', '1', '2+'],
              ['Automation Controller nodes', '1', '2+'],
              ['Automation Hub nodes', '1', '2+'],
              ['Event-Driven Ansible nodes', '1', '2+'],
              ['Execution nodes', 'Co-located', 'Dedicated'],
              ['Database', 'Managed (co-located)', 'External required'],
              ['Redis', 'Standalone', 'Standalone or Cluster'],
              ['RAM per node', '16 GB (32 for seeding)', '16 GB'],
              ['High availability', 'No', 'Yes'],
            ].map(([feature, growth, enterprise]) => (
              <tr key={feature}>
                <td>{feature}</td>
                <td>{growth}</td>
                <td>{enterprise}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
