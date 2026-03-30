import React, { useState, useRef, useEffect } from 'react';
import {
  SaveIcon,
  TrashIcon,
  DownloadIcon,
  UploadIcon,
  CaretDownIcon,
  TimesIcon,
} from '@patternfly/react-icons';
import { DeploymentConfig, getDefaultConfig, getDefaultOCPConfig, stripSensitiveFields } from '../types';

const PROFILES_KEY = 'aap_wizard_profiles';

interface SavedProfile {
  name: string;
  config: DeploymentConfig;
  created: string;
}

interface ProfileManagerProps {
  config: DeploymentConfig;
  onLoadProfile: (config: DeploymentConfig) => void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function getBuiltInTemplates(): SavedProfile[] {
  const baseDefaults = getDefaultConfig();
  const ocpDefaults = getDefaultOCPConfig();

  return [
    {
      name: 'Development (Single Node)',
      created: 'Built-in',
      config: {
        ...baseDefaults,
        platform: 'containerized',
        topology: 'growth',
        installation_type: 'online',
        gateway: { ...baseDefaults.gateway, hosts: ['dev.local'] },
        controller: { ...baseDefaults.controller, hosts: ['dev.local'] },
        hub: { ...baseDefaults.hub, hosts: ['dev.local'] },
        eda: { ...baseDefaults.eda, hosts: ['dev.local'] },
        target_host: 'dev.local',
        target_user: 'aap',
      },
    },
    {
      name: 'Production HA (Containerized)',
      created: 'Built-in',
      config: {
        ...baseDefaults,
        platform: 'containerized',
        topology: 'enterprise',
        installation_type: 'online',
        gateway: { ...baseDefaults.gateway, hosts: ['gw1.prod.local', 'gw2.prod.local'] },
        controller: {
          ...baseDefaults.controller,
          hosts: ['ctrl1.prod.local', 'ctrl2.prod.local', 'ctrl3.prod.local'],
        },
        hub: { ...baseDefaults.hub, hosts: ['hub1.prod.local', 'hub2.prod.local'] },
        eda: { ...baseDefaults.eda, hosts: ['eda1.prod.local', 'eda2.prod.local'] },
        redis_mode: 'cluster',
        target_host: 'gw1.prod.local',
        target_user: 'aap',
      },
    },
    {
      name: 'OpenShift Dev',
      created: 'Built-in',
      config: {
        ...baseDefaults,
        platform: 'openshift',
        ocp: {
          ...ocpDefaults,
          namespace: 'aap-dev',
          postgres_storage_size: '20Gi',
          hub_storage_size: '50Gi',
          gateway_replicas: 1,
          controller_replicas: 1,
          hub_replicas: 1,
          eda_replicas: 1,
          controller_resource_preset: 'small',
        },
      },
    },
    {
      name: 'OpenShift Production',
      created: 'Built-in',
      config: {
        ...baseDefaults,
        platform: 'openshift',
        ocp: {
          ...ocpDefaults,
          namespace: 'aap-prod',
          postgres_storage_size: '100Gi',
          hub_storage_size: '200Gi',
          gateway_replicas: 3,
          controller_replicas: 3,
          hub_replicas: 3,
          eda_replicas: 2,
          controller_resource_preset: 'large',
        },
      },
    },
  ];
}

function loadProfiles(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: SavedProfile[]) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error('Failed to save profiles:', err);
  }
}


export function ProfileManager({ config, onLoadProfile, onToast }: ProfileManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [profiles, setProfiles] = useState<SavedProfile[]>(loadProfiles);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const templates = getBuiltInTemplates();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSaveProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) {
      onToast('Profile name cannot be empty', 'error');
      return;
    }
    if (profiles.some((p) => p.name === trimmed)) {
      onToast('A profile with this name already exists', 'error');
      return;
    }

    const newProfile: SavedProfile = {
      name: trimmed,
      config: stripSensitiveFields(config),
      created: new Date().toISOString(),
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    saveProfiles(updated);
    setNewProfileName('');
    setSaveDialogOpen(false);
    onToast(`Profile "${trimmed}" saved`, 'success');
  };

  const handleLoadProfile = (profile: SavedProfile) => {
    onLoadProfile(profile.config);
    setIsOpen(false);
    onToast(`Profile "${profile.name}" loaded`, 'success');
  };

  const handleDeleteProfile = (name: string) => {
    if (!confirm(`Delete profile "${name}"?`)) return;
    const updated = profiles.filter((p) => p.name !== name);
    setProfiles(updated);
    saveProfiles(updated);
    onToast(`Profile "${name}" deleted`, 'info');
  };

  const handleExportProfile = (profile: SavedProfile) => {
    const blob = new Blob([JSON.stringify(profile.config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, '_')}_profile.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast(`Profile "${profile.name}" exported`, 'success');
  };

  const handleImportProfile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result as string);
          const profileName = file.name.replace('.json', '').replace(/_/g, ' ');
          const newProfile: SavedProfile = {
            name: profileName,
            config: { ...getDefaultConfig(), ...imported },
            created: new Date().toISOString(),
          };
          const updated = [...profiles, newProfile];
          setProfiles(updated);
          saveProfiles(updated);
          onToast(`Profile imported as "${profileName}"`, 'success');
        } catch {
          onToast('Invalid profile JSON file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="profile-manager">
      <button
        ref={buttonRef}
        className="aap-btn aap-btn--tertiary aap-btn--sm"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Manage deployment profiles"
        aria-expanded={isOpen}
      >
        <SaveIcon /> Profiles <CaretDownIcon />
      </button>

      {isOpen && (
        <div ref={panelRef} className="profile-panel" role="dialog" aria-label="Profile manager">
          <div className="profile-panel__header">
            <h3>Deployment Profiles</h3>
            <button
              className="profile-panel__close"
              onClick={() => setIsOpen(false)}
              aria-label="Close profile manager"
            >
              <TimesIcon />
            </button>
          </div>

          <div className="profile-panel__body">
            {/* Save Current */}
            <div className="profile-section">
              <h4>Save Current Configuration</h4>
              {!saveDialogOpen ? (
                <button
                  className="aap-btn aap-btn--secondary aap-btn--sm aap-btn--block"
                  onClick={() => setSaveDialogOpen(true)}
                >
                  <SaveIcon /> Save as Profile
                </button>
              ) : (
                <div className="profile-save-form">
                  <input
                    type="text"
                    className="aap-input"
                    placeholder="Profile name"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                    autoFocus
                  />
                  <div className="profile-save-actions">
                    <button
                      className="aap-btn aap-btn--tertiary aap-btn--sm"
                      onClick={() => {
                        setSaveDialogOpen(false);
                        setNewProfileName('');
                      }}
                    >
                      Cancel
                    </button>
                    <button className="aap-btn aap-btn--primary aap-btn--sm" onClick={handleSaveProfile}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Saved Profiles */}
            {profiles.length > 0 && (
              <div className="profile-section">
                <h4>Saved Profiles</h4>
                <ul className="profile-list">
                  {profiles.map((profile) => (
                    <li key={profile.name} className="profile-item">
                      <div className="profile-item__info">
                        <div className="profile-item__name">{profile.name}</div>
                        <div className="profile-item__meta">
                          {new Date(profile.created).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="profile-item__actions">
                        <button
                          className="aap-btn aap-btn--link aap-btn--sm"
                          onClick={() => handleLoadProfile(profile)}
                          title="Load profile"
                        >
                          Load
                        </button>
                        <button
                          className="aap-btn aap-btn--link aap-btn--sm"
                          onClick={() => handleExportProfile(profile)}
                          title="Export profile"
                        >
                          <DownloadIcon />
                        </button>
                        <button
                          className="aap-btn aap-btn--link aap-btn--sm aap-btn--danger"
                          onClick={() => handleDeleteProfile(profile.name)}
                          title="Delete profile"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Templates */}
            <div className="profile-section">
              <h4>Built-in Templates</h4>
              <ul className="profile-list">
                {templates.map((template) => (
                  <li key={template.name} className="profile-item">
                    <div className="profile-item__info">
                      <div className="profile-item__name">{template.name}</div>
                      <div className="profile-item__meta">{template.created}</div>
                    </div>
                    <div className="profile-item__actions">
                      <button
                        className="aap-btn aap-btn--link aap-btn--sm"
                        onClick={() => handleLoadProfile(template)}
                      >
                        Load
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Import */}
            <div className="profile-section">
              <button
                className="aap-btn aap-btn--secondary aap-btn--sm aap-btn--block"
                onClick={handleImportProfile}
              >
                <UploadIcon /> Import Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
