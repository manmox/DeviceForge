import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Braces,
  Copy,
  FileCode2,
  Loader2,
  History,
  Play,
  Plug,
  Radio,
  RotateCcw,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { ConfigPanel } from '../components/ConfigPanel';
import { ConnectionsPanel } from '../components/ConnectionsPanel';
import { FaultInjectionPanel } from '../components/FaultInjectionPanel';
import { RecordingPanel } from '../components/RecordingPanel';
import { deviceInfoHeaderValues } from '../lib/device-info';
import {
  transportEndpoint,
  transportPresentation,
} from '../lib/transport-presentation';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge, TransportBadge } from '../components/StatusBadge';
import { TrafficPanel } from '../components/TrafficPanel';
import { useAppStore } from '../store';
import type { DeviceDetail } from '../types';

type TabId = 'traffic' | 'faults' | 'recordings' | 'config' | 'connections' | 'state';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'traffic', label: '流量', icon: Radio },
  { id: 'faults', label: '故障注入', icon: Zap },
  { id: 'recordings', label: '录制回放', icon: History },
  { id: 'config', label: '配置', icon: FileCode2 },
  { id: 'connections', label: '连接', icon: Plug },
  { id: 'state', label: '状态', icon: Braces },
];

function initialTab(): TabId {
  const value = new URLSearchParams(window.location.search).get('tab');
  return value === 'config' || value === 'connections' || value === 'state' || value === 'faults' || value === 'recordings'
    ? value
    : 'traffic';
}

export function DeviceView({ device }: { device: DeviceDetail }) {
  const startDevice = useAppStore((state) => state.startDevice);
  const stopDevice = useAppStore((state) => state.stopDevice);
  const restartDevice = useAppStore((state) => state.restartDevice);
  const deleteDevice = useAppStore((state) => state.deleteDevice);
  const showToast = useAppStore((state) => state.showToast);
  const trafficCount = useAppStore((state) => state.traffic.length);

  const [tab, setTab] = useState<TabId>(initialTab);
  const [busy, setBusy] = useState(false);

  function selectTab(next: TabId) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'traffic') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

  const status = device.status;
  const isRunning = status.state === 'running';
  const canStart = status.state === 'stopped' || status.state === 'error';
  const presentation = transportPresentation(device.config.transport.type);
  const endpoint = transportEndpoint(device.config.transport, status.endpoints);
  const counts: Partial<Record<TabId, number>> = {
    traffic: trafficCount,
    connections: status.connections.length,
  };
  const identity = deviceInfoHeaderValues(device.config.deviceInfo);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    void navigator.clipboard
      .writeText(endpoint)
      .then(() => showToast(`${presentation.endpointLabel}已复制`, 'success'))
      .catch(() => showToast('复制失败，请检查浏览器权限', 'error'));
  }

  function handleDelete() {
    if (
      !window.confirm(
        `确定删除设备「${device.config.name}」吗？运行中的设备会先停止，相关配置将从本地移除。`,
      )
    ) {
      return;
    }
    void deleteDevice(device.config.id);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-white/10 px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-mist-100">
                {device.config.name}
              </h1>
              <StatusBadge state={status.state} />
              {(status.state === 'running' || status.state === 'starting') && (
                <TransportBadge status={status.transport} />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-mist-500">
              <span className="font-mono">{device.config.id}</span>
              <span className="text-mist-600">·</span>
              <button
                className="chip font-mono transition-colors hover:border-white/20 hover:text-mist-200"
                onClick={handleCopy}
                title={presentation.copyEndpointTitle}
              >
                <Radio className="h-3 w-3 text-accent-400" />
                {endpoint}
                <Copy className="h-3 w-3" />
              </button>
              {status.connections.length > 0 && (
                <span className="chip">
                  {status.connections.length} {presentation.connectionUnit}
                </span>
              )}
              {device.config.description && (
                <span className="hidden max-w-md truncate sm:inline">
                  {device.config.description}
                </span>
              )}
            </div>
            {identity.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-mist-500">
                {identity.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex min-w-0 items-center gap-1"
                    title={`${item.label} ${item.value}`}
                  >
                    <span className="shrink-0 text-mist-600">{item.label}</span>
                    <span className="max-w-[18rem] truncate font-mono text-mist-400">
                      {item.value}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {canStart ? (
              <button
                className="btn btn-primary"
                onClick={() => void run(() => startDevice(device.config.id))}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                启动
              </button>
            ) : (
              <button
                className="btn btn-outline"
                onClick={() => void run(() => stopDevice(device.config.id))}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                停止
              </button>
            )}

            <button
              className="btn btn-ghost"
              onClick={() => void run(() => restartDevice(device.config.id))}
              disabled={busy || !isRunning}
              title="重启设备"
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            <button
              className="btn btn-ghost text-mist-500 hover:text-rose-300"
              onClick={handleDelete}
              title="删除设备"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {status.state === 'error' && status.error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs leading-5 text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{status.error}</span>
          </div>
        )}

        {status.state === 'running' && status.transport.state === 'reconnecting' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs leading-5 text-amber-200">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 break-words">
              {presentation.isOutbound ? '上游连接已断开' : '连接已断开'}
              ，正在自动重连
              {status.transport.attempt
                ? `（第 ${status.transport.attempt} 次）`
                : ''}
              。设备仍在运行。
            </span>
          </div>
        )}

        {status.state === 'running' && status.transport.state === 'error' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs leading-5 text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              传输错误：{status.transport.error ?? '连接失败'}。设备仍在运行。
            </span>
          </div>
        )}

        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'text-mist-100'
                    : 'text-mist-500 hover:text-mist-300'
                }`}
                onClick={() => selectTab(item.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
                {count !== undefined && (
                  <span
                    className={`rounded px-1 font-mono text-[10px] ${
                      active
                        ? 'bg-white/10 text-mist-300'
                        : 'bg-white/5 text-mist-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-400" />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'traffic' && <TrafficPanel />}
        {tab === 'faults' && <FaultInjectionPanel />}
        {tab === 'recordings' && <RecordingPanel />}
        {tab === 'config' && <ConfigPanel device={device} />}
        {tab === 'connections' && <ConnectionsPanel />}
        {tab === 'state' && <StatePanel device={device} />}
      </div>
    </div>
  );
}
