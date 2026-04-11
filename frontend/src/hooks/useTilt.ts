import { useCallback, type MouseEvent } from 'react';

export function useTilt(strength = 6) {
  const handleMouseMove = useCallback((e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -strength;
    const rotateY = ((x - centerX) / centerX) * strength;
    el.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  }, [strength]);

  const handleMouseLeave = useCallback((e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = '';
  }, []);

  return { onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave };
}
