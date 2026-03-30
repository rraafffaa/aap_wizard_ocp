/**
 * AAP 2.6 Infrastructure Sizing Calculator
 *
 * Pure calculation functions ported from the COP (Community of Practice)
 * sizing spreadsheet. These compute node counts, resource requirements,
 * and fork capacity for AAP deployments on containerized (RHEL) and OCP.
 *
 * References:
 * - COP fork capacity formulas: memCap = floor(((RAM - overhead) * 1024) / memPerFork)
 * - Node t-shirt sizes: standard(16/4), medium(32/8), large(64/16), xl(128/32)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SizingInput {
  /** Total managed hosts */
  managedHosts: number;
  /** Concurrent forks per job (default 50) */
  forks: number;
  /** Average job duration in minutes (default 10) */
  avgJobDuration: number;
  /** Jobs per hour target */
  jobsPerHour: number;
  /** Burst multiplier (e.g. 1.5 = 50% burst headroom) */
  burstMultiplier: number;
  /** Installer type: 'containerized' | 'openshift' | 'rpm' */
  installer: 'containerized' | 'openshift' | 'rpm';
  /** Enable EDA (Event-Driven Ansible) */
  edaEnabled: boolean;
  /** EDA rulebook activations */
  edaActivations: number;
  /** Enable external database */
  externalDB: boolean;
  /** Enable HA (multiple controller/gateway nodes) */
  haEnabled: boolean;
}

export interface NodeSize {
  label: string;
  ram: number;   // GB
  cpu: number;   // vCPUs
}

export interface ForkCapacity {
  memoryBased: number;
  cpuBased: number;
  effective: number;
}

export interface NodeSizing {
  executionNodes: number;
  controllerNodes: number;
  gatewayNodes: number;
  edaNodes: number;
  dbNodes: number;
  hubNodes: number;
  totalNodes: number;
  nodeSize: NodeSize;
  forkCapacityPerNode: ForkCapacity;
  totalForkCapacity: number;
}

export interface StorageSizing {
  dbStorageGB: number;
  hubEEStorageGB: number;
  logStorageGB: number;
  totalStorageGB: number;
}

export interface OCPSizing {
  workerNodes: number;
  workerRAM: number;
  workerCPU: number;
  controllerPods: number;
  executionPods: number;
  gatewayPods: number;
  hubPods: number;
  edaPods: number;
  dbPods: number;
  totalPods: number;
}

export interface SizingResult {
  input: SizingInput;
  nodes: NodeSizing;
  storage: StorageSizing;
  ocp?: OCPSizing;
  burstCapacity: NodeSizing;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Constants — COP Reference Values
// ---------------------------------------------------------------------------

export const NODE_SIZES: NodeSize[] = [
  { label: 'Standard', ram: 16, cpu: 4 },
  { label: 'Medium',   ram: 32, cpu: 8 },
  { label: 'Large',    ram: 64, cpu: 16 },
  { label: 'XL',       ram: 128, cpu: 32 },
];

/** Memory per fork in MB (COP default) */
const MEM_PER_FORK = 100;

/** Forks per CPU core (COP default) */
const FORKS_PER_CPU = 4;

/** Controller overhead RAM in GB */
const CONTROLLER_OVERHEAD_GB = 4;

/** Execution node overhead RAM in GB */
const EXECUTION_OVERHEAD_GB = 2;

/** EDA activation memory in MB */
const EDA_ACTIVATION_MEM_MB = 256;

/** EDA overhead RAM in GB */
const EDA_OVERHEAD_GB = 4;

/** Minimum nodes per role for HA */
const HA_MIN_NODES = 2;

// ---------------------------------------------------------------------------
// Core Calculations
// ---------------------------------------------------------------------------

/**
 * Calculate fork capacity for a given node size.
 * Uses the COP formula: min(memCap, cpuCap)
 * memCap = floor(((RAM - overhead) * 1024) / memPerFork)
 * cpuCap = CPU * forksPerCPU
 */
export function calcForkCapacity(
  ram: number,
  cpu: number,
  overheadGB: number = EXECUTION_OVERHEAD_GB,
): ForkCapacity {
  const memoryBased = Math.floor(((ram - overheadGB) * 1024) / MEM_PER_FORK);
  const cpuBased = cpu * FORKS_PER_CPU;
  return {
    memoryBased,
    cpuBased,
    effective: Math.min(memoryBased, cpuBased),
  };
}

/**
 * Calculate required execution nodes based on workload.
 */
export function calcExecutionNodes(
  jobsPerHour: number,
  forks: number,
  avgJobDurationMin: number,
  forkCapPerNode: number,
): number {
  if (forkCapPerNode <= 0) return 1;
  // How many concurrent jobs can run on one node
  const jobsPerNode = Math.floor(forkCapPerNode / forks) || 1;
  // How many job slots per hour per node
  const slotsPerHour = jobsPerNode * (60 / avgJobDurationMin);
  // Nodes needed
  return Math.max(1, Math.ceil(jobsPerHour / slotsPerHour));
}

/**
 * Calculate EDA node count based on rulebook activations.
 */
export function calcEDANodes(
  activations: number,
  nodeSize: NodeSize,
): number {
  if (activations <= 0) return 0;
  const availableMB = (nodeSize.ram - EDA_OVERHEAD_GB) * 1024;
  const activationsPerNode = Math.floor(availableMB / EDA_ACTIVATION_MEM_MB);
  return Math.max(1, Math.ceil(activations / activationsPerNode));
}

/**
 * Calculate storage requirements.
 */
export function calcStorage(managedHosts: number, externalDB: boolean): StorageSizing {
  // DB: ~40GB base + 0.5MB per host for facts cache
  const dbStorageGB = Math.max(40, Math.ceil(40 + (managedHosts * 0.5) / 1024));
  // Hub EE storage: ~60GB base for images
  const hubEEStorageGB = 60;
  // Logs: ~20GB base + scaling with host count
  const logStorageGB = Math.max(20, Math.ceil(20 + managedHosts / 500));
  return {
    dbStorageGB,
    hubEEStorageGB,
    logStorageGB,
    totalStorageGB: dbStorageGB + hubEEStorageGB + logStorageGB,
  };
}

/**
 * Select the optimal node size for a given workload.
 * Picks the smallest size that can handle at least the requested forks.
 */
export function selectNodeSize(forks: number): NodeSize {
  for (const size of NODE_SIZES) {
    const cap = calcForkCapacity(size.ram, size.cpu);
    if (cap.effective >= forks) return size;
  }
  return NODE_SIZES[NODE_SIZES.length - 1]; // XL fallback
}

// ---------------------------------------------------------------------------
// Main Sizing Function
// ---------------------------------------------------------------------------

/**
 * Calculate full infrastructure sizing for an AAP deployment.
 */
export function calculateSizing(input: SizingInput): SizingResult {
  const nodeSize = selectNodeSize(input.forks);
  const forkCap = calcForkCapacity(nodeSize.ram, nodeSize.cpu);

  // Execution nodes
  const execNodes = calcExecutionNodes(
    input.jobsPerHour,
    input.forks,
    input.avgJobDuration,
    forkCap.effective,
  );

  // Controller nodes (1 per 500 managed hosts, min 1)
  const controllerNodes = input.haEnabled
    ? Math.max(HA_MIN_NODES, Math.ceil(input.managedHosts / 500))
    : Math.max(1, Math.ceil(input.managedHosts / 1000));

  // Gateway nodes
  const gatewayNodes = input.haEnabled ? HA_MIN_NODES : 1;

  // EDA nodes
  const edaNodes = input.edaEnabled
    ? calcEDANodes(input.edaActivations, nodeSize)
    : 0;

  // DB nodes (0 if external, 1 or 2 for HA)
  const dbNodes = input.externalDB ? 0 : (input.haEnabled ? HA_MIN_NODES : 1);

  // Hub nodes
  const hubNodes = input.haEnabled ? HA_MIN_NODES : 1;

  const totalNodes = execNodes + controllerNodes + gatewayNodes + edaNodes + dbNodes + hubNodes;

  const nodes: NodeSizing = {
    executionNodes: execNodes,
    controllerNodes,
    gatewayNodes,
    edaNodes,
    dbNodes,
    hubNodes,
    totalNodes,
    nodeSize,
    forkCapacityPerNode: forkCap,
    totalForkCapacity: execNodes * forkCap.effective,
  };

  // Burst capacity
  const burstExecNodes = Math.ceil(execNodes * input.burstMultiplier);
  const burstCapacity: NodeSizing = {
    ...nodes,
    executionNodes: burstExecNodes,
    totalNodes: burstExecNodes + controllerNodes + gatewayNodes + edaNodes + dbNodes + hubNodes,
    totalForkCapacity: burstExecNodes * forkCap.effective,
  };

  // Storage
  const storage = calcStorage(input.managedHosts, input.externalDB);

  // OCP-specific sizing
  let ocp: OCPSizing | undefined;
  if (input.installer === 'openshift') {
    ocp = calcOCPSizing(nodes, nodeSize);
  }

  // Recommendations
  const recommendations = generateRecommendations(input, nodes, storage);

  return { input, nodes, storage, ocp, burstCapacity, recommendations };
}

// ---------------------------------------------------------------------------
// OCP Sizing
// ---------------------------------------------------------------------------

function calcOCPSizing(nodes: NodeSizing, nodeSize: NodeSize): OCPSizing {
  // Pod counts map 1:1 to node counts for each role
  const controllerPods = nodes.controllerNodes;
  const executionPods = nodes.executionNodes;
  const gatewayPods = nodes.gatewayNodes;
  const hubPods = nodes.hubNodes;
  const edaPods = nodes.edaNodes;
  const dbPods = nodes.dbNodes;
  const totalPods = controllerPods + executionPods + gatewayPods + hubPods + edaPods + dbPods;

  // Worker node sizing — fit pods onto OCP workers
  // Each worker: 64GB RAM, 16 vCPU (recommended OCP worker size)
  const workerRAM = 64;
  const workerCPU = 16;
  const podsPerWorker = Math.floor(workerRAM / nodeSize.ram) || 1;
  const workerNodes = Math.max(3, Math.ceil(totalPods / podsPerWorker)); // min 3 for HA

  return {
    workerNodes,
    workerRAM,
    workerCPU,
    controllerPods,
    executionPods,
    gatewayPods,
    hubPods,
    edaPods,
    dbPods,
    totalPods,
  };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function generateRecommendations(
  input: SizingInput,
  nodes: NodeSizing,
  storage: StorageSizing,
): string[] {
  const recs: string[] = [];

  if (input.managedHosts > 5000 && !input.haEnabled) {
    recs.push('Consider enabling HA for deployments managing over 5,000 hosts.');
  }

  if (input.managedHosts > 10000) {
    recs.push('For 10,000+ hosts, use external PostgreSQL with streaming replication.');
  }

  if (nodes.executionNodes > 5) {
    recs.push('With many execution nodes, consider mesh topology for better distribution.');
  }

  if (input.forks > 100) {
    recs.push('High fork counts increase memory pressure — monitor execution node memory usage.');
  }

  if (!input.externalDB && storage.dbStorageGB > 100) {
    recs.push('Database storage exceeds 100GB — consider external PostgreSQL for better I/O performance.');
  }

  if (input.installer === 'openshift' && !input.haEnabled) {
    recs.push('OpenShift deployments benefit significantly from HA — consider enabling it.');
  }

  if (input.edaEnabled && input.edaActivations > 50) {
    recs.push('Large rulebook activation counts may require dedicated EDA worker nodes.');
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Comparison across all node sizes
// ---------------------------------------------------------------------------

/**
 * Calculate sizing for all node t-shirt sizes for comparison.
 */
export function calcAllNodeSizes(input: SizingInput): Array<{
  nodeSize: NodeSize;
  forkCapacity: ForkCapacity;
  executionNodes: number;
  totalNodes: number;
}> {
  return NODE_SIZES.map(size => {
    const forkCap = calcForkCapacity(size.ram, size.cpu);
    const execNodes = calcExecutionNodes(
      input.jobsPerHour,
      input.forks,
      input.avgJobDuration,
      forkCap.effective,
    );
    const controllerNodes = input.haEnabled
      ? Math.max(HA_MIN_NODES, Math.ceil(input.managedHosts / 500))
      : Math.max(1, Math.ceil(input.managedHosts / 1000));
    const gatewayNodes = input.haEnabled ? HA_MIN_NODES : 1;
    const hubNodes = input.haEnabled ? HA_MIN_NODES : 1;
    const dbNodes = input.externalDB ? 0 : (input.haEnabled ? HA_MIN_NODES : 1);
    const edaNodes = input.edaEnabled ? calcEDANodes(input.edaActivations, size) : 0;

    return {
      nodeSize: size,
      forkCapacity: forkCap,
      executionNodes: execNodes,
      totalNodes: execNodes + controllerNodes + gatewayNodes + hubNodes + dbNodes + edaNodes,
    };
  });
}

// ---------------------------------------------------------------------------
// Default input
// ---------------------------------------------------------------------------

export function getDefaultSizingInput(): SizingInput {
  return {
    managedHosts: 100,
    forks: 50,
    avgJobDuration: 10,
    jobsPerHour: 10,
    burstMultiplier: 1.5,
    installer: 'containerized',
    edaEnabled: false,
    edaActivations: 0,
    externalDB: false,
    haEnabled: false,
  };
}
