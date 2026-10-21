import { useState } from 'react';
import { Check, Send } from 'lucide-react';
import { useAppStore } from '../store';
import type { DeviceDetail } from '../types';

function defaultFields(device: DeviceDetail): string {
  const codec = device.config.codec;
  if (codec.type !== 'fields') {
    return JSON.stringify({ hex: '' }, null, 2);
  }
  const values: Record<string, unknown> = {};
  for (const field of codec.fields) {
    if (field.const !== undefined || field.calc !== undefined) continue;
    if (field.type === 'bytes' || field.type === 'string') values[field.name] = '';
    else if (field.type === 'bcd') values[field.name] = '0';
    else values[field.name] = 0;
  }
  return JSON.stringify(values, null, 2);
}

export function SendPanel() {
  const device = useAppStore((state) => state.device);
  const connections = useAppStore((state) => state.connections);
  const send = useAppStore((state) => state.send);

  const [mode, setMode] = useState<'hex' | 'fields'>('hex');
  const [hexValue, setHexValue] = useState('');
  const [fieldsValue, setFieldsValue] = useState(() =>
    device ? defaultFields(device) : '{}',
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!device) return null;

  const connected = connections.length > 0;

  async function handleSend() {
    setError(null);
    setSent(false);

    let payload: { hex?: string; fields?: Record<string, unknown> };
    if (mode === 'hex') {
      const hex = hexValue.replace(/\s+/g, '');
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
        setError('请输入偶数位十六进制，例如 AA 55 01 00');
        return;
      }
      payload = { hex };
    } else {
      try {
        const parsed = JSON.parse(fieldsValue) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('fields 必须是 JSON 对象');
        }
        payload = { fields: parsed as Record<string, unknown> };
      } catch (parseError) {
        setError(
          `JSON 解析失败：${parseError instanceof Error ? parseError.message : String(parseError)}`,
        );
        return;
      }
    }

    setSending(true);
    const ok = await send(device!.config.id, payload);
    setSending(false);
    if (ok) {
      setSent(true);
      window.setTimeout(() => setSent(false), 1600);
    }
  }

  return (
    <section className="panel shrink-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-mist-200">
          <Send className="h-3.5 w-3.5 text-accent-400" />
          手动发送
        </span>
        <span className="chip">→ 最新连接</span>
        {connected ? (
          <span className="text-[11px] text-accent-400">
            {connections.length} 个连接可用
          </span>
        ) : (
          <span className="text-[11px] text-amber-400">等待上位机连接</span>
        )}
        {sent && (
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-400">
            <Check className="h-3.5 w-3.5" />
            已发送
          </span>
        )}

        <div className="ml-auto flex items-center rounded-lg border border-white/10 p-0.5">
          {(['hex', 'fields'] as const).map((value) => (
            <button
              key={value}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                mode === value
                  ? 'bg-white/10 text-mist-100'
                  : 'text-mist-500 hover:text-mist-300'
              }`}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
            >
              {value === 'hex' ? 'HEX' : '字段 JSON'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        {mode === 'hex' ? (
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
          <textarea
            className="field min-h-[86px] flex-1 resize-y py-2 font-mono text-xs leading-5"
            placeholder={'{\n  "cmd": 3,\n  "seq": 1\n}'}
            value={fieldsValue}
            onChange={(event) => {
              setFieldsValue(event.target.value);
              setError(null);
            }}
            spellCheck={false}
          />
        )}

        <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
          <button
            className="btn btn-primary flex-1 sm:flex-none"
            onClick={() => void handleSend()}
            disabled={!connected || sending}
          >
            {sending ? '发送中…' : '发送'}
          </button>
          {mode === 'fields' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setFieldsValue(defaultFields(device))}
              title="根据 codec 字段生成示例"
            >
              示例
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}
    </section>
  );
}
