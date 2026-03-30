import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (token: string, username: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSSO = async () => {
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'SSO login failed' }));
        throw new Error(body.detail || `SSO login failed (${res.status})`);
      }

      const data = await res.json();
      onLogin(data.token, data.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__left">
        <div className="login-card">
          <h1 className="login-card__title">Welcome</h1>
          <p className="login-card__subtitle">
            Sign in to the AAP Deployment Wizard.
          </p>

          {error && (
            <div className="login-card__error" role="alert">
              {error}
            </div>
          )}

          <button
            type="button"
            className="aap-btn aap-btn--primary login-card__sso-btn"
            onClick={handleSSO}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Click here for SSO'}
          </button>
        </div>
      </div>

      <div className="login-page__right">
        <img
          src="./aap-logo-standard.svg"
          alt="Red Hat Ansible Automation Platform"
          className="login-page__logo"
        />
        <p className="login-page__tagline">Containerized Deployment Wizard</p>
      </div>
    </div>
  );
}
