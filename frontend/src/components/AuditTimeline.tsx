import React, { useState } from 'react';

export interface AuditEntry {
  id: string;
  timestamp: number;
  category: string;
  action: string;
  description: string;
}

export function getTimePeriod(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  if (timestamp >= todayStart.getTime()) return 'Today';
  if (timestamp >= yesterdayStart.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'config_change', label: 'Config Changes' },
];

interface AuditTimelineProps {
  entries: AuditEntry[];
}

export function AuditTimeline({ entries }: AuditTimelineProps) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = entries
    .filter((e) => category === 'all' || e.category === category)
    .filter((e) => !search || e.description.toLowerCase().includes(search.toLowerCase()));

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="aap-audit-timeline">
      <div role="tablist">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-label={c.label}
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Search audit log..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button aria-label="Export" onClick={handleExport} disabled={entries.length === 0}>Export</button>
      {filtered.length === 0 ? (
        <div>{entries.length === 0 ? 'No audit entries yet' : 'No matching entries'}</div>
      ) : (
        <ul>
          {filtered.map((e) => (
            <li key={e.id}>
              <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span>{e.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
