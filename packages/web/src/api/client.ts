import type {
  ConnectionInfo,
  DeviceConfig,
  DeviceDetail,
  DeviceStatus,
  DeviceSummary,
  DictionaryInput,
  DictionarySummary,
  Preset,
  TrafficEvent,
  ValidationIssue,
} from '../types';

interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: ValidationIssue[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('无法连接到 DeviceForge 服务，请确认后端已启动', 0);
  }

  const text = await response.text();
  let data: unknown;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const body = (data ?? {}) as ApiErrorBody;
    const base = body.error ?? `请求失败 (${response.status})`;
    const detail = body.message ? `：${body.message}` : '';
    const issues = body.issues
      ?.map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
      .join('；');
    throw new ApiError(
      issues ? `${base}：${issues}` : `${base}${detail}`,
      response.status,
      body.issues,
    );
  }

  return data as T;
}

export interface SendPayload {
  connectionId?: string;
  target?: 'all' | 'last';
  message: { hex?: string; fields?: Record<string, unknown> };
}

export const api = {
  listDevices: () =>
    request<{ devices: DeviceSummary[] }>('/api/devices').then((result) => result.devices),

  getDevice: (id: string) =>
    request<DeviceDetail>(`/api/devices/${encodeURIComponent(id)}`),

  createDevice: (config: DeviceConfig) =>
    request<DeviceSummary>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  updateDevice: (id: string, config: DeviceConfig) =>
    request<DeviceSummary>(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  deleteDevice: (id: string) =>
    request<void>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  startDevice: (id: string) =>
    request<{ status: DeviceStatus }>(`/api/devices/${encodeURIComponent(id)}/start`, {
      method: 'POST',
    }),

  stopDevice: (id: string) =>
    request<{ status: DeviceStatus }>(`/api/devices/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),

  restartDevice: (id: string) =>
    request<{ status: DeviceStatus }>(`/api/devices/${encodeURIComponent(id)}/restart`, {
      method: 'POST',
    }),

  send: (id: string, payload: SendPayload) =>
    request<{ ok: true }>(`/api/devices/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getTraffic: (id: string, limit = 500) =>
    request<{ events: TrafficEvent[] }>(
      `/api/devices/${encodeURIComponent(id)}/traffic?limit=${limit}`,
    ).then((result) => result.events),

  clearTraffic: (id: string) =>
    request<{ ok: true }>(`/api/devices/${encodeURIComponent(id)}/traffic`, {
      method: 'DELETE',
    }),

  getState: (id: string) =>
    request<{ state: Record<string, unknown> }>(
      `/api/devices/${encodeURIComponent(id)}/state`,
    ).then((result) => result.state),

  setState: (id: string, state: Record<string, unknown>) =>
    request<{ state: Record<string, unknown> }>(
      `/api/devices/${encodeURIComponent(id)}/state`,
      { method: 'PUT', body: JSON.stringify({ state }) },
    ).then((result) => result.state),

  getConnections: (id: string) =>
    request<{ connections: ConnectionInfo[] }>(
      `/api/devices/${encodeURIComponent(id)}/connections`,
    ).then((result) => result.connections),

  disconnectConnection: (id: string, connectionId: string) =>
    request<{ ok: true }>(
      `/api/devices/${encodeURIComponent(id)}/connections/${encodeURIComponent(connectionId)}/disconnect`,
      { method: 'POST' },
    ),

  listPresets: () =>
    request<{ presets: Preset[] }>('/api/presets').then((result) => result.presets),

  listDictionaries: () =>
    request<{ dictionaries: DictionarySummary[] }>('/api/dictionaries').then(
      (result) => result.dictionaries,
    ),

  getDictionary: (id: string) =>
    request<{ dictionary: DictionarySummary }>(
      `/api/dictionaries/${encodeURIComponent(id)}`,
    ).then((result) => result.dictionary),

  createDictionary: (definition: DictionaryInput) =>
    request<{ dictionary: DictionarySummary }>('/api/dictionaries', {
      method: 'POST',
      body: JSON.stringify(definition),
    }).then((result) => result.dictionary),

  updateDictionary: (id: string, definition: DictionaryInput) =>
    request<{ dictionary: DictionarySummary }>(
      `/api/dictionaries/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(definition) },
    ).then((result) => result.dictionary),

  deleteDictionary: (id: string) =>
    request<void>(`/api/dictionaries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  validateYaml: (yaml: string) =>
    request<{ config: DeviceConfig }>('/api/config/validate', {
      method: 'POST',
      body: JSON.stringify({ yaml }),
    }).then((result) => result.config),

  validateConfig: (config: unknown) =>
    request<{ config: DeviceConfig }>('/api/config/validate', {
      method: 'POST',
      body: JSON.stringify({ config }),
    }).then((result) => result.config),
};
