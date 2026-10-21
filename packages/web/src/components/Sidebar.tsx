import { Cpu, Plus, Wifi, WifiOff, X } from 'lucide-react';
import { useAppStore } from '../store';
import type { DeviceSummary } from '../types';
import { StatusBadge } from './StatusBadge';

function endpointOf(device: DeviceSummary): string {
  return (
    device.status.endpoints[0] ??
    `${device.config.transport.host}:${device.config.transport.port}`
  );
}

export function Sidebar({
  open,
  onClose,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  onNew: () => void;
}) {
  const devices = useAppStore((state) => state.devices);
  const selectedId = useAppStore((state) => state.selectedId);
  const selectDevice = useAppStore((state) => state.selectDevice);
  const wsConnected = useAppStore((state) => state.wsConnected);
  const initializing = useAppStore((state) => state.initializing);

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[292px] shrink-0 flex-col border-r border-white/10 bg-ink-900/95 backdrop-blur-xl transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent-500/25 bg-accent-500/10">
            <Cpu className="h-5 w-5 text-accent-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold tracking-tight text-mist-100">
              DeviceForge
            </div>
            <div className="text-[11px] text-mist-500">设备仿真工作台</div>
          </div>
          <button
            className="btn btn-ghost rounded-lg p-1.5 lg:hidden"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <button className="btn btn-primary w-full" onClick={onNew}>
            <Plus className="h-4 w-4" />
            新建设备
          </button>
        </div>

        <div className="flex items-center justify-between px-5 pb-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mist-500">
            设备
          </span>
          <span className="text-[11px] text-mist-500">{devices.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          {initializing && devices.length === 0 ? (
            <div className="space-y-2 px-2">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-[58px] animate-pulse rounded-lg border border-white/5 bg-white/[0.03]"
                />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <div className="mx-2 rounded-lg border border-dashed border-white/10 px-3 py-6 text-center">
              <p className="text-xs leading-5 text-mist-500">
                还没有设备。
                <br />
                从预设或空白配置开始。
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {devices.map((device) => {
                const selected = device.config.id === selectedId;
                const connectionCount = device.status.connections.length;
                return (
                  <button
                    key={device.config.id}
                    className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    }`}
                    onClick={() => {
                      void selectDevice(device.config.id);
                      onClose();
                    }}
                  >
                    {selected && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-400" />
                    )}
                    <span className="mt-1.5 shrink-0">
                      <StatusBadge state={device.status.state} compact />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] font-medium ${
                          selected ? 'text-mist-100' : 'text-mist-300'
                        }`}
                      >
                        {device.config.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-mist-500">
                        <span className="truncate">{endpointOf(device)}</span>
                        {connectionCount > 0 && (
                          <span className="shrink-0 rounded bg-accent-500/10 px-1 text-[10px] text-accent-300">
                            {connectionCount} 连接
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2 text-[11px]">
            {wsConnected ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-accent-400" />
                <span className="text-mist-400">控制面已连接</span>
                <span className="ml-auto flex items-center gap-1 text-accent-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
                  live
                </span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-mist-400">正在重连…</span>
              </>
            )}
          </div>
          <div className="mt-1.5 text-[10.5px] text-mist-500">
            v0.1.0 · 仅绑定本机 127.0.0.1
          </div>
        </div>
      </aside>
    </>
  );
}
