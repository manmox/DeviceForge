import type { DeviceStatus } from '../types';

const STYLES: Record<
  DeviceStatus['state'],
  { label: string; dot: string; text: string; wrapper: string }
> = {
  running: {
    label: '运行中',
    dot: 'bg-accent-400',
    text: 'text-accent-300',
    wrapper: 'border-accent-500/25 bg-accent-500/10',
  },
  starting: {
    label: '启动中',
    dot: 'bg-amber-400 animate-pulse',
    text: 'text-amber-300',
    wrapper: 'border-amber-400/25 bg-amber-400/10',
  },
  stopped: {
    label: '已停止',
    dot: 'bg-mist-500',
    text: 'text-mist-400',
    wrapper: 'border-white/10 bg-white/5',
  },
  error: {
    label: '错误',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    wrapper: 'border-rose-400/25 bg-rose-400/10',
  },
};

export function StatusBadge({
  state,
  compact = false,
}: {
  state: DeviceStatus['state'];
  compact?: boolean;
}) {
  const style = STYLES[state] ?? STYLES.stopped;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${style.wrapper} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {!compact && style.label}
    </span>
  );
}
