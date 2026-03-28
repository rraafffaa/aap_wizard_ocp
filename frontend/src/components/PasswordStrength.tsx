import React from 'react';

interface StrengthResult {
  level: 'weak' | 'fair' | 'good' | 'strong' | 'excellent';
  label: string;
  score: number;
  entropy: number;
  passedCriteria: boolean[];
}

const CRITERIA = [
  { label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'Symbol', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export function calculateEntropy(password: string): number {
  if (!password) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^A-Za-z0-9]/.test(password)) poolSize += 32;
  if (poolSize === 0) return 0;
  return Math.round(password.length * Math.log2(poolSize) * 100) / 100;
}

export function evaluateStrength(password: string): StrengthResult {
  if (!password) {
    return { level: 'weak', label: '', score: 0, entropy: 0, passedCriteria: [false, false, false, false, false] };
  }

  const passedCriteria = CRITERIA.map((c) => c.test(password));
  const score = passedCriteria.filter(Boolean).length;
  const entropy = calculateEntropy(password);

  let level: StrengthResult['level'];
  let label: string;

  if (score <= 1) {
    level = 'weak';
    label = 'Weak';
  } else if (score === 2) {
    level = 'fair';
    label = 'Fair';
  } else if (score === 3) {
    level = 'good';
    label = 'Good';
  } else if (score === 4) {
    level = 'strong';
    label = 'Strong';
  } else {
    level = 'excellent';
    label = 'Excellent';
  }

  return { level, label, score, entropy, passedCriteria };
}

interface PasswordStrengthProps {
  password: string;
  showDetails?: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  weak: '#c9190b',
  fair: '#f0ab00',
  good: '#06c',
  strong: '#3e8635',
  excellent: '#3e8635',
};

export function PasswordStrength({ password, showDetails }: PasswordStrengthProps) {
  const result = evaluateStrength(password);
  const barWidth = password ? `${(result.score / 5) * 100}%` : '0%';
  const color = LEVEL_COLORS[result.level] || '#c9190b';

  return (
    <div role="group" aria-label="Password strength">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 4, background: '#d2d2d2', borderRadius: 2 }}>
          <div style={{ width: barWidth, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
        {result.label && <span style={{ fontSize: 12, color, fontWeight: 600 }}>{result.label}</span>}
      </div>
      {showDetails && (
        <div style={{ fontSize: 12 }}>
          <div>{Math.round(result.entropy)} bits entropy</div>
          {CRITERIA.map((c, i) => (
            <div key={c.label} style={{ color: result.passedCriteria[i] ? '#3e8635' : '#6a6e73' }}>
              {result.passedCriteria[i] ? '\u2713' : '\u2717'} {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
