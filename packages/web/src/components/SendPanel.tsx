import { Check, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDictionaryRegistry } from '../hooks/useDictionaryRegistry';
import { useJsonDraft } from '../hooks/useJsonDraft';
import { codecFieldSuggestions, defaultFieldsForCodec } from '../lib/codec-fields';
import { templateRootsFor } from '../lib/template-suggestions';
import { transportPresentation } from '../lib/transport-presentation';
import { useAppStore } from '../store';
import { CodeEditor } from './CodeEditor';
import { EditorModeToggle } from './form/EditorModeToggle';
import { SegmentedControl } from './form/FormControls';
import { VisualJsonEditor } from './form/VisualJsonEditor';

export function SendPanel() {
  const device = useAppStore((state) => state.device);
  const connections = useAppStore((state) => state.connections);
  const send = useAppStore((state) => state.send);

  const codec = device?.config.codec;
  const dictionaries = useDictionaryRegistry();
  const baseline = useMemo(
    () => (codec ? defaultFieldsForCodec(codec, dictionaries) : {}),
    [codec, dictionaries],
  );
  const baselineKey = device
    ? `${device.config.id}:${JSON.stringify(device.config.codec)}`
    : 'none';
  const draft = useJsonDraft(baseline, 'send', {
    baseline,
    baselineKey,
    noun: 'fields',
  });
  const templateCompletion = useMemo(
    () => ({
      roots: templateRootsFor('manual-send'),
      codec: device?.config.codec,
      dictionaries,
      state: device?.state ?? device?.config.state ?? {},
      deviceInfo: device?.config.deviceInfo,
    }),
    [
      device?.config.codec,
      device?.config.deviceInfo,
      device?.state,
      device?.config.state,
      dictionaries,
    ],
  );

  const [payloadMode, setPayloadMode] = useState<'hex' | 'fields'>('hex');
  const [hexValue, setHexValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const deviceIdRef = useRef(device?.config.id ?? '');
  useEffect(() => {
    const id = device?.config.id ?? '';
    if (deviceIdRef.current === id) return;
    deviceIdRef.current = id;
    if (device) {
      draft.load(defaultFieldsForCodec(device.config.codec, dictionaries));
    }
  }, [device?.config.id, device?.config.codec, dictionaries, draft.load]);

  if (!device) return null;

  const presentation = transportPresentation(device.config.transport.type);
  const connected = connections.length > 0;
  const paused = device.status.transport.state === 'disconnected';
  const failed = device.status.transport.state === 'error';
  const displayError = error ?? draft.error;

  async function handleSend() {
    setError(null);
    draft.setError(null);
    setSent(false);

    let payload: { hex?: string; fields?: Record<string, unknown> };
    if (payloadMode === 'hex') {
      const hex = hexValue.replace(/\s+/g, '');
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
        setError('请输入偶数位十六进制，例如 AA 55 01 00');
        return;
      }
      payload = { hex };
    } else {
      const fields = draft.mode === 'visual' ? draft.value : draft.parseText();
      if (!fields) return;
      payload = { fields };
    }

    setSending(true);
    const ok = await send(device!.config.id, payload);
    setSending(false);
    if (ok) {
      setSent(true);
      window.setTimeout(() => setSent(false), 1600);
    }
  }

  function resetFields() {
    draft.reset();
    setError(null);
    draft.setError(null);
  }

  return (
    <section className="panel shrink-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-mist-200">
          <Send className="h-3.5 w-3.5 text-accent-400" />
          手动发送
        </span>
        <span className="chip">{presentation.sendTargetLabel}</span>
        {connected ? (
          <span className="text-[11px] text-accent-400">
            {connections.length} {presentation.connectionUnit}可用
          </span>
        ) : (
          <span
            className={`text-[11px] ${
              failed ? 'text-rose-300' : 'text-amber-400'
            }`}
          >
            {paused
              ? presentation.pausedLabel
              : failed
                ? `${presentation.isOutbound ? '上游' : '连接'}失败，查看上方传输状态`
                : presentation.waitingLabel}
          </span>
        )}
        {sent && (
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-400">
            <Check className="h-3.5 w-3.5" />
            已发送
          </span>
        )}

        <SegmentedControl<'hex' | 'fields'>
          ariaLabel="发送内容格式"
          value={payloadMode}
          options={[
            { value: 'hex', label: 'HEX' },
            { value: 'fields', label: '字段' },
          ]}
          onChange={(next) => {
            setPayloadMode(next);
            setError(null);
            draft.setError(null);
          }}
          size="sm"
          className="ml-auto"
        />
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        {payloadMode === 'hex' ? (
          <textarea
            className="field min-h-[54px] flex-1 resize-y py-2 font-mono text-xs leading-5"
            placeholder="AA 55 00 0C 03 01 00 00 00 00 00 00"
            value={hexValue}
            onChange={(event) => {
              setHexValue(event.target.value);
              setError(null);
            }}
            spellCheck={false}
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <EditorModeToggle
                mode={draft.mode}
                onChange={(mode) => {
                  draft.switchMode(mode);
                }}
                codeLabel="JSON 源码"
                size="sm"
                disabled={sending}
              />
              <span className="text-[10.5px] text-mist-500">
                {codec?.type === 'fields'
                  ? '按 codec 字段填写；值支持模板；缺少必填字段发送会报错。'
                  : codec?.type === 'text'
                    ? 'kind 选择报文；repeat 用数组；optional 可用 null 省略；时间戳和流水号可自动补齐。'
                    : 'raw codec 可用键：hex / text / data（0-255 数组）。'}
              </span>
              <button
                className="btn btn-ghost btn-sm ml-auto"
                onClick={resetFields}
                title="根据 codec 字段生成示例"
              >
                示例
              </button>
            </div>

            {draft.mode === 'visual' ? (
              <div className="max-h-[220px] min-h-[86px] overflow-y-auto pr-1">
                <VisualJsonEditor
                  value={draft.value}
                  onChange={(next) => {
                    setError(null);
                    draft.updateValue(next);
                  }}
                  keyPlaceholder="字段名"
                  addLabel="添加字段"
                  emptyText="暂无字段"
                  templates
                  completion={templateCompletion}
                  suggestions={codecFieldSuggestions(device.config.codec)}
                  disabled={sending}
                />
              </div>
            ) : (
              <CodeEditor
                value={draft.text}
                onChange={(next) => {
                  setError(null);
                  draft.updateText(next);
                }}
                language="json"
                height="150px"
                compact
                readOnly={sending}
                ariaLabel="发送字段 JSON 源码"
              />
            )}
          </div>
        )}

        <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
          <button
            className="btn btn-primary flex-1 sm:flex-none"
            onClick={() => void handleSend()}
            disabled={!connected || sending}
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </div>

      {displayError && <p className="mt-1.5 text-[11px] text-rose-300">{displayError}</p>}
    </section>
  );
}
