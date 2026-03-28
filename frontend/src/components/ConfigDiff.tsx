import React from 'react';

export interface DiffEntry {
  path: string;
  category: string;
  field: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: any;
  newValue?: any;
}

export function formatDiffValue(value: any, fieldName: string): string {
  if (fieldName.includes('password') || fieldName.includes('secret') || fieldName.includes('api_key')) {
    return '********';
  }
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
  return String(value);
}

interface ConfigDiffProps {
  entries: DiffEntry[];
  compact?: boolean;
  title?: string;
}

export function ConfigDiff({ entries, compact, title }: ConfigDiffProps) {
  if (entries.length === 0) {
    return <div className={compact ? 'aap-diff aap-diff--compact' : 'aap-diff'}>No differences found</div>;
  }

  const categories = new Map<string, DiffEntry[]>();
  entries.forEach((e) => {
    const list = categories.get(e.category) || [];
    list.push(e);
    categories.set(e.category, list);
  });

  const typeColor = { added: '#3e8635', removed: '#c9190b', changed: '#06c' };

  return (
    <div className={compact ? 'aap-diff aap-diff--compact' : 'aap-diff'}>
      {title && <h3>{title}</h3>}
      {Array.from(categories.entries()).map(([cat, items]) => (
        <div key={cat}>
          <h4>{cat}</h4>
          {items.map((e) => (
            <div key={e.path} style={{ color: typeColor[e.type], marginBottom: 4 }}>
              <strong>{e.field}</strong>
              {e.type === 'changed' && (
                <span>
                  {' '}<span>{formatDiffValue(e.oldValue, e.field)}</span> → <span>{formatDiffValue(e.newValue, e.field)}</span>
                </span>
              )}
              {e.type === 'added' && <span> {formatDiffValue(e.newValue, e.field)}</span>}
              {e.type === 'removed' && <span> {formatDiffValue(e.oldValue, e.field)}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
