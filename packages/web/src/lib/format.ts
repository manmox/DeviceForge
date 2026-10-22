export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

export function formatUptime(startedAt: number | undefined): string {
  if (!startedAt) return '—';
  return formatDuration(Date.now() - startedAt);
}

export function hexToBytes(hex: string): number[] {
  const normalized = hex.replace(/\s+/g, '');
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    return [];
  }
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function summarizeDecoded(decoded: Record<string, unknown> | undefined): string {
  if (!decoded) return '';
  if (typeof decoded._summary === 'string' && decoded._summary.length > 0) {
    return decoded._summary;
  }

  const entries = Object.entries(decoded).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0) return '';
  const summary = entries.map(([key, value]) => `${key}=${formatValue(value)}`).join('  ');
  return summary.length > 140 ? `${summary.slice(0, 137)}...` : summary;
}
