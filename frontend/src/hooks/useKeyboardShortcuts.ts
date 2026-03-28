import { useEffect, useCallback, useRef } from 'react';
import type { WizardStep } from '../types';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  category: 'navigation' | 'actions' | 'general';
  action: () => void;
  enabled?: boolean;
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
}

export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];
  const mac = isMac();

  if (shortcut.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (shortcut.alt) parts.push(mac ? '⌥' : 'Alt');
  if (shortcut.shift) parts.push(mac ? '⇧' : 'Shift');
  if (shortcut.meta) parts.push(mac ? '⌘' : 'Win');

  const keyDisplay = KEY_DISPLAY_MAP[shortcut.key.toLowerCase()] ?? shortcut.key.toUpperCase();
  parts.push(keyDisplay);

  return parts.join(mac ? '' : '+');
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  enter: '↩',
  escape: 'Esc',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  space: '␣',
  ' ': '␣',
};

function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  if (shortcut.enabled === false) return false;

  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (eventKey !== shortcutKey) return false;

  const wantsCtrl = shortcut.ctrl ?? false;
  const wantsShift = shortcut.shift ?? false;
  const wantsAlt = shortcut.alt ?? false;
  const wantsMeta = shortcut.meta ?? false;

  if (isMac()) {
    if (wantsCtrl && !event.metaKey && !event.ctrlKey) return false;
    if (!wantsCtrl && (event.metaKey || event.ctrlKey)) return false;
  } else {
    if (wantsCtrl !== event.ctrlKey) return false;
    if (wantsMeta !== event.metaKey) return false;
  }

  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;

  return true;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isEditableElement(event.target)) {
      const isGlobalCombo = event.ctrlKey || event.metaKey || event.altKey;
      if (!isGlobalCombo) return;
    }

    for (const shortcut of shortcutsRef.current) {
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        event.stopPropagation();
        shortcut.action();
        return;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleKeyDown]);
}

export function getNavigationShortcuts(
  goNext: () => void,
  goBack: () => void,
  goToStep: (step: WizardStep) => void,
): KeyboardShortcut[] {
  return [
    {
      key: 'ArrowRight',
      alt: true,
      description: 'Go to next step',
      category: 'navigation',
      action: goNext,
    },
    {
      key: 'ArrowLeft',
      alt: true,
      description: 'Go to previous step',
      category: 'navigation',
      action: goBack,
    },
    {
      key: 'Enter',
      ctrl: true,
      description: 'Proceed to next step',
      category: 'navigation',
      action: goNext,
    },
    {
      key: '1',
      alt: true,
      description: 'Go to Topology step',
      category: 'navigation',
      action: () => goToStep('topology'),
    },
    {
      key: '2',
      alt: true,
      description: 'Go to Hosts step',
      category: 'navigation',
      action: () => goToStep('hosts'),
    },
    {
      key: '3',
      alt: true,
      description: 'Go to Components step',
      category: 'navigation',
      action: () => goToStep('components'),
    },
    {
      key: '4',
      alt: true,
      description: 'Go to Database step',
      category: 'navigation',
      action: () => goToStep('database'),
    },
    {
      key: '5',
      alt: true,
      description: 'Go to Network step',
      category: 'navigation',
      action: () => goToStep('network'),
    },
    {
      key: '6',
      alt: true,
      description: 'Go to Credentials step',
      category: 'navigation',
      action: () => goToStep('credentials'),
    },
    {
      key: '7',
      alt: true,
      description: 'Go to Review step',
      category: 'navigation',
      action: () => goToStep('review'),
    },
  ];
}

export function getActionShortcuts(actions: {
  save?: () => void;
  exportConfig?: () => void;
  importConfig?: () => void;
  toggleHelp?: () => void;
  togglePalette?: () => void;
}): KeyboardShortcut[] {
  const shortcuts: KeyboardShortcut[] = [];

  if (actions.save) {
    shortcuts.push({
      key: 's',
      ctrl: true,
      description: 'Save configuration',
      category: 'actions',
      action: actions.save,
    });
  }

  if (actions.exportConfig) {
    shortcuts.push({
      key: 'e',
      ctrl: true,
      shift: true,
      description: 'Export configuration',
      category: 'actions',
      action: actions.exportConfig,
    });
  }

  if (actions.importConfig) {
    shortcuts.push({
      key: 'i',
      ctrl: true,
      shift: true,
      description: 'Import configuration',
      category: 'actions',
      action: actions.importConfig,
    });
  }

  if (actions.toggleHelp) {
    shortcuts.push({
      key: '?',
      shift: true,
      ctrl: true,
      description: 'Toggle keyboard shortcuts help',
      category: 'general',
      action: actions.toggleHelp,
    });
  }

  if (actions.togglePalette) {
    shortcuts.push({
      key: 'k',
      ctrl: true,
      description: 'Toggle command palette',
      category: 'general',
      action: actions.togglePalette,
    });
  }

  return shortcuts;
}
