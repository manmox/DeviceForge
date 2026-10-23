import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useAppStore } from '../store';
import {
  filterFaultRules,
  moveFaultRule,
  selectionAfterFaultRuleDelete,
  visibleFaultRuleSelection,
  type FaultRuleStatusFilter,
} from '../lib/fault-rules';
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

function actionSummary(rule: FaultRule): string {
  return rule.action.type === 'delay'
    ? `延迟 ${rule.action.delayMs} ms`
    : actionLabel(rule.action.type);
}

function directionLabel(direction: FaultRule['direction']): string {
  return { both: '双向', in: '入站', out: '出站' }[direction];
}

function triggerSummary(trigger: FaultRule['trigger']): string {
  if (trigger.type === 'probability') return `概率 ${trigger.percent}%`;
  if (trigger.mode === 'every') return `每 ${trigger.interval} 包`;
  return `序号 ${trigger.indices.join(', ')}`;
}

function FaultRuleEditor({
  rule,
  position,
  onChange,
  onDelete,
}: {
  rule: FaultRule;
  position?: number;
  onChange: (patch: Partial<FaultRule>) => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-ink-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {position !== undefined && (
          <span className="chip shrink-0 font-mono">优先级 {position}</span>
        )}
        <input
          className="field h-8 min-w-[180px] flex-1 text-xs"
          aria-label="规则名称"
          value={rule.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <label className="inline-flex items-center gap-2 text-[11px] text-mist-400">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          启用规则
        </label>
        <button
          className="btn btn-ghost btn-sm text-rose-300"
          title="删除规则"
          aria-label={`删除规则 ${rule.name}`}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        <label>
          <span className="mb-1 block text-[10px] text-mist-500">方向</span>
          <select
            className="field h-9 text-xs"
            value={rule.direction}
            onChange={(event) => onChange({
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
                onChange({ trigger: { type: 'probability', percent: 10 } });
              } else if (value === 'indices') {
                onChange({ trigger: { type: 'sequence', mode: 'indices', indices: [1] } });
              } else {
                onChange({ trigger: { type: 'sequence', mode: 'every', interval: 2 } });
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
                onChange={(event) => onChange({
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
              onChange={(event) => onChange({
                trigger: { type: 'sequence', mode: 'every', interval: Number(event.target.value) },
              })}
            />
          ) : (
            <input
              className="field h-9 font-mono text-xs"
              aria-label="指定包序号"
              value={rule.trigger.indices.join(', ')}
              onChange={(event) => onChange({
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
              onChange({ action });
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
            onChange={(event) => onChange({
              action: { type: 'delay', delayMs: Number(event.target.value) },
            })}
          />
        </label>
      )}
      <p className="mt-2 text-[10px] text-mist-600">
        当前动作：{actionLabel(rule.action.type)}；指定序号按连接和方向分别计数。
      </p>
    </article>
  );
}

export function FaultInjectionPanel() {
  const device = useAppStore((state) => state.device);
  const showToast = useAppStore((state) => state.showToast);
  const refreshDevices = useAppStore((state) => state.refreshDevices);
  const [draft, setDraft] = useState<FaultInjectionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FaultRuleStatusFilter>('all');

  const deviceId = device?.config.id;
  const faultInjectionJson = device
    ? JSON.stringify(device.config.faultInjection)
    : undefined;

  useEffect(() => {
    setSelectedRuleId(null);
    setSearchQuery('');
    setStatusFilter('all');
  }, [deviceId]);

  useEffect(() => {
    if (!faultInjectionJson) return;
    const nextDraft = JSON.parse(faultInjectionJson) as FaultInjectionConfig;
    setDraft(nextDraft);
    setSelectedRuleId((current) =>
      current && nextDraft.rules.some((rule) => rule.id === current)
        ? current
        : nextDraft.rules[0]?.id ?? null,
    );
  }, [deviceId, faultInjectionJson]);

  const rules = draft?.rules ?? [];
  const visibleRules = useMemo(
    () => filterFaultRules(rules, searchQuery, statusFilter),
    [rules, searchQuery, statusFilter],
  );
  const filtered = searchQuery.trim().length > 0 || statusFilter !== 'all';
  const effectiveSelectedRuleId = visibleFaultRuleSelection(selectedRuleId, visibleRules);

  useEffect(() => {
    if (effectiveSelectedRuleId !== selectedRuleId) {
      setSelectedRuleId(effectiveSelectedRuleId);
    }
  }, [effectiveSelectedRuleId, selectedRuleId]);

  const dirty = useMemo(
    () => Boolean(device && draft && JSON.stringify(draft) !== JSON.stringify(device.config.faultInjection)),
    [device, draft],
  );

  if (!device || !draft) return null;

  const currentDeviceId = device.config.id;
  const running = device.status.state === 'running';
  const enabled = device.status.faultInjectionEnabled;
  const activeRules = draft.rules.filter((rule) => rule.enabled).length;
  const selectedRuleIndex = draft.rules.findIndex((rule) => rule.id === effectiveSelectedRuleId);
  const selectedRule = selectedRuleIndex >= 0 ? draft.rules[selectedRuleIndex] : undefined;

  function updateRule(id: string, patch: Partial<FaultRule>) {
    setDraft((current) => current && ({
      ...current,
      rules: current.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
    }));
  }

  function addRule() {
    const rule = newRule();
    setDraft((current) => current && ({ ...current, rules: [...current.rules, rule] }));
    setSearchQuery('');
    setStatusFilter('all');
    setSelectedRuleId(rule.id);
  }

  function deleteRule(id: string, candidateIds: string[]) {
    const nextSelection = selectionAfterFaultRuleDelete(candidateIds, id);
    setDraft((current) => current && ({
      ...current,
      rules: current.rules.filter((rule) => rule.id !== id),
    }));
    setSelectedRuleId(nextSelection);
  }

  function moveRule(id: string, offset: -1 | 1) {
    setDraft((current) => current && ({
      ...current,
      rules: moveFaultRule(current.rules, id, offset),
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
    <div className="h-full min-h-0 overflow-y-auto p-3 sm:p-4 xl:overflow-hidden">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-3 xl:h-full xl:min-h-0">
        <section className="panel flex shrink-0 flex-wrap items-center gap-3 px-4 py-3">
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

        <section className="panel flex flex-col p-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-white/10 pb-4">
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
            <button className="btn btn-ghost btn-sm ml-auto" onClick={addRule}>
              <Plus className="h-3.5 w-3.5" />
              新增规则
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-3 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[17rem_minmax(0,1fr)] xl:gap-4">
            <aside className="hidden min-h-0 flex-col border-r border-white/10 pr-3 xl:flex">
              <div className="shrink-0 space-y-2 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-mist-200">规则列表</h3>
                  <span className="font-mono text-[10px] text-mist-500">{draft.rules.length} / 100</span>
                </div>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-mist-500" />
                  <input
                    className="field h-9 pr-8 pl-8 text-xs"
                    aria-label="按规则名称搜索"
                    placeholder="搜索规则名称"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="absolute right-2 top-2 rounded p-0.5 text-mist-500 hover:text-mist-200"
                      aria-label="清除搜索"
                      onClick={() => setSearchQuery('')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </label>
                <select
                  className="field h-9 text-xs"
                  aria-label="按启用状态筛选"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as FaultRuleStatusFilter)}
                >
                  <option value="all">全部规则</option>
                  <option value="enabled">仅启用</option>
                  <option value="disabled">仅停用</option>
                </select>
                {filtered && (
                  <p className="text-[10px] leading-4 text-mist-500">
                    清除搜索和筛选后可调整执行顺序。
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                {visibleRules.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[11px] leading-5 text-mist-500">
                    {draft.rules.length === 0
                      ? '尚无故障规则，点击新增规则开始配置。'
                      : '没有匹配的规则，请调整搜索或筛选条件。'}
                  </div>
                ) : visibleRules.map(({ rule, index }) => (
                  <div key={rule.id} className="flex items-stretch gap-1">
                    <button
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70 ${
                        rule.id === effectiveSelectedRuleId
                          ? 'border-accent-400/35 bg-accent-400/[0.08]'
                          : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                      }`}
                      aria-pressed={rule.id === effectiveSelectedRuleId}
                      onClick={() => setSelectedRuleId(rule.id)}
                    >
                      <span className="w-7 shrink-0 font-mono text-[10px] text-mist-500">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-mist-200">{rule.name}</span>
                        <span className="mt-1 block truncate text-[10px] text-mist-500">
                          {directionLabel(rule.direction)} · {actionSummary(rule)}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                        rule.enabled
                          ? 'bg-accent-400/10 text-accent-300'
                          : 'bg-white/[0.04] text-mist-500'
                      }`}>
                        {rule.enabled ? '启用' : '停用'}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col justify-center">
                      <button
                        className="rounded p-1 text-mist-500 transition-colors hover:bg-white/5 hover:text-mist-200 disabled:cursor-not-allowed disabled:opacity-25"
                        aria-label={`上移规则 ${rule.name}`}
                        title={filtered ? '清除搜索和筛选后可调整顺序' : '提高执行优先级'}
                        disabled={filtered || index === 0}
                        onClick={() => moveRule(rule.id, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-mist-500 transition-colors hover:bg-white/5 hover:text-mist-200 disabled:cursor-not-allowed disabled:opacity-25"
                        aria-label={`下移规则 ${rule.name}`}
                        title={filtered ? '清除搜索和筛选后可调整顺序' : '降低执行优先级'}
                        disabled={filtered || index === draft.rules.length - 1}
                        onClick={() => moveRule(rule.id, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-h-0 xl:flex xl:flex-col">
              <div className="flex flex-col gap-3 xl:hidden">
                {draft.rules.length === 0 ? (
                  <div className="py-12 text-center text-xs text-mist-500">尚无故障规则</div>
                ) : draft.rules.map((rule) => (
                  <FaultRuleEditor
                    key={rule.id}
                    rule={rule}
                    onChange={(patch) => updateRule(rule.id, patch)}
                    onDelete={() => deleteRule(rule.id, draft.rules.map((item) => item.id))}
                  />
                ))}
              </div>

              <div className="hidden min-h-0 xl:flex xl:flex-1 xl:flex-col">
                {selectedRule ? (
                  <>
                    <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-white/10 pb-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-mist-100">{selectedRule.name}</h3>
                        <p className="mt-1 text-[10px] text-mist-500">
                          第 {selectedRuleIndex + 1} 条 · {directionLabel(selectedRule.direction)} · {triggerSummary(selectedRule.trigger)} · {actionSummary(selectedRule)}
                        </p>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                      <FaultRuleEditor
                        rule={selectedRule}
                        position={selectedRuleIndex + 1}
                        onChange={(patch) => updateRule(selectedRule.id, patch)}
                        onDelete={() => deleteRule(selectedRule.id, visibleRules.map(({ rule }) => rule.id))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-[240px] flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 px-6 text-center text-xs leading-5 text-mist-500">
                    {draft.rules.length === 0
                      ? '新增一条规则后，可在这里编辑触发条件和故障动作。'
                      : '没有匹配的规则，请调整搜索或筛选条件。'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 xl:mt-3">
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
