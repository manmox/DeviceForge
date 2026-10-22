import { Activity, Braces, Check, Clock, Loader2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useJsonDraft } from '../hooks/useJsonDraft';
import { formatBytes, formatUptime } from '../lib/format';
import {
  transportEndpoint,
  transportPresentation,
} from '../lib/transport-presentation';
import { useAppStore } from '../store';
import type { DeviceDetail } from '../types';
import { CodeEditor } from './CodeEditor';
import { EditorModeToggle } from './form/EditorModeToggle';
import { VisualJsonEditor } from './form/VisualJsonEditor';

export function StatePanel({ device }: { device: DeviceDetail }) {
  const saveState = useAppStore((state) => state.saveState);
  const showToast = useAppStore((state) => state.showToast);

  const stateJson = JSON.stringify(device.state, null, 2);
  const draft = useJsonDraft(device.state, 'state', {
    baseline: device.state,
    baselineKey: stateJson,
    noun: '状态',
  });

  const [saving, setSaving] = useState(false);
  const [liveChanged, setLiveChanged] = useState(false);
  const lastLiveRef = useRef(stateJson);
  const deviceIdRef = useRef(device.config.id);

  useEffect(() => {
    if (deviceIdRef.current === device.config.id) return;
    deviceIdRef.current = device.config.id;
    lastLiveRef.current = stateJson;
    draft.load(device.state);
    setLiveChanged(false);
  }, [device.config.id, device.state, stateJson, draft.load]);

  useEffect(() => {
    if (lastLiveRef.current === stateJson) return;
    lastLiveRef.current = stateJson;
    if (draft.dirty) setLiveChanged(true);
  }, [stateJson, draft.dirty]);

  async function handleSave() {
    const value = draft.mode === 'visual' ? draft.value : draft.parseText();
    if (!value) return;

    setSaving(true);
    const ok = await saveState(device.config.id, value);
    setSaving(false);
    if (ok) {
      draft.markSaved();
      setLiveChanged(false);
    }
  }

  function handleReset() {
    draft.reset();
    setLiveChanged(false);
    showToast('已恢复为当前实时状态', 'info');
  }

  const counters = device.status.counters;
  const presentation = transportPresentation(device.config.transport.type);
  const endpoint = transportEndpoint(
    device.config.transport,
    device.status.endpoints,
  );

  const stats = [
    {
      icon: Clock,
      label: '运行时长',
      value: formatUptime(device.status.startedAt),
      accent: 'text-sky-400',
    },
    {
      icon: Activity,
      label: presentation.connectionStatLabel,
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
            <EditorModeToggle
              mode={draft.mode}
              onChange={(mode) => {
                draft.switchMode(mode);
              }}
              codeLabel="JSON 源码"
              disabled={saving}
            />
            <span
              className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
                draft.dirty
                  ? 'border-sky-400/20 bg-sky-400/[0.07] text-sky-300'
                  : 'border-accent-500/20 bg-accent-500/[0.07] text-accent-300'
              }`}
            >
              {draft.dirty ? '未保存' : '实时同步'}
            </span>
            {draft.dirty && liveChanged && (
              <span className="rounded-md border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 text-[10.5px] text-amber-300">
                实时状态已更新
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleReset}
                disabled={!draft.dirty || saving}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleSave()}
                disabled={!draft.dirty || saving}
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

          {draft.mode === 'visual' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <VisualJsonEditor
                value={draft.value}
                onChange={draft.updateValue}
                keyPlaceholder="变量名"
                addLabel="添加变量"
                emptyText="暂无状态变量"
                templates={false}
                disabled={saving}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <CodeEditor
                value={draft.text}
                onChange={draft.updateText}
                language="json"
                borderless
                readOnly={saving}
                ariaLabel="状态 JSON 源码"
              />
            </div>
          )}

          {draft.error && (
            <div className="shrink-0 border-t border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-200">
              {draft.error}
            </div>
          )}

          <div className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[10px] text-mist-500">
            保存会替换整个状态对象；编辑期间规则产生的其他状态更新会被当前草稿覆盖。
          </div>
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
            <div className="text-[10.5px] text-mist-500">
              {presentation.endpointLabel}
            </div>
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
