import { useEffect, useState } from 'react';
import { Plug, Unplug } from 'lucide-react';
import { formatBytes, formatDuration, formatTime } from '../lib/format';
import { useAppStore } from '../store';

export function ConnectionsPanel() {
  const device = useAppStore((state) => state.device);
  const connections = useAppStore((state) => state.connections);
  const disconnect = useAppStore((state) => state.disconnect);

  const [now, setNow] = useState(Date.now());
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!device) return null;

  const endpoint =
    device.status.endpoints[0] ??
    `${device.config.transport.host}:${device.config.transport.port}`;

  async function handleDisconnect(connectionId: string) {
    setDisconnecting(connectionId);
    await disconnect(device!.config.id, connectionId);
    setDisconnecting(null);
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-mist-100">客户端连接</h3>
            <p className="mt-0.5 font-mono text-[11px] text-mist-500">{endpoint}</p>
          </div>
          <span className="chip">{connections.length}</span>
        </div>

        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <Plug className="h-5 w-5 text-mist-500" />
            </div>
            <h4 className="mt-3 text-sm font-medium text-mist-200">暂无连接</h4>
            <p className="mt-1.5 max-w-sm text-xs leading-5 text-mist-500">
              让上位机连接 {endpoint} 后，连接会出现在这里。你可以查看收发字节数并手动断开。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-mist-500">
                <tr>
                  <th className="px-4 py-2 font-medium">客户端</th>
                  <th className="px-4 py-2 font-medium">建立时间</th>
                  <th className="px-4 py-2 font-medium">时长</th>
                  <th className="px-4 py-2 font-medium">接收</th>
                  <th className="px-4 py-2 font-medium">发送</th>
                  <th className="px-4 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {connections.map((connection) => (
                  <tr key={connection.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[12px] text-mist-200">
                        {connection.remoteAddress ?? 'unknown'}:
                        {connection.remotePort ?? '?'}
                      </div>
                      <div
                        className="mt-0.5 font-mono text-[10px] text-mist-600"
                        title={connection.id}
                      >
                        {connection.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-mist-400">
                      {formatTime(connection.connectedAt)}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-mist-400">
                      {formatDuration(now - connection.connectedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-mist-400">
                      {formatBytes(connection.rxBytes)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-mist-400">
                      {formatBytes(connection.txBytes)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleDisconnect(connection.id)}
                        disabled={disconnecting === connection.id}
                      >
                        <Unplug className="h-3.5 w-3.5" />
                        {disconnecting === connection.id ? '断开中…' : '断开'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
