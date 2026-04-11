import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getWizardSteps, type WizardStep, type DeployPlatform } from '../types';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: 'navigate' | 'action';
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (step: WizardStep) => void;
  onAction: (action: string) => void;
  currentStep: string;
  platform: DeployPlatform;
}

export function CommandPalette({ isOpen, onClose, onNavigate, onAction, currentStep, platform }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const steps = getWizardSteps(platform);

  const commands: Command[] = [
    ...steps.map((s) => ({
      id: `nav-${s.id}`,
      label: s.label,
      category: 'navigate' as const,
    })),
    { id: 'action-export', label: 'Export Configuration', category: 'action' },
    { id: 'action-settings', label: 'Open Settings', shortcut: '', category: 'action' },
  ];

  const filtered = commands.filter((cmd) => {
    if (!query) return true;
    return cmd.label.toLowerCase().includes(query.toLowerCase());
  });

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback((cmd: Command) => {
    if (cmd.category === 'navigate') {
      onNavigate(cmd.id.replace('nav-', '') as WizardStep);
    } else {
      onAction(cmd.id.replace('action-', ''));
    }
    onClose();
  }, [onNavigate, onAction, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      execute(filtered[selectedIndex]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="aap-cmd-overlay" onClick={onClose}>
      <div className="aap-cmd-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="aap-cmd-palette__input-wrapper">
          <svg className="aap-cmd-palette__search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M11.5 11.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="aap-cmd-palette__input"
            placeholder="Search steps and actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-activedescendant={filtered[selectedIndex]?.id}
          />
          <kbd className="aap-cmd-palette__kbd">esc</kbd>
        </div>
        <div className="aap-cmd-palette__list" ref={listRef} role="listbox">
          {filtered.length === 0 && (
            <div className="aap-cmd-palette__empty">No results found</div>
          )}
          {filtered.map((cmd, i) => {
            const isActive = cmd.id === `nav-${currentStep}`;
            return (
              <div
                key={cmd.id}
                id={cmd.id}
                role="option"
                aria-selected={i === selectedIndex}
                className={[
                  'aap-cmd-palette__item',
                  i === selectedIndex && 'aap-cmd-palette__item--selected',
                  isActive && 'aap-cmd-palette__item--active',
                ].filter(Boolean).join(' ')}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="aap-cmd-palette__item-category">
                  {cmd.category === 'navigate' ? 'Go to' : 'Run'}
                </span>
                <span className="aap-cmd-palette__item-label">{cmd.label}</span>
                {isActive && <span className="aap-cmd-palette__item-badge">Current</span>}
                {cmd.shortcut && <kbd className="aap-cmd-palette__kbd">{cmd.shortcut}</kbd>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
