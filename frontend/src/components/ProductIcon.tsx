import React from 'react';

export type ProductName =
  | 'controller'
  | 'hub'
  | 'eda'
  | 'gateway'
  | 'lightspeed'
  | 'mesh'
  | 'ee'
  | 'collections'
  | 'playbooks'
  | 'rhel'
  | 'rulebook'
  | 'ansible-core'
  | 'redhat-hat';

const PRODUCT_LABELS: Record<ProductName, string> = {
  controller: 'Automation Controller',
  hub: 'Automation Hub',
  eda: 'Event-Driven Ansible',
  gateway: 'Platform Gateway',
  lightspeed: 'Ansible Lightspeed',
  mesh: 'Automation Mesh',
  ee: 'Execution Environment',
  collections: 'Content Collections',
  playbooks: 'Ansible Playbooks',
  rhel: 'Red Hat Enterprise Linux',
  rulebook: 'Ansible Rulebook',
  'ansible-core': 'ansible-core',
  'redhat-hat': 'Red Hat',
};

interface Props {
  product: ProductName;
  size?: number;
  className?: string;
}

export function ProductIcon({ product, size = 36, className }: Props) {
  return (
    <img
      src={`/icons/${product}.svg`}
      alt={PRODUCT_LABELS[product]}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

export type UIIconName =
  | 'topology'
  | 'server'
  | 'cluster'
  | 'security'
  | 'automation'
  | 'check-circle-fill'
  | 'warning-fill'
  | 'database-fill'
  | 'settings'
  | 'cloud-download'
  | 'search'
  | 'notification'
  | 'running'
  | 'pending'
  | 'checkup'
  | 'speedometer'
  | 'package'
  | 'connected';

interface UIIconProps {
  name: UIIconName;
  size?: number;
  className?: string;
}

export function UIIcon({ name, size = 20, className }: UIIconProps) {
  return (
    <img
      src={`/icons/ui/${name}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
      role="presentation"
    />
  );
}
