import { describe, it, expect } from 'vitest';
import {
  computeDiff,
  flattenDiff,
  filterDiff,
  diffToText,
  countChanges,
  hasMeaningfulChanges,
  CONFIG_PATH_LABELS,
} from '../utils/diffEngine';
import type { DiffEntry } from '../utils/diffEngine';

// ---------------------------------------------------------------------------
// CONFIG_PATH_LABELS
// ---------------------------------------------------------------------------
describe('CONFIG_PATH_LABELS', () => {
  it('is a non-empty record', () => {
    expect(Object.keys(CONFIG_PATH_LABELS).length).toBeGreaterThan(0);
  });

  it('contains core top-level paths', () => {
    expect(CONFIG_PATH_LABELS['topology']).toBe('Deployment Topology');
    expect(CONFIG_PATH_LABELS['installation_type']).toBe('Installation Type');
    expect(CONFIG_PATH_LABELS['eula_accepted']).toBe('EULA Accepted');
    expect(CONFIG_PATH_LABELS['redis_mode']).toBe('Redis Mode');
  });

  it('contains registry paths', () => {
    expect(CONFIG_PATH_LABELS['registry.username']).toBe('Registry Username');
    expect(CONFIG_PATH_LABELS['registry.password']).toBe('Registry Password');
  });

  it('contains database paths', () => {
    expect(CONFIG_PATH_LABELS['database.type']).toBe('Database Type');
    expect(CONFIG_PATH_LABELS['database.host']).toBe('Database Host');
    expect(CONFIG_PATH_LABELS['database.port']).toBe('Database Port');
  });

  it('contains gateway paths', () => {
    expect(CONFIG_PATH_LABELS['gateway.hosts']).toBe('Gateway Hosts');
    expect(CONFIG_PATH_LABELS['gateway.admin_password']).toBe('Gateway Admin Password');
    expect(CONFIG_PATH_LABELS['gateway.pg_host']).toBe('Gateway PostgreSQL Host');
  });

  it('contains controller paths', () => {
    expect(CONFIG_PATH_LABELS['controller.hosts']).toBe('Controller Hosts');
    expect(CONFIG_PATH_LABELS['controller.percent_memory_capacity']).toBe('Controller Memory Capacity %');
  });

  it('contains hub paths', () => {
    expect(CONFIG_PATH_LABELS['hub.hosts']).toBe('Hub Hosts');
    expect(CONFIG_PATH_LABELS['hub.seed_collections']).toBe('Seed Collections');
  });

  it('contains eda paths', () => {
    expect(CONFIG_PATH_LABELS['eda.hosts']).toBe('EDA Hosts');
    expect(CONFIG_PATH_LABELS['eda.safe_plugins']).toBe('EDA Safe Plugins');
  });

  it('contains network/TLS paths', () => {
    expect(CONFIG_PATH_LABELS['network.http_port']).toBe('HTTP Port');
    expect(CONFIG_PATH_LABELS['network.https_port']).toBe('HTTPS Port');
    expect(CONFIG_PATH_LABELS['network.tls.disable_https']).toBe('Disable HTTPS');
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(CONFIG_PATH_LABELS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// computeDiff — simple flat objects
// ---------------------------------------------------------------------------
describe('computeDiff', () => {
  it('returns empty for identical objects', () => {
    const obj = { a: 1, b: 'hello' };
    const diff = computeDiff(obj, obj);
    const flat = flattenDiff(diff);
    expect(flat.every((e) => e.type === 'unchanged')).toBe(true);
  });

  it('detects a changed primitive field', () => {
    const old = { name: 'alpha' };
    const now = { name: 'beta' };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const changed = flat.find((e) => e.key === 'name');
    expect(changed?.type).toBe('changed');
    expect(changed?.oldValue).toBe('alpha');
    expect(changed?.newValue).toBe('beta');
  });

  it('detects an added field', () => {
    const old = { a: 1 };
    const now = { a: 1, b: 2 };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const added = flat.find((e) => e.key === 'b');
    expect(added?.type).toBe('added');
    expect(added?.newValue).toBe(2);
  });

  it('detects a removed field', () => {
    const old = { a: 1, b: 2 };
    const now = { a: 1 };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const removed = flat.find((e) => e.key === 'b');
    expect(removed?.type).toBe('removed');
    expect(removed?.oldValue).toBe(2);
  });

  it('detects no changes when objects are equal', () => {
    const a = { x: 1, y: 'two' };
    const b = { x: 1, y: 'two' };
    const diff = computeDiff(a, b);
    expect(hasMeaningfulChanges(diff)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — nested objects
// ---------------------------------------------------------------------------
describe('computeDiff — nested', () => {
  it('detects changes in nested object', () => {
    const old = { config: { port: 80 } };
    const now = { config: { port: 443 } };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const portDiff = flat.find((e) => e.key === 'port');
    expect(portDiff?.type).toBe('changed');
    expect(portDiff?.oldValue).toBe(80);
    expect(portDiff?.newValue).toBe(443);
  });

  it('detects added nested field', () => {
    const old = { config: { a: 1 } };
    const now = { config: { a: 1, b: 2 } };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    expect(flat.some((e) => e.key === 'b' && e.type === 'added')).toBe(true);
  });

  it('detects deeply nested changes', () => {
    const old = { level1: { level2: { level3: 'old' } } };
    const now = { level1: { level2: { level3: 'new' } } };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const deep = flat.find((e) => e.key === 'level3');
    expect(deep?.type).toBe('changed');
  });

  it('preserves path information', () => {
    const old = { db: { host: 'old.com' } };
    const now = { db: { host: 'new.com' } };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const hostDiff = flat.find((e) => e.key === 'host');
    expect(hostDiff?.path).toEqual(['db', 'host']);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — arrays
// ---------------------------------------------------------------------------
describe('computeDiff — arrays', () => {
  it('detects array changes', () => {
    const old = { items: [1, 2, 3] };
    const now = { items: [1, 2, 4] };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    expect(flat.some((e) => e.key === 'items' && e.type === 'changed')).toBe(true);
  });

  it('treats identical arrays as unchanged', () => {
    const old = { items: ['a', 'b'] };
    const now = { items: ['a', 'b'] };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    const itemsDiff = flat.find((e) => e.key === 'items');
    expect(itemsDiff?.type).toBe('unchanged');
  });

  it('detects array length changes', () => {
    const old = { items: [1, 2] };
    const now = { items: [1, 2, 3] };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    expect(flat.some((e) => e.key === 'items' && e.type === 'changed')).toBe(true);
  });

  it('detects added array field', () => {
    const old = { a: 1 };
    const now = { a: 1, items: [1, 2] };
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    expect(flat.some((e) => e.key === 'items' && e.type === 'added')).toBe(true);
  });

  it('detects removed array field', () => {
    const old = { items: [1, 2] };
    const now = {};
    const diff = computeDiff(old, now);
    const flat = flattenDiff(diff);
    expect(flat.some((e) => e.key === 'items' && e.type === 'removed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — label resolution
// ---------------------------------------------------------------------------
describe('computeDiff — labels', () => {
  it('uses CONFIG_PATH_LABELS when available', () => {
    const old = { topology: 'growth' };
    const now = { topology: 'enterprise' };
    const diff = computeDiff(old, now, CONFIG_PATH_LABELS);
    const flat = flattenDiff(diff);
    expect(flat.find((e) => e.key === 'topology')?.label).toBe('Deployment Topology');
  });

  it('uses custom labels when provided', () => {
    const labels = { name: 'Display Name' };
    const diff = computeDiff({ name: 'a' }, { name: 'b' }, labels);
    const flat = flattenDiff(diff);
    expect(flat.find((e) => e.key === 'name')?.label).toBe('Display Name');
  });

  it('falls back to humanized key name', () => {
    const diff = computeDiff({ some_field: 1 }, { some_field: 2 });
    const flat = flattenDiff(diff);
    const entry = flat.find((e) => e.key === 'some_field');
    expect(entry?.label).toBe('Some field');
  });
});

// ---------------------------------------------------------------------------
// flattenDiff
// ---------------------------------------------------------------------------
describe('flattenDiff', () => {
  it('returns leaf entries from nested diff', () => {
    const diff: DiffEntry[] = [
      {
        type: 'changed',
        path: ['config'],
        key: 'config',
        label: 'Config',
        children: [
          { type: 'changed', path: ['config', 'port'], key: 'port', label: 'Port', oldValue: 80, newValue: 443 },
          { type: 'unchanged', path: ['config', 'host'], key: 'host', label: 'Host', oldValue: 'a', newValue: 'a' },
        ],
      },
    ];
    const flat = flattenDiff(diff);
    expect(flat.length).toBe(2);
    expect(flat[0].key).toBe('port');
    expect(flat[1].key).toBe('host');
  });

  it('returns empty array for empty input', () => {
    expect(flattenDiff([])).toEqual([]);
  });

  it('returns entries without children as-is', () => {
    const diff: DiffEntry[] = [
      { type: 'changed', path: ['a'], key: 'a', label: 'A', oldValue: 1, newValue: 2 },
    ];
    const flat = flattenDiff(diff);
    expect(flat.length).toBe(1);
    expect(flat[0]).toBe(diff[0]);
  });
});

// ---------------------------------------------------------------------------
// filterDiff
// ---------------------------------------------------------------------------
describe('filterDiff', () => {
  const diff: DiffEntry[] = [
    { type: 'added', path: ['a'], key: 'a', label: 'A', newValue: 1 },
    { type: 'removed', path: ['b'], key: 'b', label: 'B', oldValue: 2 },
    { type: 'changed', path: ['c'], key: 'c', label: 'C', oldValue: 3, newValue: 4 },
    { type: 'unchanged', path: ['d'], key: 'd', label: 'D', oldValue: 5, newValue: 5 },
  ];

  it('filters by added type', () => {
    const result = filterDiff(diff, ['added']);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('added');
  });

  it('filters by removed type', () => {
    const result = filterDiff(diff, ['removed']);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('removed');
  });

  it('filters by multiple types', () => {
    const result = filterDiff(diff, ['added', 'changed']);
    expect(result.length).toBe(2);
  });

  it('returns empty when no matches', () => {
    const unchangedOnly: DiffEntry[] = [
      { type: 'unchanged', path: ['x'], key: 'x', label: 'X', oldValue: 1, newValue: 1 },
    ];
    const result = filterDiff(unchangedOnly, ['added']);
    expect(result.length).toBe(0);
  });

  it('filters nested children', () => {
    const nested: DiffEntry[] = [
      {
        type: 'changed',
        path: ['parent'],
        key: 'parent',
        label: 'Parent',
        children: [
          { type: 'added', path: ['parent', 'a'], key: 'a', label: 'A', newValue: 1 },
          { type: 'unchanged', path: ['parent', 'b'], key: 'b', label: 'B', oldValue: 2, newValue: 2 },
        ],
      },
    ];
    const result = filterDiff(nested, ['added']);
    expect(result.length).toBe(1);
    expect(result[0].children?.length).toBe(1);
    expect(result[0].children?.[0].type).toBe('added');
  });
});

// ---------------------------------------------------------------------------
// diffToText
// ---------------------------------------------------------------------------
describe('diffToText', () => {
  it('returns "No changes" for identical objects', () => {
    const diff = computeDiff({ a: 1 }, { a: 1 });
    expect(diffToText(diff)).toBe('No changes');
  });

  it('prefixes added entries with +', () => {
    const diff = computeDiff({}, { name: 'hello' });
    const text = diffToText(diff);
    expect(text).toContain('+ ');
  });

  it('prefixes removed entries with -', () => {
    const diff = computeDiff({ name: 'hello' }, {});
    const text = diffToText(diff);
    expect(text).toContain('- ');
  });

  it('prefixes changed entries with ~', () => {
    const diff = computeDiff({ name: 'old' }, { name: 'new' });
    const text = diffToText(diff);
    expect(text).toContain('~ ');
    expect(text).toContain('→');
  });

  it('includes labels in output', () => {
    const diff = computeDiff(
      { topology: 'growth' },
      { topology: 'enterprise' },
      CONFIG_PATH_LABELS,
    );
    const text = diffToText(diff);
    expect(text).toContain('Deployment Topology');
  });

  it('formats boolean values', () => {
    const diff = computeDiff({ flag: false }, { flag: true });
    const text = diffToText(diff);
    expect(text).toContain('No');
    expect(text).toContain('Yes');
  });

  it('formats arrays', () => {
    const diff = computeDiff({ items: ['a'] }, { items: ['a', 'b'] });
    const text = diffToText(diff);
    expect(text).toContain('a, b');
  });

  it('formats null as (empty)', () => {
    const diff = computeDiff({ val: null }, { val: 'filled' });
    const text = diffToText(diff);
    expect(text).toContain('(empty)');
    expect(text).toContain('→');
  });
});

// ---------------------------------------------------------------------------
// countChanges
// ---------------------------------------------------------------------------
describe('countChanges', () => {
  it('counts zero changes for identical objects', () => {
    const diff = computeDiff({ a: 1 }, { a: 1 });
    const counts = countChanges(diff);
    expect(counts.added).toBe(0);
    expect(counts.removed).toBe(0);
    expect(counts.changed).toBe(0);
  });

  it('counts added fields', () => {
    const diff = computeDiff({}, { a: 1, b: 2 });
    const counts = countChanges(diff);
    expect(counts.added).toBe(2);
  });

  it('counts removed fields', () => {
    const diff = computeDiff({ a: 1, b: 2 }, {});
    const counts = countChanges(diff);
    expect(counts.removed).toBe(2);
  });

  it('counts changed fields', () => {
    const diff = computeDiff({ a: 1, b: 2 }, { a: 10, b: 20 });
    const counts = countChanges(diff);
    expect(counts.changed).toBe(2);
  });

  it('counts mixed operations', () => {
    const diff = computeDiff({ a: 1, b: 2 }, { a: 10, c: 3 });
    const counts = countChanges(diff);
    expect(counts.changed).toBe(1); // a
    expect(counts.removed).toBe(1); // b
    expect(counts.added).toBe(1); // c
  });
});

// ---------------------------------------------------------------------------
// hasMeaningfulChanges
// ---------------------------------------------------------------------------
describe('hasMeaningfulChanges', () => {
  it('returns false for identical objects', () => {
    const diff = computeDiff({ a: 1 }, { a: 1 });
    expect(hasMeaningfulChanges(diff)).toBe(false);
  });

  it('returns true when fields are added', () => {
    const diff = computeDiff({}, { a: 1 });
    expect(hasMeaningfulChanges(diff)).toBe(true);
  });

  it('returns true when fields are removed', () => {
    const diff = computeDiff({ a: 1 }, {});
    expect(hasMeaningfulChanges(diff)).toBe(true);
  });

  it('returns true when fields are changed', () => {
    const diff = computeDiff({ a: 1 }, { a: 2 });
    expect(hasMeaningfulChanges(diff)).toBe(true);
  });

  it('returns false for empty objects', () => {
    const diff = computeDiff({}, {});
    expect(hasMeaningfulChanges(diff)).toBe(false);
  });
});
