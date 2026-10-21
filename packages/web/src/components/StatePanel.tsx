import { useEffect, useState } from 'react';
import { Activity, Braces, Check, Clock, Loader2, RotateCcw, Save } from 'lucide-react';
import { formatBytes, formatUptime } from '../lib/format';
import { useAppStore } from '../store';
import type { DeviceDetail } from '../types';

export function StatePanel({ device }: { device: DeviceDetail }) {
  const saveState = useAppStore((state) => state.saveState);
  const showToast = useAppStore((state) => state.showToast);

  const stateJson = JSON.stringify(device.state, null, 2);
  const [text, setText] = useState(stateJson);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setText(stateJson);
  }, [stateJson, dirty]);

  const counters = device.status.counters;
  const endpoint =
    device.status.endpoints[0] ??
    `${device.config.transport.host}:${device.config.transport.port}`;

  async function handleSave() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      setError(
        `JSON 解析失败：${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('状态必须是一个 JSON 对象');
      return;
    }

    setSaving(true);
    const ok = await saveState(device.config.id, parsed as Record<string, unknown>);
    setSaving(false);
    if (ok) setDirty(false);
  }

  function handleReset() {
    setText(stateJson);
    setDirty(false);
    setError(null);
    showToast('已恢复为当前实时状态', 'info');
  }

  const stats = [
    {
      icon: Clock,
      label: '运行时长',
      value: formatUptime(device.status.startedAt),
      accent: 'text-sky-400',
    },
    {
      icon: Activity,
      label: '客户端连接',
      value: String(device.status.connections.length),
      accent: 'text-accent-400',
    },
    {
      icon: Braces,
      label: '接收',
      value: `${formatBytes(counters.rxBytes)} · ${counters.rxFrames} 帧`,
      accent: 'text-accent-400',
    },
    {
      icon: Braces,
      label: '发送',
      value: `${formatBytes(counters.txBytes)} · ${counters.txFrames} 帧`,
      accent: 'text-sky-400',
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="panel flex min-h-[440px] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <span className="text-xs font-medium text-mist-200">状态变量</span>
            <span
              className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
                dirty
                  ? 'border-sky-400/20 bg-sky-400/[0.07] text-sky-300'
                  : 'border-accent-500/20 bg-accent-500/[0.07] text-accent-300'
              }`}
            >
              {dirty ? '未保存' : '实时同步'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleReset}
                disabled={!dirty || saving}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                保存状态
              </button>
            </div>
          </div>

          <textarea
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-6 text-mist-200 outline-none"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
              setError(null);
            }}
            spellCheck={false}
          />

          {error && (
            <div className="shrink-0 border-t border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="panel px-3 py-3">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-mist-500">
                    <Icon className={`h-3.5 w-3.5 ${stat.accent}`} />
                    {stat.label}
                  </div>
                  <div className="mt-1.5 truncate font-mono text-sm text-mist-100">
                    {stat.value}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel px-3 py-3">
            <div className="text-[10.5px] text-mist-500">监听端点</div>
            <div className="mt-1 break-all font-mono text-xs text-mist-200">{endpoint}</div>
            <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-mist-500">
              <Check className="h-3.5 w-3.5 text-accent-400" />
              状态会在周期规则更新后实时同步
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-[11px] leading-5 text-mist-500">
            规则模板里用 <code className="kbd">$state.temp</code> 读取变量；
            用 <code className="kbd">set</code> 更新。这里的值也可以手动修改，
            用于构造异常或边界场景。
          </div>
        </div>
      </div>
    </div>
  );
}
