import React from 'react';
import type { DeploymentConfig } from '../types';

interface Node {
  id: string;
  type: string;
  hostname: string;
  x: number;
  y: number;
}

interface Connection {
  from: string;
  to: string;
  type: 'primary' | 'database' | 'redis' | 'receptor';
}

interface LayoutResult {
  nodes: Node[];
  connections: Connection[];
}

export function layoutNodes(config: DeploymentConfig): LayoutResult {
  const nodes: Node[] = [];
  const connections: Connection[] = [];

  nodes.push({ id: 'user', type: 'user', hostname: 'User', x: 0, y: 0 });

  if (config.topology === 'growth') {
    const host = config.gateway.hosts[0] || 'localhost';
    nodes.push({ id: 'aio', type: 'gateway', hostname: host, x: 200, y: 0 });
    nodes.push({ id: 'db', type: 'database', hostname: 'PostgreSQL', x: 400, y: 0 });
    nodes.push({ id: 'redis', type: 'redis', hostname: 'Redis', x: 400, y: 100 });
    connections.push({ from: 'user', to: 'aio', type: 'primary' });
    connections.push({ from: 'aio', to: 'db', type: 'database' });
    connections.push({ from: 'aio', to: 'redis', type: 'redis' });
  } else {
    if (config.gateway.hosts.length > 1) {
      nodes.push({ id: 'lb', type: 'loadbalancer', hostname: 'Load Balancer', x: 100, y: 0 });
      connections.push({ from: 'user', to: 'lb', type: 'primary' });
    }

    config.gateway.hosts.forEach((h, i) => {
      const id = `gw-${i}`;
      nodes.push({ id, type: 'gateway', hostname: h, x: 200, y: i * 80 });
      const from = config.gateway.hosts.length > 1 ? 'lb' : 'user';
      connections.push({ from, to: id, type: 'primary' });
    });

    config.controller.hosts.forEach((h, i) => {
      const id = `ctrl-${i}`;
      nodes.push({ id, type: 'controller', hostname: h, x: 400, y: i * 80 });
      connections.push({ from: `gw-${Math.min(i, config.gateway.hosts.length - 1)}`, to: id, type: 'primary' });
    });

    config.hub.hosts.forEach((h, i) => {
      nodes.push({ id: `hub-${i}`, type: 'hub', hostname: h, x: 600, y: i * 80 });
    });

    config.eda.hosts.forEach((h, i) => {
      nodes.push({ id: `eda-${i}`, type: 'eda', hostname: h, x: 600, y: (config.hub.hosts.length + i) * 80 });
    });

    (config.execution_nodes || []).forEach((n, i) => {
      nodes.push({ id: `exec-${i}`, type: n.receptor_type || 'execution', hostname: n.host, x: 800, y: i * 80 });
    });

    nodes.push({ id: 'db', type: 'database', hostname: config.database.host || 'PostgreSQL', x: 400, y: 300 });
    nodes.push({ id: 'redis', type: 'redis', hostname: 'Redis', x: 600, y: 300 });
    connections.push({ from: 'gw-0', to: 'db', type: 'database' });
    connections.push({ from: 'gw-0', to: 'redis', type: 'redis' });
  }

  return { nodes, connections };
}

interface TopologyDiagramProps {
  config: DeploymentConfig;
}

export function TopologyDiagram({ config }: TopologyDiagramProps) {
  const { nodes, connections } = layoutNodes(config);
  const label = config.topology === 'growth' ? 'Growth topology' : 'Enterprise topology';

  return (
    <div role="img" aria-label={label} className="aap-topology-diagram">
      <svg width="100%" height="400" viewBox="0 0 900 400">
        {connections.map((c, i) => {
          const from = nodes.find((n) => n.id === c.from);
          const to = nodes.find((n) => n.id === c.to);
          if (!from || !to) return null;
          return <line key={i} x1={from.x} y1={from.y + 20} x2={to.x} y2={to.y + 20} stroke="#6a6e73" />;
        })}
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
            <rect width="80" height="40" rx="4" fill="#151515" stroke="#6a6e73" />
            <text x="40" y="24" textAnchor="middle" fill="#fff" fontSize="10">{n.hostname.slice(0, 12)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
