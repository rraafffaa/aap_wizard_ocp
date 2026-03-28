import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (token: string, username: string, password: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Login failed' }));
        throw new Error(body.detail || `Login failed (${res.status})`);
      }

      const data = await res.json();
      onLogin(data.token, data.username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__left">
        <div className="login-card">
          <h1 className="login-card__title">Log in to your account</h1>
          <p className="login-card__subtitle">Enter your credentials.</p>

          <form className="login-card__form" onSubmit={handleSubmit}>
            {error && (
              <div className="login-card__error" role="alert">
                {error}
              </div>
            )}

            <div className="login-card__field">
              <label htmlFor="username">
                Username <span className="login-card__required">*</span>
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div className="login-card__field">
              <label htmlFor="password">
                Password <span className="login-card__required">*</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              className="aap-btn aap-btn--primary login-card__submit"
              disabled={loading || !username || !password}
            >
              {loading ? 'Logging in...' : 'Log in'}
            </button>
          </form>
        </div>
      </div>

      <div className="login-page__right">
        <img
          src="/aap-logo-standard.svg"
          alt="Red Hat Ansible Automation Platform"
          className="login-page__logo"
        />
        <p className="login-page__tagline">Containerized Deployment Wizard</p>
      </div>
    </div>
  );
}
