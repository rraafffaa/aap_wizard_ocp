import React, { useState, useEffect, useRef } from 'react';
import { WIZARD_STEPS, type WizardStep } from '../types';

const RECENT_KEY = 'aap-wizard-recent-commands';
const MAX_RECENT = 5;

export interface FuzzyResult {
  matches: boolean;
  score: number;
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (!query) return { matches: true, score: 0, indices: [] };
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (lower.includes(q)) {
    const idx = lower.indexOf(q);
    const indices = Array.from({ length: q.length }, (_, i) => idx + i);
    const score = q.length === lower.length ? 100 : 50 + (q.length / lower.length) * 50;
    return { matches: true, score, indices };
  }
  let qi = 0;
  const indices: number[] = [];
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) { indices.push(i); qi++; }
  }
  if (qi === q.length) {
    return { matches: true, score: (q.length / lower.length) * 30, indices };
  }
  return { matches: false, score: 0, indices: [] };
}

export function loadRecentCommands(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export function saveRecentCommand(commandId: string): void {
  const recent = loadRecentCommands().filter((c) => c !== commandId);
  recent.unshift(commandId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

interface Command {
  id: string;
  label: string;
  category: 'navigate' | 'action';
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (step: WizardStep) => void;
  onAction: (action: string) => void;
  currentStep: string;
}

export function CommandPalette({ isOpen, onClose, onNavigate, onAction, currentStep }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = WIZARD_STEPS.map((s) => ({
    id: `nav-${s.id}`,
    label: `Go to ${s.label}`,
    category: 'navigate',
  }));

  const filtered = commands.filter((cmd) => fuzzyMatch(query, cmd.label).matches);

  useEffect(() => {
    if (isOpen) { inputRef.current?.focus(); setQuery(''); }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && filtered.length > 0) {
      const cmd = filtered[0];
      saveRecentCommand(cmd.id);
      if (cmd.category === 'navigate') {
        const stepId = cmd.id.replace('nav-', '') as WizardStep;
        onNavigate(stepId);
      } else {
        onAction(cmd.id);
      }
      onClose();
    }
  };

  return (
    <div className="aap-cmd-palette" onKeyDown={handleKeyDown} tabIndex={-1}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a command..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {filtered.map((cmd) => (
          <li key={cmd.id} onClick={() => {
            saveRecentCommand(cmd.id);
            if (cmd.category === 'navigate') onNavigate(cmd.id.replace('nav-', '') as WizardStep);
            else onAction(cmd.id);
            onClose();
          }}>{cmd.label}</li>
        ))}
      </ul>
    </div>
  );
}
