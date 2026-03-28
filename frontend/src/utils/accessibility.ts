/**
 * AAP Deployment Wizard — Accessibility Utilities
 * Focus management, screen reader announcements, keyboard navigation,
 * contrast checking, and WCAG compliance helpers.
 */

const LIVE_REGION_ID = 'aap-live-region';
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let liveRegionEl: HTMLElement | null = null;

/**
 * Focus management utilities
 */
export function trapFocus(containerEl: HTMLElement): () => void {
  const focusable = getAllFocusable(containerEl);
  if (focusable.length === 0) return () => {};

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  containerEl.addEventListener('keydown', handleKeyDown);
  first.focus();

  return () => containerEl.removeEventListener('keydown', handleKeyDown);
}

export function restoreFocus(previousEl: Element | null): void {
  if (previousEl && previousEl instanceof HTMLElement) {
    previousEl.focus();
  }
}

export function focusFirstInteractive(containerEl: HTMLElement): void {
  const first = getFirstFocusable(containerEl);
  if (first) first.focus();
}

export function getFirstFocusable(container: HTMLElement): HTMLElement | null {
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  for (const el of focusable) {
    if (el.offsetParent !== null && !el.hasAttribute('disabled')) return el;
  }
  return null;
}

export function getLastFocusable(container: HTMLElement): HTMLElement | null {
  const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  for (let i = focusable.length - 1; i >= 0; i--) {
    const el = focusable[i];
    if (el.offsetParent !== null && !el.hasAttribute('disabled')) return el;
  }
  return null;
}

export function getAllFocusable(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(nodes).filter(
    (el) => el.offsetParent !== null && !el.hasAttribute('disabled')
  );
}

/**
 * Announce to screen readers via aria-live region
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const region = getOrCreateLiveRegion();
  region.setAttribute('aria-live', priority);
  region.setAttribute('aria-atomic', 'true');
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

export function announceStepChange(stepLabel: string): void {
  announce(`Now on step: ${stepLabel}`, 'polite');
}

export function announceValidationError(fieldLabel: string, error: string): void {
  announce(`${fieldLabel}: ${error}`, 'assertive');
}

export function announceDeploymentProgress(phase: string, progress: number): void {
  announce(`${phase}: ${Math.round(progress)}% complete`, 'polite');
}

/**
 * Create the live region element (call once on app mount)
 */
export function createLiveRegion(): HTMLElement {
  if (liveRegionEl) return liveRegionEl;

  liveRegionEl = document.createElement('div');
  liveRegionEl.id = LIVE_REGION_ID;
  liveRegionEl.setAttribute('aria-live', 'polite');
  liveRegionEl.setAttribute('aria-atomic', 'true');
  liveRegionEl.className = 'aap-sr-only';
  liveRegionEl.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;';
  document.body.appendChild(liveRegionEl);
  return liveRegionEl;
}

export function destroyLiveRegion(): void {
  if (liveRegionEl && liveRegionEl.parentNode) {
    liveRegionEl.parentNode.removeChild(liveRegionEl);
    liveRegionEl = null;
  }
}

function getOrCreateLiveRegion(): HTMLElement {
  if (!liveRegionEl) {
    return createLiveRegion();
  }
  return liveRegionEl;
}

/**
 * Keyboard navigation helpers
 */
export function handleArrowKeyNavigation(
  event: KeyboardEvent,
  items: HTMLElement[],
  options?: { wrap?: boolean; orientation?: 'horizontal' | 'vertical' }
): void {
  const { wrap = true, orientation = 'vertical' } = options ?? {};
  const currentIndex = items.findIndex((el) => el === document.activeElement);
  if (currentIndex === -1) return;

  const isVertical = orientation === 'vertical';
  const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
  const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

  if (event.key === nextKey) {
    event.preventDefault();
    const nextIndex = wrap ? (currentIndex + 1) % items.length : Math.min(currentIndex + 1, items.length - 1);
    items[nextIndex]?.focus();
  } else if (event.key === prevKey) {
    event.preventDefault();
    const prevIndex = wrap ? (currentIndex - 1 + items.length) % items.length : Math.max(currentIndex - 1, 0);
    items[prevIndex]?.focus();
  }
}

export function handleMenuKeyNavigation(
  event: KeyboardEvent,
  items: HTMLElement[],
  onSelect: (item: HTMLElement) => void
): void {
  const currentIndex = items.findIndex((el) => el === document.activeElement);

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (currentIndex >= 0 && items[currentIndex]) {
      onSelect(items[currentIndex]);
    }
    return;
  }

  handleArrowKeyNavigation(event, items, { wrap: true, orientation: 'vertical' });
}

/**
 * High contrast detection
 */
export function isHighContrastMode(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-contrast: high)').matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function prefersReducedTransparency(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

/**
 * Color contrast checking (WCAG 2.1)
 */
export function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function getContrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const L1 = relativeLuminance(fg.r, fg.g, fg.b);
  const L2 = relativeLuminance(bg.r, bg.g, bg.b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) return hexToRGB(trimmed);
  const rgbMatch = trimmed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

export function meetsWCAG_AA(
  foreground: string,
  background: string,
  isLargeText = false
): boolean {
  const ratio = getContrastRatio(foreground, background);
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

export function meetsWCAG_AAA(
  foreground: string,
  background: string,
  isLargeText = false
): boolean {
  const ratio = getContrastRatio(foreground, background);
  return isLargeText ? ratio >= 4.5 : ratio >= 7;
}

/**
 * Generate unique IDs for aria associations
 */
let idCounter = 0;
export function generateAriaId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`;
}

export function linkAriaDescribedBy(inputEl: HTMLElement, descriptionEl: HTMLElement): void {
  const id = descriptionEl.id || generateAriaId('aap-desc');
  if (!descriptionEl.id) descriptionEl.id = id;
  inputEl.setAttribute('aria-describedby', id);
}

/**
 * Skip navigation link management
 */
export function createSkipLinks(targets: { label: string; targetId: string }[]): void {
  let container = document.getElementById('aap-skip-links');
  if (!container) {
    container = document.createElement('div');
    container.id = 'aap-skip-links';
    container.setAttribute('role', 'navigation');
    container.setAttribute('aria-label', 'Skip links');
    document.body.insertBefore(container, document.body.firstChild);
  }

  container.innerHTML = '';
  targets.forEach(({ label, targetId }) => {
    const link = document.createElement('a');
    link.href = `#${targetId}`;
    link.textContent = label;
    link.className = 'aap-skip-link aap-sr-only';
    link.style.cssText =
      'position:absolute;top:-40px;left:0;background:var(--aap-red);color:#fff;padding:8px 16px;z-index:10000;transition:top 0.2s;';
    link.addEventListener('focus', () => {
      link.style.top = '0';
    });
    link.addEventListener('blur', () => {
      link.style.top = '-40px';
    });
    container.appendChild(link);
  });
}

/**
 * Screen reader text utilities
 */
export function formatForScreenReader(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .trim();
}

export function pluralizeForSR(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
