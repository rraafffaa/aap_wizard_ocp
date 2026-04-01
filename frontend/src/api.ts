import type {
  DeploymentConfig,
  PreflightResult,
  DeployStatus,
  HostInfo,
  Topology,
  InstallationType,
} from './types';

// When running in Electron (file:// protocol), point to the local backend server.
// In browser/dev mode, use relative URLs (proxied by Vite or same-origin).
const BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
const REQUEST_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Auth token management
// ---------------------------------------------------------------------------

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    sessionStorage.setItem('aap_wizard_token', token);
  } else {
    sessionStorage.removeItem('aap_wizard_token');
  }
}

export function getStoredToken(): string | null {
  if (authToken) return authToken;
  const stored = sessionStorage.getItem('aap_wizard_token');
  if (stored) authToken = stored;
  return authToken;
}

export function clearAuth() {
  authToken = null;
  sessionStorage.removeItem('aap_wizard_token');
  sessionStorage.removeItem('aap_wizard_user');
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp < Date.now() / 1000;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigProfile {
  id: string;
  name: string;
  description: string;
  category: string;
  topology: string;
  config: Partial<DeploymentConfig>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  category: string;
  details: string;
  metadata?: Record<string, unknown>;
}

export interface AuditStats {
  totalEntries: number;
  configChanges: number;
  stepsVisited: number;
}

export interface BackupManifest {
  id: string;
  name: string;
  timestamp: number;
  version: string;
  contents: string[];
  sizeBytes: number;
}

export interface CertificateInfo {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  notBefore: string;
  notAfter: string;
  isExpired: boolean;
  isSelfSigned: boolean;
  sanNames: string[];
  keyAlgorithm: string;
  keySize: number;
  fingerprint: string;
}

export interface CertificateValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DeploymentSnapshot {
  id: string;
  sessionId: string;
  phase: string;
  timestamp: number;
  status: string;
}

export interface NotificationConfig {
  webhookUrl: string;
  enabled: boolean;
  events: string[];
}

export interface Notification {
  id: string;
  event: string;
  timestamp: number;
  title: string;
  message: string;
  severity: string;
  delivered?: boolean;
  delivery_error?: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: {
    field: string;
    message: string;
    severity: string;
    category: string;
    fixSuggestion?: string;
  }[];
  warnings: unknown[];
  score: number;
}

export interface PlatformHealth {
  overall: string;
  components: {
    name: string;
    status: string;
    containerState: string;
    uptimeSeconds: number;
    apiLatencyMs: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    url: string;
    lastCheck: number;
  }[];
  database: {
    status: string;
    activeConnections: number;
    maxConnections: number;
    databaseSize: string;
  };
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getStoredToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      headers,
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      if (res.status === 401) {
        clearAuth();
        window.location.reload();
        throw new ApiError(401, 'Session expired — please log in again');
      }
      const body = await res.text().catch(() => 'Unknown error');
      throw new ApiError(res.status, `API error ${res.status}: ${body}`);
    }
    return await res.json();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out — is the backend running on port 8000?');
    }
    if (err instanceof ApiError) throw err;
    throw new Error(
      `Network error: ${err instanceof Error ? err.message : 'Unknown'}. Is the backend running?`
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function healthCheck() {
  return request<{ status: string }>('/api/health');
}

export async function getPlatformHealth(gatewayUrl?: string): Promise<PlatformHealth> {
  const qs = gatewayUrl ? `?gateway_url=${encodeURIComponent(gatewayUrl)}` : '';
  const raw = await request<{
    overall: string;
    components: Array<{
      name: string;
      status: string;
      container_state: string;
      uptime_seconds: number;
      api_latency_ms: number;
      memory_usage_percent: number;
      cpu_usage_percent: number;
      url: string;
      last_check: number;
    }>;
    database: {
      status: string;
      active_connections: number;
      max_connections: number;
      database_size: string;
    };
    last_updated: number;
  }>(`/api/health/platform${qs}`);

  return {
    overall: raw.overall,
    components: raw.components.map((c) => ({
      name: c.name,
      status: c.status,
      containerState: c.container_state,
      uptimeSeconds: c.uptime_seconds,
      apiLatencyMs: c.api_latency_ms,
      memoryUsagePercent: c.memory_usage_percent,
      cpuUsagePercent: c.cpu_usage_percent,
      url: c.url,
      lastCheck: c.last_check,
    })),
    database: {
      status: raw.database.status,
      activeConnections: raw.database.active_connections,
      maxConnections: raw.database.max_connections,
      databaseSize: raw.database.database_size,
    },
    lastUpdated: raw.last_updated,
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function getProfiles(): Promise<ConfigProfile[]> {
  const res = await request<{ profiles: Array<Record<string, unknown>> }>('/api/profiles');
  return (res.profiles || []).map(normalizeProfile);
}

export async function getProfile(id: string): Promise<ConfigProfile> {
  const raw = await request<Record<string, unknown>>(`/api/profiles/${id}`);
  return normalizeProfile(raw);
}

export async function createProfile(data: {
  name: string;
  description: string;
  config: DeploymentConfig;
  tags?: string[];
}): Promise<ConfigProfile> {
  const raw = await request<Record<string, unknown>>('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      config: data.config,
      tags: data.tags ?? [],
    }),
  });
  return normalizeProfile(raw);
}

export async function updateProfile(
  id: string,
  data: Partial<ConfigProfile>
): Promise<ConfigProfile> {
  const raw = await request<Record<string, unknown>>(`/api/profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return normalizeProfile(raw);
}

export async function deleteProfile(id: string): Promise<void> {
  await request(`/api/profiles/${id}`, { method: 'DELETE' });
}

export async function exportProfileYAML(id: string): Promise<string> {
  const res = await request<{ yaml: string }>(`/api/profiles/${id}/yaml`);
  return res.yaml;
}

export async function importProfileYAML(yaml: string): Promise<ConfigProfile> {
  const raw = await request<Record<string, unknown>>('/api/profiles/import', {
    method: 'POST',
    body: JSON.stringify({ yaml }),
  });
  return normalizeProfile(raw);
}

function normalizeProfile(raw: Record<string, unknown>): ConfigProfile {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    category: String(raw.category ?? ''),
    topology: String(raw.topology ?? ''),
    config: (raw.config as Partial<DeploymentConfig>) ?? {},
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function getAuditLog(params?: {
  category?: string;
  limit?: number;
  offset?: number;
  since?: number;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  if (params?.since != null) qs.set('since', String(params.since));
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await request<{
    entries: Array<{
      id: string;
      timestamp: number;
      action: string;
      category: string;
      details: string;
      metadata?: Record<string, unknown>;
    }>;
    count: number;
  }>(`/api/audit${suffix}`);
  return {
    entries: res.entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      action: e.action,
      category: e.category,
      details: e.details,
      metadata: e.metadata,
    })),
    total: res.count ?? res.entries.length,
  };
}

export async function getAuditStats(): Promise<AuditStats> {
  const res = await request<{
    total_entries: number;
    by_category?: Record<string, number>;
    configChanges?: number;
    stepsVisited?: number;
  }>('/api/audit/stats');
  return {
    totalEntries: res.total_entries ?? 0,
    configChanges: res.by_category?.config ?? res.configChanges ?? 0,
    stepsVisited: res.by_category?.navigation ?? res.stepsVisited ?? 0,
  };
}

export async function exportAuditLog(format?: 'json' | 'csv' | 'text'): Promise<string> {
  const qs = format ? `?format=${format}` : '';
  const res = await request<{ content: string }>(`/api/audit/export${qs}`);
  return res.content;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export async function getBackups(): Promise<BackupManifest[]> {
  const res = await request<{
    backups: Array<{
      id: string;
      name: string;
      timestamp: number;
      version: string;
      contents: string[];
      size_bytes: number;
    }>;
  }>('/api/backups');
  return (res.backups ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    timestamp: b.timestamp,
    version: b.version,
    contents: b.contents,
    sizeBytes: b.size_bytes,
  }));
}

export async function createBackup(data: {
  name: string;
  config: DeploymentConfig;
}): Promise<BackupManifest> {
  const raw = await request<Record<string, unknown>>('/api/backups', {
    method: 'POST',
    body: JSON.stringify({ name: data.name, config: data.config }),
  });
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    timestamp: Number(raw.timestamp ?? 0),
    version: String(raw.version ?? ''),
    contents: Array.isArray(raw.contents) ? (raw.contents as string[]) : [],
    sizeBytes: Number(raw.size_bytes ?? 0),
  };
}

export async function getBackup(id: string): Promise<unknown> {
  return request(`/api/backups/${id}`);
}

export async function deleteBackup(id: string): Promise<void> {
  await request(`/api/backups/${id}`, { method: 'DELETE' });
}

export async function restoreBackup(id: string): Promise<DeploymentConfig> {
  const res = await request<{ config?: DeploymentConfig }>(`/api/backups/${id}/restore`, {
    method: 'POST',
  });
  if (!res.config) throw new Error('Backup restore did not return config');
  return res.config as DeploymentConfig;
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export async function generateCertificate(
  hostnames: string[]
): Promise<{ ca_pem: string; cert_pem: string; key_pem: string }> {
  const res = await request<{
    ca_cert: string;
    server_cert: string;
    server_key: string;
  }>('/api/certificates/generate', {
    method: 'POST',
    body: JSON.stringify({ hostnames }),
  });
  return {
    ca_pem: res.ca_cert,
    cert_pem: res.server_cert,
    key_pem: res.server_key,
  };
}

export async function validateCertificate(data: {
  cert_pem: string;
  key_pem?: string;
  ca_pem?: string;
}): Promise<CertificateValidation> {
  const res = await request<{
    is_valid: boolean;
    errors: string[];
    warnings: string[];
  }>('/api/certificates/validate', {
    method: 'POST',
    body: JSON.stringify({
      cert_pem: data.cert_pem,
      key_pem: data.key_pem,
      ca_pem: data.ca_pem,
    }),
  });
  return {
    isValid: res.is_valid,
    errors: res.errors ?? [],
    warnings: res.warnings ?? [],
  };
}

export async function getCertificateInfo(pem: string): Promise<CertificateInfo> {
  const res = await request<{
    subject: Record<string, string>;
    issuer: Record<string, string>;
    not_before: string;
    not_after: string;
    is_expired: boolean;
    is_self_signed: boolean;
    san_names: string[];
    key_algorithm: string;
    key_size: number;
    fingerprint_sha256: string;
  }>('/api/certificates/info', {
    method: 'POST',
    body: JSON.stringify({ cert_pem: pem }),
  });
  return {
    subject: res.subject ?? {},
    issuer: res.issuer ?? {},
    notBefore: res.not_before,
    notAfter: res.not_after,
    isExpired: res.is_expired,
    isSelfSigned: res.is_self_signed,
    sanNames: res.san_names ?? [],
    keyAlgorithm: res.key_algorithm ?? '',
    keySize: res.key_size ?? 0,
    fingerprint: res.fingerprint_sha256 ?? '',
  };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export async function getDeploySnapshots(sessionId: string): Promise<DeploymentSnapshot[]> {
  const res = await request<{
    snapshots: Array<{
      id: string;
      session_id: string;
      phase: string;
      timestamp: number;
      status: string;
    }>;
  }>(`/api/deploy/${sessionId}/snapshots`);
  return (res.snapshots ?? []).map((s) => ({
    id: s.id,
    sessionId: s.session_id,
    phase: s.phase,
    timestamp: s.timestamp,
    status: s.status,
  }));
}

export async function rollbackDeploy(sessionId: string): Promise<void> {
  await request(`/api/deploy/${sessionId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function retryDeployPhase(
  sessionId: string,
  phase: string,
  config?: DeploymentConfig
): Promise<{ newSessionId: string }> {
  const res = await request<{ new_session_id: string }>(
    `/api/deploy/${sessionId}/retry/${phase}`,
    {
      method: 'POST',
      body: JSON.stringify({ config: config ?? {} }),
    }
  );
  return { newSessionId: res.new_session_id };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function getNotificationConfig(): Promise<NotificationConfig> {
  const res = await request<{
    webhook_url: string;
    enabled: boolean;
    events: string[];
  }>('/api/notifications/config');
  return {
    webhookUrl: res.webhook_url ?? '',
    enabled: res.enabled ?? false,
    events: res.events ?? [],
  };
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<void> {
  await request('/api/notifications/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function testNotification(): Promise<{ success: boolean }> {
  const res = await request<{ delivered: boolean }>('/api/notifications/test', {
    method: 'POST',
  });
  return { success: res.delivered ?? false };
}

export async function getNotificationHistory(): Promise<Notification[]> {
  const res = await request<{
    notifications: Array<{
      id: string;
      event: string;
      timestamp: number;
      title: string;
      message: string;
      severity: string;
      delivered?: boolean;
      delivery_error?: string;
    }>;
  }>('/api/notifications/history');
  return (res.notifications ?? []).map((n) => ({
    id: n.id,
    event: n.event,
    timestamp: n.timestamp,
    title: n.title,
    message: n.message,
    severity: n.severity,
    delivered: n.delivered,
    delivery_error: n.delivery_error,
  }));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function generateReport(
  type: 'pre-deploy' | 'post-deploy' | 'config' | 'health',
  config: DeploymentConfig
): Promise<string> {
  const res = await request<{ report: string }>('/api/reports/generate', {
    method: 'POST',
    body: JSON.stringify({ type, config }),
  });
  return res.report;
}

// ---------------------------------------------------------------------------
// Validation (extended)
// ---------------------------------------------------------------------------

export async function validateConfig(config: DeploymentConfig): Promise<ValidationReport> {
  const res = await request<{
    valid: boolean;
    errors: Array<{
      field: string;
      message: string;
      severity: string;
      category: string;
      fix_suggestion?: string;
    }>;
    warnings: unknown[];
    score: number;
  }>('/api/config/validate', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
  return {
    valid: res.valid,
    errors: (res.errors ?? []).map((e) => ({
      field: e.field,
      message: e.message,
      severity: e.severity,
      category: e.category,
      fixSuggestion: e.fix_suggestion,
    })),
    warnings: res.warnings ?? [],
    score: res.score ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Preflight, Inventory, Deploy (existing)
// ---------------------------------------------------------------------------

export interface PrepareAction {
  command: string;
  description: string;
  status: 'running' | 'success' | 'failed';
  output?: string;
}

export interface PrepareResult {
  success: boolean;
  actions: PrepareAction[];
  errors: string[];
}

export interface SSHVerifyResult {
  connected: boolean;
  hostname: string;
  os: string;
  error: string;
  latency_ms: number;
}

export async function verifySSH(
  target: { host: string; user: string; password: string; port: number },
): Promise<SSHVerifyResult> {
  return request<SSHVerifyResult>('/api/ssh/verify', {
    method: 'POST',
    body: JSON.stringify({
      target_host: target.host,
      target_user: target.user,
      target_password: target.password,
      target_ssh_port: target.port,
    }),
  }, 20_000);
}

export interface PortCheckResult {
  port: number;
  open: boolean;
  status: string;
  service: string;
}

export async function checkPorts(
  target: { host: string; user: string; password: string; port: number },
  ports: number[],
): Promise<{ results: PortCheckResult[] }> {
  return request<{ results: PortCheckResult[] }>('/api/ports/check', {
    method: 'POST',
    body: JSON.stringify({
      target_host: target.host,
      target_user: target.user,
      target_password: target.password,
      target_ssh_port: target.port,
      ports,
    }),
  }, 30_000);
}

export interface AIDiagnosis {
  diagnosis: string;
  commands: string[];
  available: boolean;
}

export async function diagnoseError(
  errorLogs: string,
  config?: Record<string, unknown>,
  sessionId?: string,
): Promise<AIDiagnosis> {
  return request<AIDiagnosis>('/api/ai/diagnose', {
    method: 'POST',
    body: JSON.stringify({
      error_logs: errorLogs,
      config: config || null,
      session_id: sessionId || '',
    }),
  }, 60_000);
}

export async function runPreflight(
  hosts: HostInfo[],
  topology: Topology,
  installationType: InstallationType,
  target?: { host: string; user: string; password: string; port: number },
) {
  return request<PreflightResult>('/api/preflight', {
    method: 'POST',
    body: JSON.stringify({
      hosts,
      topology,
      installation_type: installationType,
      target_host: target?.host || '',
      target_user: target?.user || 'aap',
      target_password: target?.password || '',
      target_ssh_port: target?.port || 22,
    }),
  }, 120_000);
}

export async function prepareHost(
  target: { host: string; user: string; password: string; port: number },
  fixItems: string[] = ['all'],
) {
  return request<PrepareResult>('/api/prepare', {
    method: 'POST',
    body: JSON.stringify({
      target_host: target.host,
      target_user: target.user,
      target_password: target.password,
      target_ssh_port: target.port,
      fix_items: fixItems,
    }),
  }, 300_000);
}

export interface PrepareStreamEvent {
  type: 'steps' | 'start' | 'complete' | 'done';
  id?: string;
  index?: number;
  label?: string;
  status?: string;
  output?: string;
  success?: boolean;
  errors?: string[];
  steps?: Array<{ id: string; label: string }>;
}

/**
 * Stream host preparation via SSE. Calls onEvent for each server-sent event,
 * giving real-time feedback as each action completes.
 */
export async function prepareHostStream(
  target: { host: string; user: string; password: string; port: number },
  fixItems: string[] = ['all'],
  onEvent: (event: PrepareStreamEvent) => void,
): Promise<void> {
  const token = getStoredToken();
  const base = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
  const res = await fetch(`${base}/api/prepare/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      target_host: target.host,
      target_user: target.user,
      target_password: target.password,
      target_ssh_port: target.port,
      fix_items: fixItems,
    }),
  });

  if (!res.ok) {
    throw new Error(`Prepare stream failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as PrepareStreamEvent;
          onEvent(event);
        } catch { /* ignore parse errors */ }
      }
    }
  }
}

export async function generateInventory(config: DeploymentConfig) {
  return request<{ inventory: string }>('/api/inventory/generate', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

export async function generateCRYaml(config: DeploymentConfig) {
  return request<{ yaml: string }>('/api/ocp/cr/generate', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

export async function validateInventory(config: DeploymentConfig) {
  return request<{ valid: boolean; errors: string[] }>('/api/inventory/validate', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

export async function startDeploy(config: DeploymentConfig) {
  if (config.platform === 'openshift') {
    return request<{ session_id: string }>('/api/ocp/deploy/start', {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
  }
  return request<{ session_id: string }>('/api/deploy/start', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getDeployStatus(sessionId: string) {
  const isOCP = sessionId.startsWith('ocp-');
  const base = isOCP ? '/api/ocp/deploy' : '/api/deploy';
  return request<DeployStatus>(`${base}/${sessionId}/status`);
}

export async function cancelDeploy(sessionId: string) {
  const base = sessionId.startsWith('ocp-') ? '/api/ocp/deploy' : '/api/deploy';
  return request<{ status: string }>(`${base}/${sessionId}/cancel`, {
    method: 'POST',
  });
}

export interface WsCallbacks {
  onMessage: (data: unknown) => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export function connectDeployWebSocket(sessionId: string, callbacks: WsCallbacks): WebSocket {
  const token = getStoredToken() || '';
  let wsUrl: string;
  if (window.location.protocol === 'file:') {
    // Electron desktop mode — connect to local backend
    wsUrl = `ws://127.0.0.1:8000/ws/deploy/${sessionId}?token=${encodeURIComponent(token)}`;
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${window.location.host}/ws/deploy/${sessionId}?token=${encodeURIComponent(token)}`;
  }
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    callbacks.onMessage({ type: 'ws_connected' });
  };

  ws.onmessage = (event) => {
    try {
      callbacks.onMessage(JSON.parse(event.data));
    } catch {
      callbacks.onMessage({ type: 'raw', data: event.data });
    }
  };

  ws.onerror = () => {
    callbacks.onError('WebSocket connection error — deployment log stream lost');
  };

  ws.onclose = (event) => {
    if (event.code !== 1000) {
      callbacks.onError(
        `Connection closed unexpectedly (code ${event.code}). Checking deployment status...`
      );
    }
    callbacks.onClose();
  };

  return ws;
}

// ---------------------------------------------------------------------------
// AI Settings
// ---------------------------------------------------------------------------

export interface AISettingsStatus {
  configured: boolean;
  endpoint: string;
  model: string;
  key_set: boolean;
}

export async function getAISettings(): Promise<AISettingsStatus> {
  return request<AISettingsStatus>('/api/settings/ai');
}

export async function saveAISettings(endpoint: string, apiKey: string, model: string = 'gpt-4o') {
  return request<{ success: boolean; configured: boolean }>('/api/settings/ai', {
    method: 'POST',
    body: JSON.stringify({ endpoint, api_key: apiKey, model }),
  });
}

export async function clearAISettings() {
  return request<{ success: boolean; configured: boolean }>('/api/settings/ai', {
    method: 'DELETE',
  });
}

export async function getAIStatus(): Promise<{ available: boolean }> {
  return request<{ available: boolean }>('/api/ai/status');
}
