import React, { useState, useEffect, useCallback } from 'react';
import { TimesIcon, CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { getAISettings, saveAISettings, clearAISettings, getAIStatus, type AISettingsStatus } from '../api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type ThemeMode = 'system' | 'light' | 'dark';

function getTheme(): ThemeMode {
  return (localStorage.getItem('aap-theme') as ThemeMode) || 'system';
}

function applyTheme(mode: ThemeMode) {
  localStorage.setItem('aap-theme', mode);
  const root = document.documentElement;
  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }
}

// Apply on load
applyTheme(getTheme());

export function SettingsModal({ isOpen, onClose }: Props) {
  const [theme, setTheme] = useState<ThemeMode>(getTheme);
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [status, setStatus] = useState<AISettingsStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const s = await getAISettings();
      setStatus(s);
      if (s.configured) {
        setEndpoint(s.endpoint);
        setModel(s.model);
        // Never populate apiKey — it's never returned from the server
        setApiKey('');
      }
    } catch {
      // Backend may not be running
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setMessage(null);
    }
  }, [isOpen, loadSettings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!endpoint.trim() || !apiKey.trim()) {
      setMessage({ type: 'error', text: 'Endpoint and API Key are required.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveAISettings(endpoint.trim(), apiKey.trim(), model.trim() || 'gpt-4o');
      setMessage({ type: 'success', text: 'AI credentials saved and encrypted.' });
      setApiKey(''); // Clear from React state immediately
      await loadSettings();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await clearAISettings();
      setEndpoint('');
      setApiKey('');
      setModel('gpt-4o');
      setMessage({ type: 'success', text: 'AI credentials cleared.' });
      await loadSettings();
    } catch {
      setMessage({ type: 'error', text: 'Failed to clear settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await getAIStatus();
      if (res.available) {
        setMessage({ type: 'success', text: 'Connection successful — AI services are available.' });
      } else {
        setMessage({ type: 'error', text: 'AI services not available. Check credentials and save first.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Could not reach the backend API.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="aap-modal-overlay" onClick={onClose}>
      <div className="aap-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI Settings">
        <div className="aap-modal__header">
          <h2 className="aap-modal__title">AI Configuration</h2>
          <button type="button" className="aap-modal__close" onClick={onClose} aria-label="Close">
            <TimesIcon />
          </button>
        </div>

        <div className="aap-modal__body">
          {/* Theme selector */}
          <div className="aap-form-group aap-mb-lg">
            <label className="aap-label">Appearance</label>
            <div className="aap-flex-row" style={{ gap: 6 }}>
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`aap-btn aap-btn--sm ${theme === t ? 'aap-btn--primary' : 'aap-btn--secondary'}`}
                  onClick={() => { setTheme(t); applyTheme(t); }}
                >
                  {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>

          <hr className="aap-divider aap-mb-lg" />

          <p className="aap-text-sm aap-text-muted aap-mb-lg">
            Configure Azure OpenAI credentials for AI-powered deployment assistance,
            error diagnosis, and configuration review. Credentials are encrypted at rest.
          </p>

          {status && (
            <div className={`aap-alert ${status.configured ? 'aap-alert--success' : 'aap-alert--info'} aap-mb-lg`}>
              {status.configured ? <CheckCircleIcon /> : <ExclamationCircleIcon />}
              <div>
                <strong>{status.configured ? 'Configured' : 'Not Configured'}</strong>
                {status.configured && (
                  <p className="aap-text-sm">
                    Endpoint: <code>{status.endpoint}</code> | Model: <code>{status.model}</code>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="aap-form-group aap-mb-md">
            <label htmlFor="ai-endpoint" className="aap-label">
              Azure OpenAI Endpoint <span className="aap-required">*</span>
            </label>
            <input
              id="ai-endpoint"
              type="url"
              className="aap-input"
              placeholder="https://your-resource.openai.azure.com"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>

          <div className="aap-form-group aap-mb-md">
            <label htmlFor="ai-key" className="aap-label">
              API Key <span className="aap-required">*</span>
            </label>
            <input
              id="ai-key"
              type="password"
              className="aap-input"
              placeholder={status?.key_set ? '••••••••••••••••' : 'Enter your API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="aap-text-sm aap-text-muted aap-mt-sm">
              The key is encrypted before storage and never sent back to the browser.
            </p>
          </div>

          <div className="aap-form-group aap-mb-lg">
            <label htmlFor="ai-model" className="aap-label">Model Deployment Name</label>
            <input
              id="ai-model"
              type="text"
              className="aap-input"
              placeholder="gpt-4o"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          {message && (
            <div className={`aap-alert ${message.type === 'success' ? 'aap-alert--success' : 'aap-alert--danger'} aap-mb-md`}>
              {message.type === 'success' ? <CheckCircleIcon /> : <ExclamationCircleIcon />}
              <div><p className="aap-text-sm">{message.text}</p></div>
            </div>
          )}
        </div>

        <div className="aap-modal__footer">
          <div className="aap-flex-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="aap-btn aap-btn--primary"
              onClick={handleSave}
              disabled={saving || !endpoint.trim() || !apiKey.trim()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="aap-btn aap-btn--secondary"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {status?.configured && (
              <button
                type="button"
                className="aap-btn aap-btn--danger"
                onClick={handleClear}
                disabled={saving}
              >
                Clear Credentials
              </button>
            )}
          </div>
          <button type="button" className="aap-btn aap-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
