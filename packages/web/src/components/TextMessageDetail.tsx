import type { CodecConfig, TextField, TextRepeat } from '@deviceforge/core';
import type { ReactNode } from 'react';
import { formatValue } from '../lib/format';
import {
  findMessage,
  topLevelFieldSlots,
  topLevelRepeatSlots,
} from '../lib/text-codec-model';

type TextWaveform = {
  pointCount?: number;
  byteLength?: number;
  encoding?: string;
  crcValid?: boolean;
};

type TextItem = Record<string, unknown>;

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function waveformOf(value: unknown): TextWaveform | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const pointCount = Number(record.pointCount);
  const byteLength = Number(record.byteLength);
  return {
    ...(Number.isFinite(pointCount) ? { pointCount } : {}),
    ...(Number.isFinite(byteLength) ? { byteLength } : {}),
    ...(asText(record.encoding) ? { encoding: asText(record.encoding) } : {}),
    ...(typeof record.crcValid === 'boolean'
      ? { crcValid: record.crcValid }
      : {}),
  };
}

function fieldValue(value: unknown): ReactNode {
  if (Array.isArray(value)) return value.map(String).join(' | ');
  if (value !== null && typeof value === 'object') return formatValue(value);
  return formatValue(value);
}

function FieldRows({ fields }: { fields: { slot: TextField; value: unknown }[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="divide-y divide-white/5 rounded-lg border border-white/10">
      {fields.map(({ slot, value }) => (
        <div key={slot.name} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
          <span className="shrink-0 text-[11px] text-mist-500">
            {slot.name}
            {slot.description && (
              <span className="ml-1 text-[10px] text-mist-600">（{slot.description}）</span>
            )}
          </span>
          <span className="break-all text-right font-mono text-[11px] text-mist-200">
            {fieldValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RepeatTable({ repeat, items }: { repeat: TextRepeat; items: TextItem[] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] text-mist-500">
        <span>{repeat.description ?? repeat.name}</span>
        <span>{items.length} 组</span>
      </div>
      <div className="divide-y divide-white/5">
        {items.map((item, index) => {
          const waveform = waveformOf(item.waveform);
          const values = Array.isArray(item.values) ? item.values : [];
          const key =
            (repeat.keyField ? asText(item[repeat.keyField]) : undefined) ??
            asText(item.id) ??
            String(index + 1);
          return (
            <div key={`${key}-${index}`} className="px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent-300">{key}</span>
                {asText(item.name) && (
                  <span className="text-[10.5px] text-mist-400">{asText(item.name)}</span>
                )}
                {asText(item.unit) && (
                  <span className="text-[10px] text-mist-500">{asText(item.unit)}</span>
                )}
                {item.multi === true && (
                  <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9.5px] text-sky-300">
                    多值
                  </span>
                )}
                {waveform && (
                  <>
                    <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                      波形 {waveform.pointCount ?? '—'} 点
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9.5px] ${
                        waveform.crcValid === false
                          ? 'bg-rose-500/10 text-rose-300'
                          : 'bg-accent-500/10 text-accent-300'
                      }`}
                    >
                      CRC {waveform.crcValid === false ? '失败' : '通过'}
                    </span>
                    {waveform.encoding && (
                      <span className="text-[10px] text-mist-500">{waveform.encoding}</span>
                    )}
                  </>
                )}
              </div>
              {!waveform && values.length > 0 && (
                <div className="mt-1 break-all font-mono text-[11px] text-mist-200">
                  {values.map(String).join(' | ')}
                </div>
              )}
              {waveform && Array.isArray(item.waveform) && (
                <div className="mt-1 break-all font-mono text-[11px] text-mist-200">
                  {item.waveform.map(String).join(' | ')}
                </div>
              )}
              {!waveform && values.length === 0 && asText(item.raw) && (
                <div className="mt-1 break-all font-mono text-[11px] text-mist-200">
                  {asText(item.raw)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 通用 text codec 报文详情；不包含任何厂商字段名。 */
export function TextMessageDetail({
  decoded,
  codec,
}: {
  decoded: Record<string, unknown>;
  codec?: CodecConfig;
}) {
  if (decoded._codec !== 'text') return null;
  const messageName = asText(decoded._message);
  const message =
    codec?.type === 'text' && messageName
      ? findMessage(codec, messageName)
      : undefined;

  if (!message) {
    const entries = Object.entries(decoded).filter(([key]) => !key.startsWith('_'));
    return (
      <div className="divide-y divide-white/5 rounded-lg border border-white/10">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
            <span className="shrink-0 font-mono text-[11px] text-mist-500">{key}</span>
            <span className="break-all text-right font-mono text-[11px] text-mist-200">
              {formatValue(value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const fieldSlots = topLevelFieldSlots(message);
  const repeatSlots = topLevelRepeatSlots(message);
  const handled = new Set<string>([
    '_codec',
    '_message',
    '_messageLabel',
    '_summary',
    '_warnings',
    ...repeatSlots.map((repeat) => repeat.name),
    ...repeatSlots.flatMap((repeat) => (repeat.mapField ? [repeat.mapField] : [])),
  ]);

  const fieldRows = fieldSlots.flatMap((slot) =>
    decoded[slot.name] !== undefined
      ? [{ slot, value: decoded[slot.name] }]
      : [],
  );
  const remaining = Object.entries(decoded).filter(
    ([key]) => !key.startsWith('_') && !handled.has(key),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
        <span className="text-[11px] text-mist-400">
          {asText(decoded._messageLabel) ?? message.label ?? message.name}
        </span>
        <span className="font-mono text-[10.5px] text-mist-500">
          {messageName}
        </span>
        {asText(decoded._summary) && (
          <span className="min-w-0 truncate text-[10.5px] text-mist-500">
            {asText(decoded._summary)}
          </span>
        )}
      </div>

      <FieldRows fields={fieldRows} />

      {repeatSlots.map((repeat) => {
        const items = decoded[repeat.name];
        if (!Array.isArray(items)) return null;
        return (
          <RepeatTable
            key={repeat.name}
            repeat={repeat}
            items={items.filter(
              (item): item is TextItem =>
                item !== null && typeof item === 'object' && !Array.isArray(item),
            )}
          />
        );
      })}

      {remaining.length > 0 && (
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {remaining.map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
              <span className="shrink-0 font-mono text-[11px] text-mist-500">{key}</span>
              <span className="break-all text-right font-mono text-[11px] text-mist-200">
                {formatValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
