import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useAppStore } from '../store';
import type { FaultAction, FaultInjectionConfig, FaultRule } from '../types';

function newRule(): FaultRule {
  return {
    id: crypto.randomUUID(),
    name: '新故障规则',
    enabled: false,
    direction: 'both',
    trigger: { type: 'probability', percent: 100 },
    action: { type: 'drop' },
  };
}

function actionLabel(action: FaultAction['type']): string {
  return {
    delay: '延迟',
    drop: '丢弃',
    disconnect: '断开连接',
    corrupt: '随机翻转 1 bit',
  }[action];
}

export function FaultInjectionPanel() {
  const device = useAppStore((state) => state.device);
  const showToast = useAppStore((state) => state.showToast);
  const refreshDevices = useAppStore((state) => state.refreshDevices);
  const [draft, setDraft] = useState<FaultInjectionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const deviceId = device?.config.id;
  const faultInjectionJson = device
    ? JSON.stringify(device.config.faultInjection)
    : undefined;

  useEffect(() => {
    if (faultInjectionJson) setDraft(JSON.parse(faultInjectionJson) as FaultInjectionConfig);
  }, [deviceId, faultInjectionJson]);

  const dirty = useMemo(
    () => Boolean(device && draft && JSON.stringify(draft) !== JSON.stringify(device.config.faultInjection)),
    [device, draft],
  );

  if (!device || !draft) return null;

  const currentDeviceId = device.config.id;
  const running = device.status.state === 'running';
  const enabled = device.status.faultInjectionEnabled;
  const activeRules = draft.rules.filter((rule) => rule.enabled).length;

  function updateRule(index: number, patch: Partial<FaultRule>) {
    setDraft((current) => current && ({
      ...current,
      rules: current.rules.map((rule, itemIndex) =>
        itemIndex === index ? { ...rule, ...patch } : rule,
      ),
    }));
  }

  async function saveRules() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.updateFaultInjectionRules(currentDeviceId, draft);
      await refreshDevices();
      showToast('故障规则已保存并热更新', 'success');
    } catch (error) {
      showToast(`保存故障规则失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleInjection() {
    setToggling(true);
    try {
      await api.setFaultInjectionEnabled(currentDeviceId, !enabled);
      await refreshDevices();
    } catch (error) {
      showToast(`切换故障注入失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <section className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/[0.08] text-amber-300">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-mist-100">故障注入</h2>
            <p className="mt-0.5 text-[11px] text-mist-500">
              TCP 按字节流分段，MQTT 按 PUBLISH 载荷处理。停止设备后注入自动关闭。
            </p>
          </div>
          <button
            className={`btn ${enabled ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => void toggleInjection()}
            disabled={!running || toggling || (!enabled && activeRules === 0)}
          >
            {enabled ? '停止注入' : '启用注入'}
          </button>
          <span className={`chip ${enabled ? 'text-amber-300' : ''}`}>
            {enabled ? '运行中' : running ? '已关闭' : '设备未运行'}
          </span>
        </section>

        <section className="panel p-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-white/10 pb-4">
            <label className="block w-44">
              <span className="mb-1 block text-[10.5px] text-mist-500">TCP 分段长度（字节）</span>
              <input
                className="field h-9 font-mono text-xs"
                type="number"
                min={1}
                max={65_536}
                value={draft.segmentSizeBytes}
                onChange={(event) => setDraft({
                  ...draft,
                  segmentSizeBytes: Number(event.target.value),
                })}
              />
            </label>
            <p className="max-w-xl text-[10.5px] leading-5 text-mist-500">
              不足一段的数据在 5 毫秒空闲后处理。MQTT 不使用 TCP 分段设置。
            </p>
            <button
              className="btn btn-ghost btn-sm ml-auto"
              onClick={() => setDraft({ ...draft, rules: [...draft.rules, newRule()] })}
            >
              <Plus className="h-3.5 w-3.5" />
              新增规则
            </button>
          </div>

          {draft.rules.length === 0 ? (
            <div className="py-12 text-center text-xs text-mist-500">尚无故障规则</div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {draft.rules.map((rule, index) => (
                <article key={rule.id} className="rounded-xl border border-white/10 bg-ink-950/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="field h-8 min-w-[180px] flex-1 text-xs"
                      aria-label="规则名称"
                      value={rule.name}
                      onChange={(event) => updateRule(index, { name: event.target.value })}
                    />
                    <label className="inline-flex items-center gap-2 text-[11px] text-mist-400">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                      />
                      启用规则
                    </label>
                    <button
                      className="btn btn-ghost btn-sm text-rose-300"
                      title="删除规则"
                      onClick={() => setDraft({
                        ...draft,
                        rules: draft.rules.filter((_, itemIndex) => itemIndex !== index),
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <label>
                      <span className="mb-1 block text-[10px] text-mist-500">方向</span>
                      <select
                        className="field h-9 text-xs"
                        value={rule.direction}
                        onChange={(event) => updateRule(index, {
                          direction: event.target.value as FaultRule['direction'],
                        })}
                      >
                        <option value="both">双向</option>
                        <option value="in">入站</option>
                        <option value="out">出站</option>
                      </select>
                    </label>

                    <label>
                      <span className="mb-1 block text-[10px] text-mist-500">触发方式</span>
                      <select
                        className="field h-9 text-xs"
                        value={rule.trigger.type === 'probability' ? 'probability' : rule.trigger.mode}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === 'probability') {
                            updateRule(index, { trigger: { type: 'probability', percent: 10 } });
                          } else if (value === 'indices') {
                            updateRule(index, { trigger: { type: 'sequence', mode: 'indices', indices: [1] } });
                          } else {
                            updateRule(index, { trigger: { type: 'sequence', mode: 'every', interval: 2 } });
                          }
                        }}
                      >
                        <option value="probability">概率</option>
                        <option value="indices">指定序号</option>
                        <option value="every">每 N 包</option>
                      </select>
                    </label>

                    <label>
                      <span className="mb-1 block text-[10px] text-mist-500">触发参数</span>
                      {rule.trigger.type === 'probability' ? (
                        <div className="relative">
                          <input
                            className="field h-9 pr-8 font-mono text-xs"
                            type="number"
                            min={0}
                            max={100}
                            value={rule.trigger.percent}
                            onChange={(event) => updateRule(index, {
                              trigger: { type: 'probability', percent: Number(event.target.value) },
                            })}
                          />
                          <span className="absolute right-3 top-2.5 text-[10px] text-mist-500">%</span>
                        </div>
                      ) : rule.trigger.mode === 'every' ? (
                        <input
                          className="field h-9 font-mono text-xs"
                          type="number"
                          min={1}
                          value={rule.trigger.interval}
                          onChange={(event) => updateRule(index, {
                            trigger: { type: 'sequence', mode: 'every', interval: Number(event.target.value) },
                          })}
                        />
                      ) : (
                        <input
                          className="field h-9 font-mono text-xs"
                          aria-label="指定包序号"
                          value={rule.trigger.indices.join(', ')}
                          onChange={(event) => updateRule(index, {
                            trigger: {
                              type: 'sequence',
                              mode: 'indices',
                              indices: event.target.value
                                .split(',')
                                .map((item) => Number(item.trim()))
                                .filter((item) => Number.isInteger(item) && item > 0),
                            },
                          })}
                        />
                      )}
                    </label>

                    <label>
                      <span className="mb-1 block text-[10px] text-mist-500">动作</span>
                      <select
                        className="field h-9 text-xs"
                        value={rule.action.type}
                        onChange={(event) => {
                          const type = event.target.value as FaultAction['type'];
                          const action: FaultAction = type === 'delay'
                            ? { type, delayMs: 100 }
                            : { type };
                          updateRule(index, { action });
                        }}
                      >
                        <option value="delay">延迟</option>
                        <option value="drop">丢弃</option>
                        <option value="disconnect">断开连接</option>
                        <option value="corrupt">随机翻转 1 bit</option>
                      </select>
                    </label>
                  </div>

                  {rule.action.type === 'delay' && (
                    <label className="mt-2 block max-w-[220px]">
                      <span className="mb-1 block text-[10px] text-mist-500">延迟（毫秒）</span>
                      <input
                        className="field h-9 font-mono text-xs"
                        type="number"
                        min={1}
                        max={300_000}
                        value={rule.action.delayMs}
                        onChange={(event) => updateRule(index, {
                          action: { type: 'delay', delayMs: Number(event.target.value) },
                        })}
                      />
                    </label>
                  )}
                  <p className="mt-2 text-[10px] text-mist-600">
                    当前动作：{actionLabel(rule.action.type)}；指定序号按连接和方向分别计数。
                  </p>
                </article>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
            <span className="text-[10.5px] text-mist-500">
              规则按列表顺序执行，每段或每条 MQTT 消息只应用首条命中规则。
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => void saveRules()} disabled={!dirty || saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中…' : '保存并热更新'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
