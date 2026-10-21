import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useAppStore } from '../store';

const STYLES = {
  success: {
    icon: CheckCircle2,
    wrapper: 'border-accent-500/30 bg-ink-800',
    iconClass: 'text-accent-400',
  },
  error: {
    icon: AlertTriangle,
    wrapper: 'border-rose-500/30 bg-ink-800',
    iconClass: 'text-rose-400',
  },
  info: {
    icon: Info,
    wrapper: 'border-sky-500/30 bg-ink-800',
    iconClass: 'text-sky-400',
  },
} as const;

export function Toast() {
  const toast = useAppStore((state) => state.toast);
  const clearToast = useAppStore((state) => state.clearToast);

  if (!toast) return null;

  const style = STYLES[toast.kind];
  const Icon = style.icon;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
      <div
        className={`animate-fade-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl shadow-black/40 ${style.wrapper}`}
        role="status"
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-mist-200">
          {toast.message}
        </p>
        <button
          className="rounded-md p-1 text-mist-500 transition-colors hover:bg-white/5 hover:text-mist-200"
          onClick={() => clearToast(toast.id)}
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
