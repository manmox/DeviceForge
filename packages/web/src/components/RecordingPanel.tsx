import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { formatTime } from '../lib/format';
import { pageOffsetFor, playbackDelay } from '../lib/recording-playback';
import { useAppStore } from '../store';
import type { RecordedTrafficEvent, RecordingSession } from '../types';
import { EventDetail } from './EventDetail';

const PAGE_SIZE = 200;
const SPEEDS = [0.5, 1, 2, 4] as const;

function recordingLabel(recording: RecordingSession): string {
  const date = new Date(recording.startedAt).toLocaleString();
  const state = {
    recording: '录制中',
    stopped: '已完成',
    interrupted: '未正常结束',
    error: '写入失败',
  }[recording.state];
  return `${date} · ${state} · ${recording.eventCount} 条`;
}

export function RecordingPanel() {
  const device = useAppStore((state) => state.device);
  const showToast = useAppStore((state) => state.showToast);
  const recordingsRevision = useAppStore((state) => state.recordingsRevision);
  const [recordings, setRecordings] = useState<RecordingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageStart, setPageStart] = useState(0);
  const [events, setEvents] = useState<RecordedTrafficEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [playIndex, setPlayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const pageRequest = useRef(0);

  const selectedRecording = recordings.find((recording) => recording.id === selectedId);
  const activeRecording = recordings.find((recording) => recording.state === 'recording');
  const current = events[playIndex - pageStart];

  const refreshRecordings = useCallback(async () => {
    if (!device) return;
    try {
      const result = await api.listRecordings(device.config.id);
      setRecordings(result);
      setSelectedId((currentId) => currentId ?? result[0]?.id ?? null);
    } catch (error) {
      showToast(`读取录制列表失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }, [device, showToast]);

  const loadPage = useCallback(async (recordingId: string, offset: number): Promise<boolean> => {
    if (!device) return false;
    const requestId = ++pageRequest.current;
    setLoading(true);
    try {
      const result = await api.getRecordingEvents(device.config.id, recordingId, offset, PAGE_SIZE);
      if (pageRequest.current !== requestId) return false;
      setEvents(result.events);
      setTotal(result.total);
      setPageStart(offset);
      return true;
    } catch (error) {
      if (pageRequest.current === requestId) {
        showToast(`读取录制事件失败：${error instanceof Error ? error.message : String(error)}`, 'error');
      }
      return false;
    } finally {
      if (pageRequest.current === requestId) setLoading(false);
    }
  }, [device, showToast]);

  useEffect(() => {
    void refreshRecordings();
    const timer = window.setInterval(() => void refreshRecordings(), 1500);
    return () => window.clearInterval(timer);
  }, [refreshRecordings, recordingsRevision]);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      setTotal(0);
      setPlayIndex(0);
      return;
    }
    setPlaying(false);
    setPlayIndex(0);
    void loadPage(selectedId, 0);
  }, [selectedId, loadPage]);

  useEffect(() => {
    if (!playing || !selectedId || total === 0) return;
    const nextIndex = playIndex + 1;
    if (nextIndex >= total) {
      setPlaying(false);
      return;
    }

    if (nextIndex < pageStart || nextIndex >= pageStart + events.length) {
      const nextPage = pageOffsetFor(nextIndex, PAGE_SIZE);
      let cancelled = false;
      void loadPage(selectedId, nextPage).then((loaded) => {
        if (!cancelled && loaded) setPlayIndex(nextIndex);
      });
      return () => {
        cancelled = true;
        pageRequest.current += 1;
      };
    }

    const previousEvent = events[playIndex - pageStart];
    const nextEvent = events[nextIndex - pageStart];
    const timer = window.setTimeout(
      () => setPlayIndex(nextIndex),
      playbackDelay(previousEvent, nextEvent, speed),
    );
    return () => window.clearTimeout(timer);
  }, [
    events,
    loadPage,
    pageStart,
    playIndex,
    playing,
    selectedId,
    speed,
    total,
  ]);

  if (!device) return null;
  const deviceId = device.config.id;

  async function start() {
    setBusy(true);
    try {
      const recording = await api.startRecording(deviceId);
      await refreshRecordings();
      setSelectedId(recording.id);
      showToast('已开始录制', 'success');
    } catch (error) {
      showToast(`开始录制失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!activeRecording) return;
    setBusy(true);
    try {
      await api.stopRecording(deviceId, activeRecording.id);
      await refreshRecordings();
      showToast('录制已停止', 'success');
    } catch (error) {
      showToast(`停止录制失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedRecording || selectedRecording.state === 'recording') return;
    if (!window.confirm('删除这段本机录制及其全部事件？')) return;
    setBusy(true);
    try {
      await api.deleteRecording(deviceId, selectedRecording.id);
      const next = recordings.filter((recording) => recording.id !== selectedRecording.id);
      setRecordings(next);
      setSelectedId(next[0]?.id ?? null);
      showToast('录制会话已删除', 'success');
    } catch (error) {
      showToast(`删除录制失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function seek(index: number) {
    const next = Math.max(0, Math.min(total - 1, index));
    setPlayIndex(next);
    if (next < pageStart || next >= pageStart + events.length) {
      void loadPage(selectedId!, pageOffsetFor(next, PAGE_SIZE));
    }
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="flex min-h-full flex-col gap-3 xl:flex-row">
        <aside className="panel flex shrink-0 flex-col overflow-hidden xl:w-[310px]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3">
            <div>
              <h2 className="text-sm font-medium text-mist-100">录制会话</h2>
              <p className="mt-0.5 text-[10.5px] text-mist-500">按设备保存在本机</p>
            </div>
            {activeRecording ? (
              <button className="btn btn-danger btn-sm" onClick={() => void stop()} disabled={busy}>
                <Square className="h-3.5 w-3.5" />停止
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => void start()} disabled={busy}>
                <span className="h-2 w-2 rounded-full bg-current" />开始录制
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {recordings.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-mist-500">还没有录制会话</p>
            ) : (
              <div className="flex flex-col gap-1">
                {recordings.map((recording) => (
                  <button
                    key={recording.id}
                    className={`rounded-lg px-3 py-2.5 text-left transition-colors ${selectedId === recording.id ? 'bg-accent-500/10 text-mist-100' : 'text-mist-400 hover:bg-white/[0.04]'}`}
                    onClick={() => setSelectedId(recording.id)}
                  >
                    <span className="block text-[11px]">{recordingLabel(recording)}</span>
                    <span className="mt-1 block truncate font-mono text-[9px] text-mist-600">{recording.id}</span>
                    {recording.error && <span className="mt-1 block text-[10px] text-rose-300">{recording.error}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedRecording && selectedRecording.state !== 'recording' && (
            <div className="border-t border-white/10 p-2">
              <button className="btn btn-ghost btn-sm w-full text-rose-300" onClick={() => void removeSelected()} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" />删除选中会话
              </button>
            </div>
          )}
        </aside>

        <section className="panel flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => selectedId && void loadPage(selectedId, pageStart)}
              disabled={!selectedId || loading}
              title="刷新当前事件页"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => seek(playIndex - 1)} disabled={total === 0} title="单步后退">
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setPlaying((value) => !value)} disabled={total === 0}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? '暂停' : '播放'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => seek(playIndex + 1)} disabled={total === 0 || playIndex >= total - 1} title="单步前进">
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <label className="ml-auto inline-flex items-center gap-2 text-[10.5px] text-mist-500">
              倍速
              <select className="field h-8 w-20 py-0 text-xs" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <span className="font-mono text-[10px] text-mist-500">{total ? `${playIndex + 1} / ${total}` : '0 条事件'}</span>
          </div>

          <div className="border-b border-white/10 px-4 py-3">
            <input
              className="w-full accent-sky-400"
              type="range"
              min={0}
              max={Math.max(0, total - 1)}
              value={total ? Math.min(playIndex, total - 1) : 0}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={total === 0}
              aria-label="录制时间轴"
            />
            <div className="mt-1 flex justify-between text-[10px] text-mist-600">
              <span>{selectedRecording ? formatTime(selectedRecording.startedAt) : '—'}</span>
              <span>{current ? `+${(current.offsetMs / 1000).toFixed(3)} s · ${formatTime(current.event.ts)}` : '—'}</span>
            </div>
          </div>

          {current ? (
            <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
              <div className="min-h-[220px] flex-1 overflow-auto border-b border-white/10 xl:border-b-0 xl:border-r">
                {events.map((recorded, index) => {
                  const absoluteIndex = pageStart + index;
                  const selected = absoluteIndex === playIndex;
                  const direction = recorded.event.direction === 'in'
                    ? '接收'
                    : recorded.event.direction === 'out' ? '发送' : '系统';
                  return (
                    <button
                      key={recorded.event.id}
                      className={`grid w-full grid-cols-[78px_42px_1fr] gap-2 border-b border-white/[0.04] px-3 py-2 text-left text-[10.5px] ${selected ? 'bg-accent-500/[0.08]' : 'hover:bg-white/[0.03]'}`}
                      onClick={() => setPlayIndex(absoluteIndex)}
                    >
                      <span className="font-mono text-mist-500">+{(recorded.offsetMs / 1000).toFixed(2)}s</span>
                      <span className="text-mist-400">{direction}</span>
                      <span className="truncate font-mono text-mist-300">
                        {(recorded.event.mqtt?.topic ?? recorded.event.note ?? recorded.event.data.slice(0, 72)) || '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <EventDetail
                event={current.event}
                codec={device.config.codec}
                className="max-h-[60vh] xl:max-h-none xl:w-[390px] xl:shrink-0"
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-xs text-mist-500">
              {loading ? '正在读取录制事件…' : selectedRecording ? '该会话还没有事件' : '选择或开始一段录制'}
            </div>
          )}
          <p className="border-t border-white/10 px-4 py-2 text-[10px] text-mist-600">
            回放只展示已录制事件，不会连接设备或重新执行规则。
          </p>
        </section>
      </div>
    </div>
  );
}
