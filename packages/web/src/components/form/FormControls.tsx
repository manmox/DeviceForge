import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { parseNumberInput } from '../../lib/json-value';

export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-mist-400">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] leading-4 text-mist-500">{hint}</span>}
      {error && <span className="mt-1 block text-[10.5px] leading-4 text-rose-300">{error}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  monospace = false,
  className = '',
  ariaLabel,
  list,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  monospace?: boolean;
  className?: string;
  ariaLabel?: string;
  list?: string;
}) {
  return (
    <input
      className={`field h-8 py-0 text-xs ${monospace ? 'font-mono' : ''} ${className}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      list={list}
      spellCheck={false}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  className = '',
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <textarea
      className={`field resize-y py-2 text-xs leading-5 ${className}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      aria-label={ariaLabel}
      spellCheck={false}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  allowEmpty = false,
  placeholder,
  disabled = false,
  className = '',
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === undefined ? '' : String(value));
  }, [value, focused]);

  function parseDraft(next: string): number | null {
    const parsed = parseNumberInput(next);
    if (parsed === null) return null;
    if (min !== undefined && parsed < min) return null;
    if (max !== undefined && parsed > max) return null;
    return parsed;
  }

  function commit(next: string, final: boolean) {
    const parsed = parseDraft(next);
    if (parsed !== null) {
      onChange(parsed);
      if (final) setDraft(String(parsed));
      return;
    }
    if (!final) return;
    if (allowEmpty && next.trim() === '') {
      onChange(undefined);
      setDraft('');
      return;
    }
    setDraft(value === undefined ? '' : String(value));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`field h-8 py-0 font-mono text-xs ${className}`}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value, false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit(draft, true);
      }}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      step={step}
    />
  );
}

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        className="field h-8 appearance-none py-0 pr-8 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-500" />
    </div>
  );
}

export function SwitchInput({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? 'border-accent-500/40 bg-accent-500/30'
          : 'border-white/10 bg-white/5'
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? 'translate-x-[18px] bg-accent-300' : 'translate-x-[3px] bg-mist-500'
        }`}
      />
    </button>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs text-mist-200">{label}</div>
        {hint && <div className="mt-0.5 text-[10.5px] leading-4 text-mist-500">{hint}</div>}
      </div>
      <SwitchInput checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  size = 'md',
  ariaLabel,
  className = '',
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded-lg border border-white/10 p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center gap-1 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'
          } ${
            value === option.value
              ? 'bg-white/10 text-mist-100'
              : 'text-mist-500 hover:text-mist-300'
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  ariaExpanded,
  ariaControls,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  ariaExpanded?: boolean;
  ariaControls?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm rounded-md p-1.5 ${
        danger ? 'text-rose-300 hover:bg-rose-500/10' : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      title={label}
    >
      {children}
    </button>
  );
}

export function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[10.5px] leading-4 text-amber-300">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
