export interface DiffEntry {
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  path: string[];
  key: string;
  label: string;
  oldValue?: any;
  newValue?: any;
  children?: DiffEntry[];
}

export const CONFIG_PATH_LABELS: Record<string, string> = {
  topology: 'Deployment Topology',
  installation_type: 'Installation Type',
  eula_accepted: 'EULA Accepted',
  dry_run: 'Dry Run Mode',
  redis_mode: 'Redis Mode',
  bundle_dir: 'Bundle Directory',
  install_dir: 'Install Directory',
  target_host: 'Target Host',
  target_user: 'Target User',
  target_password: 'Target Password',
  target_ssh_port: 'Target SSH Port',
  registry: 'Registry Credentials',
  'registry.username': 'Registry Username',
  'registry.password': 'Registry Password',
  database: 'Database Configuration',
  'database.type': 'Database Type',
  'database.host': 'Database Host',
  'database.port': 'Database Port',
  'database.admin_username': 'Database Admin Username',
  'database.admin_password': 'Database Admin Password',
  gateway: 'Gateway Configuration',
  'gateway.hosts': 'Gateway Hosts',
  'gateway.admin_password': 'Gateway Admin Password',
  'gateway.pg_host': 'Gateway PostgreSQL Host',
  'gateway.pg_database': 'Gateway Database Name',
  'gateway.pg_username': 'Gateway Database Username',
  'gateway.pg_password': 'Gateway Database Password',
  controller: 'Automation Controller',
  'controller.hosts': 'Controller Hosts',
  'controller.admin_password': 'Controller Admin Password',
  'controller.pg_host': 'Controller PostgreSQL Host',
  'controller.pg_database': 'Controller Database Name',
  'controller.pg_username': 'Controller Database Username',
  'controller.pg_password': 'Controller Database Password',
  'controller.percent_memory_capacity': 'Controller Memory Capacity %',
  hub: 'Automation Hub',
  'hub.hosts': 'Hub Hosts',
  'hub.admin_password': 'Hub Admin Password',
  'hub.pg_host': 'Hub PostgreSQL Host',
  'hub.pg_database': 'Hub Database Name',
  'hub.pg_username': 'Hub Database Username',
  'hub.pg_password': 'Hub Database Password',
  'hub.seed_collections': 'Seed Collections',
  eda: 'Event-Driven Ansible',
  'eda.hosts': 'EDA Hosts',
  'eda.admin_password': 'EDA Admin Password',
  'eda.pg_host': 'EDA PostgreSQL Host',
  'eda.pg_database': 'EDA Database Name',
  'eda.pg_username': 'EDA Database Username',
  'eda.pg_password': 'EDA Database Password',
  'eda.safe_plugins': 'EDA Safe Plugins',
  execution_nodes: 'Execution Nodes',
  hosts: 'Host Inventory',
  network: 'Network Configuration',
  'network.http_port': 'HTTP Port',
  'network.https_port': 'HTTPS Port',
  'network.receptor_port': 'Receptor Port',
  'network.tls': 'TLS Configuration',
  'network.tls.custom_ca_cert': 'Custom CA Certificate',
  'network.tls.custom_server_cert': 'Custom Server Certificate',
  'network.tls.custom_server_key': 'Custom Server Key',
  'network.tls.disable_https': 'Disable HTTPS',
};

function resolveLabel(path: string[], pathLabels?: Record<string, string>): string {
  const fullPath = path.join('.');
  const labels = pathLabels ?? CONFIG_PATH_LABELS;

  if (labels[fullPath]) return labels[fullPath];

  const key = path[path.length - 1];
  if (!key) return '';
  if (labels[key]) return labels[key];

  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isPlainObject(val: any): val is Record<string, any> {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date);
}

function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (isPlainObject(a[i]) && isPlainObject(b[i])) {
      const diff = computeDiff(a[i], b[i]);
      if (diff.some((d) => d.type !== 'unchanged')) return false;
    } else if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function computeDiff(
  oldObj: any,
  newObj: any,
  pathLabels?: Record<string, string>,
  currentPath: string[] = [],
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (oldObj === undefined && newObj === undefined) return entries;

  if (!isPlainObject(oldObj) && !isPlainObject(newObj)) {
    const key = currentPath[currentPath.length - 1] || '';
    const label = resolveLabel(currentPath, pathLabels);

    if (Array.isArray(oldObj) && Array.isArray(newObj)) {
      if (arraysEqual(oldObj, newObj)) {
        entries.push({ type: 'unchanged', path: currentPath, key, label, oldValue: oldObj, newValue: newObj });
      } else {
        entries.push({ type: 'changed', path: currentPath, key, label, oldValue: oldObj, newValue: newObj });
      }
    } else if (oldObj === newObj) {
      entries.push({ type: 'unchanged', path: currentPath, key, label, oldValue: oldObj, newValue: newObj });
    } else if (oldObj === undefined) {
      entries.push({ type: 'added', path: currentPath, key, label, newValue: newObj });
    } else if (newObj === undefined) {
      entries.push({ type: 'removed', path: currentPath, key, label, oldValue: oldObj });
    } else {
      entries.push({ type: 'changed', path: currentPath, key, label, oldValue: oldObj, newValue: newObj });
    }
    return entries;
  }

  if (isPlainObject(oldObj) && !isPlainObject(newObj)) {
    const key = currentPath[currentPath.length - 1] || '';
    entries.push({
      type: 'changed',
      path: currentPath,
      key,
      label: resolveLabel(currentPath, pathLabels),
      oldValue: oldObj,
      newValue: newObj,
    });
    return entries;
  }

  if (!isPlainObject(oldObj) && isPlainObject(newObj)) {
    const key = currentPath[currentPath.length - 1] || '';
    entries.push({
      type: 'changed',
      path: currentPath,
      key,
      label: resolveLabel(currentPath, pathLabels),
      oldValue: oldObj,
      newValue: newObj,
    });
    return entries;
  }

  const allKeys = new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})]);
  const key = currentPath[currentPath.length - 1] || 'root';
  const label = resolveLabel(currentPath, pathLabels);
  const children: DiffEntry[] = [];

  for (const k of allKeys) {
    const childPath = [...currentPath, k];
    const oldVal = oldObj?.[k];
    const newVal = newObj?.[k];

    if (isPlainObject(oldVal) || isPlainObject(newVal)) {
      children.push(...computeDiff(oldVal, newVal, pathLabels, childPath));
    } else if (Array.isArray(oldVal) || Array.isArray(newVal)) {
      const childLabel = resolveLabel(childPath, pathLabels);
      const aArr = oldVal ?? [];
      const bArr = newVal ?? [];
      if (arraysEqual(aArr, bArr)) {
        children.push({ type: 'unchanged', path: childPath, key: k, label: childLabel, oldValue: oldVal, newValue: newVal });
      } else if (oldVal === undefined) {
        children.push({ type: 'added', path: childPath, key: k, label: childLabel, newValue: newVal });
      } else if (newVal === undefined) {
        children.push({ type: 'removed', path: childPath, key: k, label: childLabel, oldValue: oldVal });
      } else {
        children.push({ type: 'changed', path: childPath, key: k, label: childLabel, oldValue: oldVal, newValue: newVal });
      }
    } else if (oldVal === undefined) {
      children.push({ type: 'added', path: childPath, key: k, label: resolveLabel(childPath, pathLabels), newValue: newVal });
    } else if (newVal === undefined) {
      children.push({ type: 'removed', path: childPath, key: k, label: resolveLabel(childPath, pathLabels), oldValue: oldVal });
    } else if (oldVal === newVal) {
      children.push({ type: 'unchanged', path: childPath, key: k, label: resolveLabel(childPath, pathLabels), oldValue: oldVal, newValue: newVal });
    } else {
      children.push({ type: 'changed', path: childPath, key: k, label: resolveLabel(childPath, pathLabels), oldValue: oldVal, newValue: newVal });
    }
  }

  if (currentPath.length === 0) {
    return children;
  }

  entries.push({ type: children.every((c) => c.type === 'unchanged') ? 'unchanged' : 'changed', path: currentPath, key, label, children });
  return entries;
}

export function flattenDiff(entries: DiffEntry[]): DiffEntry[] {
  const flat: DiffEntry[] = [];

  function walk(items: DiffEntry[]): void {
    for (const entry of items) {
      if (entry.children && entry.children.length > 0) {
        walk(entry.children);
      } else {
        flat.push(entry);
      }
    }
  }

  walk(entries);
  return flat;
}

export function filterDiff(entries: DiffEntry[], types: DiffEntry['type'][]): DiffEntry[] {
  const typeSet = new Set(types);

  function walkFilter(items: DiffEntry[]): DiffEntry[] {
    const result: DiffEntry[] = [];
    for (const entry of items) {
      if (entry.children) {
        const filteredChildren = walkFilter(entry.children);
        if (filteredChildren.length > 0) {
          result.push({ ...entry, children: filteredChildren });
        }
      } else if (typeSet.has(entry.type)) {
        result.push(entry);
      }
    }
    return result;
  }

  return walkFilter(entries);
}

function formatDisplayValue(val: any): string {
  if (val === null || val === undefined) return '(empty)';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) return val.length === 0 ? '(none)' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function diffToText(entries: DiffEntry[]): string {
  const lines: string[] = [];
  const flat = flattenDiff(entries).filter((e) => e.type !== 'unchanged');

  for (const entry of flat) {
    switch (entry.type) {
      case 'added':
        lines.push(`+ ${entry.label}: ${formatDisplayValue(entry.newValue)}`);
        break;
      case 'removed':
        lines.push(`- ${entry.label}: ${formatDisplayValue(entry.oldValue)}`);
        break;
      case 'changed':
        lines.push(`~ ${entry.label}: ${formatDisplayValue(entry.oldValue)} → ${formatDisplayValue(entry.newValue)}`);
        break;
    }
  }

  return lines.length === 0 ? 'No changes' : lines.join('\n');
}

export function diffToHTML(entries: DiffEntry[]): string {
  const flat = flattenDiff(entries).filter((e) => e.type !== 'unchanged');
  if (flat.length === 0) return '<p>No changes</p>';

  const lines: string[] = ['<ul class="diff-list">'];

  for (const entry of flat) {
    const cls = `diff-${entry.type}`;
    switch (entry.type) {
      case 'added':
        lines.push(`  <li class="${cls}"><strong>${esc(entry.label)}</strong>: <ins>${esc(formatDisplayValue(entry.newValue))}</ins></li>`);
        break;
      case 'removed':
        lines.push(`  <li class="${cls}"><strong>${esc(entry.label)}</strong>: <del>${esc(formatDisplayValue(entry.oldValue))}</del></li>`);
        break;
      case 'changed':
        lines.push(`  <li class="${cls}"><strong>${esc(entry.label)}</strong>: <del>${esc(formatDisplayValue(entry.oldValue))}</del> → <ins>${esc(formatDisplayValue(entry.newValue))}</ins></li>`);
        break;
    }
  }

  lines.push('</ul>');
  return lines.join('\n');
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function countChanges(entries: DiffEntry[]): { added: number; removed: number; changed: number } {
  const flat = flattenDiff(entries);
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const entry of flat) {
    if (entry.type === 'added') added++;
    else if (entry.type === 'removed') removed++;
    else if (entry.type === 'changed') changed++;
  }

  return { added, removed, changed };
}

export function hasMeaningfulChanges(entries: DiffEntry[]): boolean {
  const { added, removed, changed } = countChanges(entries);
  return added + removed + changed > 0;
}
