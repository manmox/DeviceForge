import type {
  CodecConfig,
  DeviceInfo,
  HttpResponseConfig,
  OutgoingMessage,
  Rule,
} from '@deviceforge/core';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import { useId, useMemo, type MouseEvent } from 'react';
import { useDictionaryRegistry } from '../../hooks/useDictionaryRegistry';
import { codecMatchFieldSuggestions, defaultFieldsForCodec } from '../../lib/codec-fields';
import { ruleSummaryParts } from '../../lib/config-summary';
import { templateRootsFor } from '../../lib/template-suggestions';
import {
  ruleSendMessages,
  ruleTrigger,
  RULE_TRIGGER_LABELS,
  setRuleSend,
  withRuleTrigger,
  type RuleTrigger,
} from '../../lib/rule-shape';
import { useIssueText, useIssues } from '../form/ConfigIssuesContext';
import {
  FormField,
  IconButton,
  NumberInput,
  SelectInput,
  SwitchInput,
  SwitchRow,
  TextInput,
  type SelectOption,
} from '../form/FormControls';
import { VisualJsonEditor } from '../form/VisualJsonEditor';
import { MatchEditor } from './MatchEditor';
import { MessageEditor } from './MessageEditor';

const TRIGGER_OPTIONS: SelectOption<RuleTrigger>[] = [
  { value: 'start', label: '启动时' },
  { value: 'connect', label: '连接建立时' },
  { value: 'frame', label: '收到帧时' },
  { value: 'interval', label: '周期执行' },
];

const HEADER_INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [contenteditable="true"], [role="switch"]';

export function RuleCard({
  rule,
  index,
  total,
  codec,
  mqttEnabled = false,
  mqttClientId = false,
  httpEnabled = false,
  websocketEnabled = false,
  state,
  deviceInfo,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  open,
  onToggle,
  disabled = false,
}: {
  rule: Rule;
  index: number;
  total: number;
  codec: CodecConfig;
  mqttEnabled?: boolean;
  mqttClientId?: boolean;
  httpEnabled?: boolean;
  websocketEnabled?: boolean;
  state: Record<string, unknown>;
  deviceInfo?: DeviceInfo;
  onChange: (next: Rule) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const issues = useIssues(`rules.${index}`);
  const topicFilterIssue = useIssueText(`rules.${index}.topicFilter`);
  const publishTopicIssue = useIssueText(`rules.${index}.publishTopic`);
  const httpStatusIssue = useIssueText(`rules.${index}.httpResponse.statusCode`);
  const dictionaries = useDictionaryRegistry();
  const bodyId = useId();
  const trigger = ruleTrigger(rule);
  const stateKeySuggestions = useMemo(
    () => Object.keys(state).map((name) => ({ name })),
    [state],
  );
  const setCompletion = useMemo(
    () => ({
      roots: templateRootsFor('rule-set', trigger, mqttEnabled, httpEnabled, websocketEnabled),
      codec,
      dictionaries,
      state,
      deviceInfo,
      mqtt: mqttEnabled,
      mqttClientId,
      http: httpEnabled,
      websocket: websocketEnabled,
    }),
    [trigger, codec, dictionaries, state, deviceInfo, mqttEnabled, mqttClientId, httpEnabled, websocketEnabled],
  );
  const sendCompletion = useMemo(
    () => ({
      roots: templateRootsFor('rule-send', trigger, mqttEnabled, httpEnabled, websocketEnabled),
      codec,
      dictionaries,
      state,
      deviceInfo,
      mqtt: mqttEnabled,
      mqttClientId,
      http: httpEnabled,
      websocket: websocketEnabled,
    }),
    [trigger, codec, dictionaries, state, deviceInfo, mqttEnabled, mqttClientId, httpEnabled, websocketEnabled],
  );
  const summaryParts = ruleSummaryParts(rule);
  if (summaryParts[0] === RULE_TRIGGER_LABELS[trigger]) summaryParts.shift();
  const summary = summaryParts.join(' · ');
  const messages = ruleSendMessages(rule);
  const sendEnabled = rule.send !== undefined;
  const setEnabled = rule.set !== undefined;

  function patch(partial: Partial<Rule>) {
    onChange({ ...rule, ...partial });
  }

  function handleHeaderClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest(HEADER_INTERACTIVE_SELECTOR)) {
      return;
    }
    // 拖选摘要文字后不应顺带展开/收起；只检查头部内部的选择。
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      (event.currentTarget.contains(selection.anchorNode) ||
        event.currentTarget.contains(selection.focusNode))
    ) {
      return;
    }
    onToggle();
  }

  function unset(
    key: 'id' | 'name' | 'set' | 'send' | 'match' | 'topicFilter' | 'publishTopic' | 'httpResponse',
  ): Rule {
    const next = { ...rule };
    delete next[key];
    return next;
  }

  function newMessage(): OutgoingMessage {
    if (codec.type === 'raw') return { hex: '' };
    return { fields: defaultFieldsForCodec(codec, dictionaries) };
  }

  function updateMessage(messageIndex: number, message: OutgoingMessage) {
    const next = [...messages];
    next[messageIndex] = message;
    onChange(setRuleSend(rule, next));
  }

  function moveMessage(messageIndex: number, direction: -1 | 1) {
    const next = [...messages];
    const item = next[messageIndex];
    if (!item) return;
    next.splice(messageIndex, 1);
    next.splice(messageIndex + direction, 0, item);
    onChange(setRuleSend(rule, next));
  }

  function removeMessage(messageIndex: number) {
    onChange(setRuleSend(rule, messages.filter((_, itemIndex) => itemIndex !== messageIndex)));
  }

  function updateHttpResponse(patchValue: Partial<HttpResponseConfig>) {
    patch({
      httpResponse: {
        statusCode: rule.httpResponse?.statusCode ?? 200,
        headers: rule.httpResponse?.headers ?? {},
        ...patchValue,
      },
    });
  }

  function updateHttpHeader(oldName: string | undefined, name: string, value: string) {
    const headers = { ...(rule.httpResponse?.headers ?? {}) };
    if (oldName && oldName !== name) delete headers[oldName];
    if (name.trim()) headers[name.trim()] = value;
    patch({ httpResponse: { statusCode: rule.httpResponse?.statusCode ?? 200, headers } });
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-white/10 bg-ink-900/40"
      data-rule-index={index}
    >
      <div
        className="flex cursor-pointer flex-wrap items-center gap-2 border-b border-white/10 px-2.5 py-2 transition-colors hover:bg-white/[0.03]"
        onClick={handleHeaderClick}
      >
        <IconButton
          label={open ? '收起规则' : '展开规则'}
          onClick={onToggle}
          ariaExpanded={open}
          ariaControls={bodyId}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </IconButton>
        <SwitchInput
          checked={rule.enabled}
          onChange={(enabled) => patch({ enabled })}
          label="启用规则"
          disabled={disabled}
        />
        <div className="w-40 shrink-0">
          <TextInput
            value={rule.name ?? ''}
            onChange={(name) =>
              name.trim() === '' ? onChange(unset('name')) : patch({ name })
            }
            disabled={disabled}
            className="cursor-text"
            placeholder="规则名称"
          />
        </div>
        <span className="chip text-[10px]">{RULE_TRIGGER_LABELS[trigger]}</span>
        {summary && (
          <span
            className="hidden min-w-0 truncate text-[10.5px] text-mist-500 md:block"
            title={summary}
          >
            {summary}
          </span>
        )}
        {issues.length > 0 && (
          <span className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-1.5 py-0.5 text-[10px] text-rose-300">
            {issues.length} 个问题
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="上移规则"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="下移规则"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="复制规则" onClick={onDuplicate} disabled={disabled}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="删除规则" danger onClick={onDelete} disabled={disabled}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="border-b border-rose-500/10 bg-rose-500/[0.04] px-2.5 py-1.5 text-[10.5px] leading-4 text-rose-200">
          {issues.map((issue) => issue.message).join('；')}
        </div>
      )}

      {open && (
        <div
          id={bodyId}
          className={`space-y-3 p-2.5 ${rule.enabled ? '' : 'opacity-60'}`}
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            <FormField
              label="触发方式"
              hint="切换触发方式会清除不适用的 match/every 配置。"
            >
              <SelectInput<RuleTrigger>
                value={trigger}
                options={TRIGGER_OPTIONS}
                onChange={(next) => onChange(withRuleTrigger(rule, next))}
                disabled={disabled}
                ariaLabel="规则触发方式"
              />
            </FormField>

            {trigger === 'interval' && (
              <>
                <FormField label="周期（ms）" hint="最小 10ms。">
                  <NumberInput
                    value={rule.every ?? 5000}
                    onChange={(every) => patch({ every: every ?? 5000 })}
                    min={10}
                    step={1}
                    disabled={disabled}
                    ariaLabel="周期"
                  />
                </FormField>
                <FormField label="抖动（ms）" hint="实际间隔在 every ± jitter 内随机。">
                  <NumberInput
                    value={rule.jitter}
                    onChange={(jitter) => patch({ jitter: jitter ?? 0 })}
                    min={0}
                    step={1}
                    disabled={disabled}
                    ariaLabel="抖动"
                  />
                </FormField>
                {!mqttEnabled && <FormField label="发送目标" hint="周期规则无触发连接，可选择全部或最近连接。">
                  <SelectInput<'all' | 'last'>
                    value={rule.target}
                    options={[
                      { value: 'all', label: '全部连接（all）' },
                      { value: 'last', label: '最近连接（last）' },
                    ]}
                    onChange={(target) => patch({ target })}
                    disabled={disabled}
                    ariaLabel="发送目标"
                  />
                </FormField>}
              </>
            )}
          </div>

          {trigger === 'frame' && (
            <div className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
              <div className="mb-2 text-[11px] font-medium text-mist-300">匹配条件</div>
              <MatchEditor
                match={rule.match}
                onChange={(match) =>
                  match ? patch({ match }) : onChange(unset('match'))
                }
                suggestions={[
                  ...codecMatchFieldSuggestions(codec),
                  ...(httpEnabled ? ['http.method', 'http.path', 'http.query.id', 'http.headers.content_type'] : []),
                  ...(websocketEnabled ? ['websocket.path', 'websocket.isBinary'] : []),
                ]}
                disabled={disabled}
                path={`rules.${index}.match`}
              />
              {mqttEnabled && (
                <div className="mt-2">
                  <FormField
                    label="主题过滤器（可选）"
                    error={topicFilterIssue}
                    hint="支持 + 匹配单层、# 匹配末尾多层；留空时匹配所有主题。"
                  >
                    <TextInput
                      value={rule.topicFilter ?? ''}
                      onChange={(topicFilter) =>
                        topicFilter.trim() === ''
                          ? onChange(unset('topicFilter'))
                          : patch({ topicFilter })
                      }
                      disabled={disabled}
                      monospace
                      placeholder="sensors/+/state"
                    />
                  </FormField>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
            <SwitchRow
              label="更新状态变量"
              hint="在发送前浅合并到设备状态；值支持模板，输入 $ 或 ${ 可打开建议。"
              checked={setEnabled}
              onChange={(enabled) =>
                enabled ? patch({ set: {} }) : onChange(unset('set'))
              }
              disabled={disabled}
            />
            {setEnabled && (
              <div className="mt-2">
                <VisualJsonEditor
                  value={rule.set ?? {}}
                  onChange={(next) =>
                    Object.keys(next).length === 0
                      ? onChange(unset('set'))
                      : patch({ set: next })
                  }
                  keyPlaceholder="变量名"
                  addLabel="添加变量"
                  emptyText="没有状态更新"
                  templates
                  completion={setCompletion}
                  suggestions={stateKeySuggestions}
                  disabled={disabled}
                />
              </div>
            )}
          </div>

          {httpEnabled && trigger === 'frame' && (
            <div className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
              <SwitchRow
                label="HTTP 响应"
                hint="每个请求只返回一条响应；命中多条规则时，第一条成功发送的规则处理响应。"
                checked={rule.httpResponse !== undefined}
                onChange={(enabled) =>
                  enabled
                    ? updateHttpResponse({})
                    : onChange(unset('httpResponse'))
                }
                disabled={disabled}
              />
              {rule.httpResponse && (
                <div className="mt-2 space-y-2">
                  <FormField label="状态码" error={httpStatusIssue}>
                    <NumberInput
                      value={rule.httpResponse.statusCode}
                      onChange={(statusCode) => updateHttpResponse({ statusCode: statusCode ?? 200 })}
                      min={100}
                      max={599}
                      step={1}
                      disabled={disabled}
                      ariaLabel="HTTP 响应状态码"
                    />
                  </FormField>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-mist-300">响应头</div>
                    <div className="space-y-1.5">
                      {Object.entries(rule.httpResponse.headers).map(([name, value], headerIndex) => (
                        <div key={`${name}-${headerIndex}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-1.5">
                          <TextInput value={name} onChange={(next) => updateHttpHeader(name, next, value)} disabled={disabled} monospace placeholder="content-type" />
                          <TextInput value={value} onChange={(next) => updateHttpHeader(name, name, next)} disabled={disabled} placeholder="text/plain" />
                          <IconButton label={`删除响应头 ${name}`} danger onClick={() => {
                            const headers = { ...rule.httpResponse!.headers };
                            delete headers[name];
                            updateHttpResponse({ headers });
                          }} disabled={disabled}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-1"
                      onClick={() => {
                        let suffix = Object.keys(rule.httpResponse!.headers).length + 1;
                        let key = `x-deviceforge-${suffix}`;
                        while (key in rule.httpResponse!.headers) key = `x-deviceforge-${++suffix}`;
                        updateHttpHeader(undefined, key, '');
                      }}
                      disabled={disabled}
                    >
                      <Plus className="h-3.5 w-3.5" />添加响应头
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
            <SwitchRow
              label="发送消息"
              hint="fields 由 codec 补齐常量/长度/校验；hex 直接发送原始字节。"
              checked={sendEnabled}
              onChange={(enabled) =>
                onChange(
                  enabled
                    ? setRuleSend(rule, [newMessage()])
                    : setRuleSend(rule, []),
                )
              }
              disabled={disabled}
            />
            {sendEnabled && (
              <div className="mt-2 space-y-2">
                {mqttEnabled && (
                  <FormField
                    label="发布主题覆盖（可选）"
                    error={publishTopicIssue}
                    hint="留空时使用传输默认主题；帧规则可使用 $mqtt.topic 等入站元数据。"
                  >
                    <TextInput
                      value={rule.publishTopic ?? ''}
                      onChange={(publishTopic) =>
                        publishTopic.trim() === ''
                          ? onChange(unset('publishTopic'))
                          : patch({ publishTopic })
                      }
                      disabled={disabled}
                      monospace
                      placeholder="deviceforge/device/down"
                    />
                  </FormField>
                )}
                {messages.length === 0 && (
                  <p className="text-[10.5px] text-mist-500">当前 send 是空数组，不会发送任何消息。</p>
                )}
                {messages.map((message, messageIndex) => (
                  <div
                    key={messageIndex}
                    className="rounded-lg border border-white/5 bg-ink-950/30 p-2"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="chip font-mono text-[10px]">
                        消息 #{messageIndex + 1}
                      </span>
                      <div className="ml-auto flex items-center gap-0.5">
                        <IconButton
                          label="上移消息"
                          onClick={() => moveMessage(messageIndex, -1)}
                          disabled={disabled || messageIndex === 0}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="下移消息"
                          onClick={() => moveMessage(messageIndex, 1)}
                          disabled={disabled || messageIndex === messages.length - 1}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="删除消息"
                          danger
                          onClick={() => removeMessage(messageIndex)}
                          disabled={disabled}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    <MessageEditor
                      message={message}
                      onChange={(next) => updateMessage(messageIndex, next)}
                      codec={codec}
                      dictionaries={dictionaries}
                      templateContext={sendCompletion}
                      path={`rules.${index}.send${
                        messages.length > 1 ? `.${messageIndex}` : ''
                      }`}
                      disabled={disabled}
                    />
                  </div>
                ))}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(setRuleSend(rule, [...messages, newMessage()]))}
                  disabled={disabled}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加消息
                </button>
              </div>
            )}
          </div>

          {(trigger === 'connect' || trigger === 'frame') && (
            <div className="rounded-lg border border-white/5 bg-white/[0.015] p-2.5">
              <SwitchRow
                label="发送后断开连接"
                hint="仅在连接或收到帧触发时有效；TCP Client 与 MQTT Client 会暂停自动重连，重启设备后恢复。"
                checked={rule.disconnect}
                onChange={(disconnect) => patch({ disconnect })}
                disabled={disabled}
              />
            </div>
          )}

          <FormField label="规则 ID（可选）" hint="仅用于标识规则，不影响执行。">
            <TextInput
              value={rule.id ?? ''}
              onChange={(id) =>
                id.trim() === '' ? onChange(unset('id')) : patch({ id })
              }
              disabled={disabled}
              monospace
              placeholder="rule-1"
            />
          </FormField>
        </div>
      )}
    </div>
  );
}
