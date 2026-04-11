import React from 'react';

interface SkeletonProps {
  variant?: 'text' | 'text-short' | 'heading' | 'block' | 'circle';
  width?: string;
  height?: string;
  count?: number;
}

export function Skeleton({ variant = 'text', width, height, count = 1 }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={`aap-skeleton aap-skeleton--${variant}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  ));
  return <>{items}</>;
}

export function SkeletonCard() {
  return (
    <div className="aap-card" aria-busy="true" aria-label="Loading">
      <Skeleton variant="heading" />
      <Skeleton variant="text" count={3} />
      <Skeleton variant="text-short" />
    </div>
  );
}
