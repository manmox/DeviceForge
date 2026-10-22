import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Circle,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react';
import { formatTime, summarizeDecoded } from '../lib/format';
import { transportPresentation } from '../lib/transport-presentation';
import { useAppStore } from '../store';
import type { TrafficEvent } from '../types';
import { EventDetail } from './EventDetail';
import { SendPanel } from './SendPanel';

const GRID =
  'grid grid-cols-[82px_58px_46px_minmax(0,1fr)] items-center gap-2 md:grid-cols-[96px_66px_54px_136px_minmax(0,1fr)]';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'in', label: '接收' },
  { value: 'out', label: '发送' },
  { value: 'system', label: '系统' },
] as const;

type DirectionFilter = (typeof FILTERS)[number]['value'];

function DirectionBadge({ direction }: { direction: TrafficEvent['direction'] }) {
  if (direction === 'in') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-accent-300">
        <ArrowDownLeft className="h-3.5 w-3.5" />
        接收
      </span>
    );
  }
  if (direction === 'out') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-sky-300">
        <ArrowUpRight className="h-3.5 w-3.5" />
        发送
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-mist-400">
      <Circle className="h-2.5 w-2.5" />
      系统
    </span>
  );
}

function summaryOf(event: TrafficEvent): string {
  if (event.direction === 'system') {
    return event.note ?? event.error ?? '系统事件';
  }
  const decoded = summarizeDecoded(event.decoded);
  if (decoded) return decoded;
  if (event.data) {
    return event.data.length > 96 ? `${event.data.slice(0, 96)}…` : event.data;
  }
  return '—';
}

export function TrafficPanel() {
  const device = useAppStore((state) => state.device);
  const traffic = useAppStore((state) => state.traffic);
  const clearTraffic = useAppStore((state) => state.clearTraffic);

  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return traffic.filter((event) => {
      if (direction !== 'all' && event.direction !== direction) return false;
      if (!needle) return true;
      const haystack = [
        event.data,
        event.rule,
        event.note,
        event.error,
        event.decoded ? JSON.stringify(event.decoded) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [traffic, direction, query]);

  const fallback =
    [...filtered].reverse().find((event) => event.direction !== 'system') ??
    filtered[filtered.length - 1] ??
    null;
  const selected =
    (selectedId ? traffic.find((event) => event.id === selectedId) : undefined) ??
    fallback;

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 20,
  });

  useEffect(() => {
    if (!autoScroll) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [filtered.length, autoScroll]);

  if (!device) return null;

  const presentation = transportPresentation(device.config.transport.type);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (!nearBottom && autoScroll) setAutoScroll(false);
  }

  function toggleAutoScroll() {
    setAutoScroll((value) => {
      if (!value) {
        const element = scrollRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      }
      return !value;
    });
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4 xl:overflow-hidden">
      <div className="flex min-h-full flex-col gap-3 xl:h-full">
        <SendPanel />

        <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
          <div className="panel flex h-[58vh] min-h-[320px] flex-col overflow-hidden xl:h-auto xl:min-h-0 xl:flex-1">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
              <div className="flex items-center rounded-lg border border-white/10 p-0.5">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      direction === filter.value
                        ? 'bg-white/10 text-mist-100'
                        : 'text-mist-500 hover:text-mist-300'
                    }`}
                    onClick={() => setDirection(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[150px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-500" />
                <input
                  className="field h-8 py-0 pl-8 text-xs"
                  placeholder="搜索 hex、字段、规则…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <span className="hidden text-[10.5px] text-mist-500 sm:inline">
                {filtered.length} / {traffic.length}
              </span>

              <button
                className={`btn btn-ghost btn-sm ${autoScroll ? 'text-accent-300' : ''}`}
                onClick={toggleAutoScroll}
                title={autoScroll ? '暂停自动滚动' : '恢复自动滚动'}
              >
                {autoScroll ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">自动滚动</span>
              </button>

              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void clearTraffic(device.config.id)}
                title="清空报文记录"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">清空</span>
              </button>
            </div>

            <div
              className={`${GRID} shrink-0 border-b border-white/10 bg-ink-900/80 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-mist-500`}
            >
              <span>时间</span>
              <span>方向</span>
              <span>长度</span>
              <span className="hidden md:block">规则</span>
              <span>报文 / 解码</span>
            </div>

            {traffic.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <div className="max-w-sm text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                    <Terminal className="h-5 w-5 text-mist-500" />
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-mist-200">还没有报文</h3>
                  <p className="mt-1.5 text-xs leading-5 text-mist-500">
                    {presentation.trafficEmptyHint}
                    也可以用上方面板手动发送一帧。
                  </p>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-mist-500">
                没有匹配的报文
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-auto"
                onScroll={handleScroll}
              >
                <div
                  className="relative w-full"
                  style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const event = filtered[virtualRow.index];
                    if (!event) return null;
                    const isSelected = selected?.id === event.id;
                    return (
                      <div
                        key={event.id}
                        className="absolute left-0 top-0 w-full"
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <button
                          className={`${GRID} h-full w-full border-b border-white/[0.04] px-3 text-left transition-colors ${
                            isSelected
                              ? 'bg-accent-500/[0.07]'
                              : 'hover:bg-white/[0.03]'
                          }`}
                          onClick={() => setSelectedId(event.id)}
                        >
                          <span className="font-mono text-[10.5px] text-mist-500">
                            {formatTime(event.ts)}
                          </span>
                          <DirectionBadge direction={event.direction} />
                          <span className="font-mono text-[10.5px] text-mist-500">
                            {event.size > 0 ? `${event.size} B` : '—'}
                          </span>
                          <span className="hidden min-w-0 md:block">
                            {event.rule ? (
                              <span
                                className="inline-block max-w-full truncate rounded border border-accent-500/20 bg-accent-500/[0.07] px-1.5 py-0.5 text-[10px] text-accent-300"
                                title={event.rule}
                              >
                                {event.rule}
                              </span>
                            ) : (
                              <span className="text-[10.5px] text-mist-600">—</span>
                            )}
                          </span>
                          <span
                            className={`truncate font-mono text-[11px] ${
                              event.error ? 'text-rose-300' : 'text-mist-300'
                            }`}
                            title={summaryOf(event)}
                          >
                            {summaryOf(event)}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {selected && (
            <EventDetail
              event={selected}
              codec={device?.config.codec}
              className="max-h-[70vh] xl:max-h-none xl:w-[390px] xl:shrink-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
