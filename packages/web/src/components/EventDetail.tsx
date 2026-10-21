import { ArrowDownLeft, ArrowUpRight, Circle, FileCode2 } from 'lucide-react';
import { formatTime, formatValue } from '../lib/format';
import type { TrafficEvent } from '../types';
import { HexDump } from './HexDump';

function DirectionLabel({ direction }: { direction: TrafficEvent['direction'] }) {
  if (direction === 'in') {
    return (
      <span className="inline-flex items-center gap-1 text-accent-300">
        <ArrowDownLeft className="h-3.5 w-3.5" />
        接收
      </span>
    );
  }
  if (direction === 'out') {
    return (
      <span className="inline-flex items-center gap-1 text-sky-300">
        <ArrowUpRight className="h-3.5 w-3.5" />
        发送
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-mist-400">
      <Circle className="h-3 w-3" />
      系统
    </span>
  );
}

export function EventDetail({
  event,
  className = '',
}: {
  event: TrafficEvent;
  className?: string;
}) {
  const fields = Object.entries(event.decoded ?? {}).filter(([key]) => !key.startsWith('_'));
  const checksum = event.decoded?._checksum;
  const checksumValid = event.decoded?._checksumValid;
  const warnings = event.decoded?._warnings;

  return (
    <aside className={`panel flex min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-accent-400" />
          <span className="text-xs font-medium text-mist-200">报文详情</span>
        </div>
        <span className="font-mono text-[10.5px] text-mist-500">
          {formatTime(event.ts)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <div>
            <div className="text-mist-500">方向</div>
            <div className="mt-0.5">
              <DirectionLabel direction={event.direction} />
            </div>
          </div>
          <div>
            <div className="text-mist-500">长度</div>
            <div className="mt-0.5 font-mono text-mist-300">{event.size} B</div>
          </div>
          <div>
            <div className="text-mist-500">规则</div>
            <div className="mt-0.5 truncate text-mist-300">{event.rule ?? '—'}</div>
          </div>
          <div>
            <div className="text-mist-500">连接</div>
            <div
              className="mt-0.5 truncate font-mono text-mist-400"
              title={event.connectionId}
            >
              {event.connectionId ? event.connectionId.slice(0, 8) : '—'}
            </div>
          </div>
        </div>

        {event.error && (
          <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-2.5 py-2 text-[11px] leading-5 text-rose-200">
            {event.error}
          </div>
        )}

        {event.note && !event.error && (
          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-2 text-[11px] leading-5 text-amber-200">
            {event.note}
          </div>
        )}

        {event.data.length > 0 && (
          <section className="mt-4">
            <h4 className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-mist-500">
              原始数据
            </h4>
            <div className="rounded-lg border border-white/10 bg-ink-950/70 p-2.5">
              <HexDump hex={event.data} />
            </div>
          </section>
        )}

        {fields.length > 0 && (
          <section className="mt-4">
            <h4 className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-mist-500">
              解码字段
            </h4>
            <div className="divide-y divide-white/5 rounded-lg border border-white/10">
              {fields.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 px-2.5 py-1.5"
                >
                  <span className="shrink-0 font-mono text-[11px] text-mist-500">{key}</span>
                  <span className="break-all text-right font-mono text-[11px] text-mist-200">
                    {formatValue(value)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {checksum !== undefined && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 px-2.5 py-2 text-[11px]">
            <span className="text-mist-500">校验和</span>
            <span className="flex items-center gap-2 font-mono text-mist-300">
              {typeof checksum === 'number'
                ? `0x${checksum.toString(16).toUpperCase()}`
                : String(checksum)}
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  checksumValid === false
                    ? 'bg-rose-500/10 text-rose-300'
                    : 'bg-accent-500/10 text-accent-300'
                }`}
              >
                {checksumValid === false ? '失败' : '通过'}
              </span>
            </span>
          </div>
        )}

        {Array.isArray(warnings) && warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2">
            <div className="text-[10.5px] font-medium text-amber-300">提示</div>
            <ul className="mt-1 space-y-1 text-[11px] leading-5 text-amber-200/90">
              {warnings.map((warning, index) => (
                <li key={index}>{String(warning)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
