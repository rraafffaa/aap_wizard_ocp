import { useCallback, type MouseEvent } from 'react';

export function useMagnetic(strength = 0.2) {
  const handleMouseMove = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  }, [strength]);

  const handleMouseLeave = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.style.transition = 'transform 0.3s ease';
    el.style.transform = 'translate(0, 0)';
    setTimeout(() => { el.style.transition = ''; }, 300);
  }, []);

  return { onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave };
}
