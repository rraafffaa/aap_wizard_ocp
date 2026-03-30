import React from 'react';
import { CheckIcon, TimesIcon, SyncAltIcon } from '@patternfly/react-icons';
import type { StatusFeedItem } from '../hooks/useOperationStatus';

interface StatusFeedProps {
  items: StatusFeedItem[];
  title?: string;
  showElapsed?: boolean;
  compact?: boolean;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Renders a timeline of operation steps with real-time status feedback.
 * Drop-in replacement for ad-hoc spinner patterns across wizard steps.
 */
export function StatusFeed({ items, title, showElapsed = true, compact = false }: StatusFeedProps) {
  if (items.every(i => i.status === 'pending')) return null;

  return (
    <div className={`aap-status-feed ${compact ? 'aap-status-feed--compact' : ''}`} role="status" aria-live="polite">
      {title && <div className="aap-status-feed__title">{title}</div>}
      <div className="aap-status-feed__items">
        {items.map(item => (
          <div
            key={item.id}
            className={`aap-phase aap-phase--${item.status === 'success' ? 'complete' : item.status === 'failed' ? 'error' : item.status}`}
          >
            <span className="aap-phase__indicator">
              {item.status === 'running' && <SyncAltIcon className="aap-spin" />}
              {item.status === 'success' && <CheckIcon />}
              {item.status === 'failed' && <TimesIcon />}
              {item.status === 'pending' && <span className="aap-phase__dot" />}
            </span>
            <span className="aap-phase__label">
              {item.label}
              {item.status === 'running' && showElapsed && item.elapsed != null && (
                <span className="aap-status-feed__elapsed"> ({formatElapsed(item.elapsed)})</span>
              )}
            </span>
            {item.detail && item.status !== 'pending' && (
              <span className={`aap-status-feed__detail aap-status-feed__detail--${item.status}`}>
                {item.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
