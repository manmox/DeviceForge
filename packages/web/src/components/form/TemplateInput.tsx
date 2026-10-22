import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  applyTemplateSuggestion,
  buildTemplateSuggestions,
  filterTemplateSuggestions,
  findTemplateCompletionToken,
  type TemplateCompletionContext,
  type TemplateSuggestion,
} from '../../lib/template-suggestions';

export interface TemplateFocusRequest {
  id: number;
  caret?: number;
  open?: boolean;
}

type PopupPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function suggestionsAt(
  value: string,
  caret: number,
  context: TemplateCompletionContext,
): TemplateSuggestion[] {
  const token = findTemplateCompletionToken(value, caret);
  if (!token) return [];
  return filterTemplateSuggestions(
    buildTemplateSuggestions(token, context),
    token.segment,
  );
}

export function TemplateInput({
  value,
  onChange,
  context,
  placeholder = '$state.temp 或 ${...}',
  disabled = false,
  className = '',
  ariaLabel,
  focusRequest,
}: {
  value: string;
  onChange: (value: string) => void;
  context: TemplateCompletionContext;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  focusRequest?: TemplateFocusRequest;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // pendingCaret 要在受控 value 提交后的 layout effect 中恢复，否则 React 会重置选区；
  // composingRef 用于跳过输入法组合期间的补全按键。
  const pendingCaret = useRef<number | null>(null);
  const composingRef = useRef(false);
  const lastFocusRequestRef = useRef<number | null>(null);
  const listId = useId();

  const [caret, setCaret] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const suggestions = useMemo(
    () => suggestionsAt(value, caret, context),
    [value, caret, context],
  );
  const visible = open && !disabled && suggestions.length > 0;
  const currentIndex =
    suggestions.length > 0
      ? Math.min(activeIndex, suggestions.length - 1)
      : 0;

  useEffect(() => {
    setCaret((current) => Math.min(current, value.length));
  }, [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (open && !disabled && suggestions.length === 0) setOpen(false);
  }, [open, disabled, suggestions.length]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const input = inputRef.current;
    const nextCaret = Math.min(pendingCaret.current, value.length);
    pendingCaret.current = null;
    if (!input) return;
    input.focus();
    input.setSelectionRange(nextCaret, nextCaret);
    setCaret(nextCaret);
  }, [value]);

  useLayoutEffect(() => {
    const request = focusRequest;
    if (!request || lastFocusRequestRef.current === request.id) return;
    lastFocusRequestRef.current = request.id;
    const input = inputRef.current;
    if (!input) return;

    const nextCaret = Math.min(request.caret ?? value.length, value.length);
    input.focus();
    input.setSelectionRange(nextCaret, nextCaret);
    setCaret(nextCaret);

    if (request.open) {
      const next = suggestionsAt(value, nextCaret, context);
      setOpen(next.length > 0);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  }, [focusRequest, value, context]);

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }
    const input = inputRef.current;
    if (!input) return;

    const rect = input.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, 320), viewportWidth - 16);
    const left = Math.min(
      Math.max(rect.left, 8),
      Math.max(8, viewportWidth - width - 8),
    );
    const spaceBelow = viewportHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const available = placeAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(40, Math.min(320, available));

    setPosition(
      placeAbove
        ? {
            left,
            width,
            maxHeight,
            bottom: viewportHeight - rect.top + 4,
          }
        : {
            left,
            width,
            maxHeight,
            top: rect.bottom + 4,
          },
    );
  }, [visible, suggestions.length]);

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (inputRef.current?.contains(target) || popupRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleResize = () => setOpen(false);

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const option = popupRef.current?.querySelector<HTMLElement>(
      `[data-template-index="${currentIndex}"]`,
    );
    option?.scrollIntoView({ block: 'nearest' });
  }, [visible, currentIndex]);

  function openAt(input: HTMLInputElement, nextCaret: number) {
    setCaret(nextCaret);
    const next = suggestionsAt(value, nextCaret, context);
    if (next.length > 0) {
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.value;
    const nextCaret = event.currentTarget.selectionStart ?? next.length;
    setCaret(nextCaret);
    onChange(next);
    if (composingRef.current) return;

    const nextSuggestions = suggestionsAt(next, nextCaret, context);
    if (nextSuggestions.length > 0) {
      setOpen(true);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  }

  function handleSelect(event: SyntheticEvent<HTMLInputElement>) {
    setCaret(event.currentTarget.selectionStart ?? value.length);
  }

  function handleCompositionStart() {
    composingRef.current = true;
    setOpen(false);
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    const nextCaret = event.currentTarget.selectionStart ?? value.length;
    setCaret(nextCaret);
    const next = suggestionsAt(value, nextCaret, context);
    if (next.length > 0) {
      setOpen(true);
      setActiveIndex(0);
    }
  }

  function accept(suggestion: TemplateSuggestion) {
    const result = applyTemplateSuggestion(value, suggestion);
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    onChange(result.value);

    if (result.reopen) {
      const next = suggestionsAt(result.value, result.caret, context);
      setOpen(next.length > 0);
      setActiveIndex(0);
    } else {
      setOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composingRef.current) return;

    if (
      (event.ctrlKey || event.metaKey) &&
      (event.code === 'Space' || event.key === ' ')
    ) {
      event.preventDefault();
      openAt(event.currentTarget, event.currentTarget.selectionStart ?? value.length);
      return;
    }

    if (!visible) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((currentIndex + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        (currentIndex - 1 + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(suggestions.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const suggestion = suggestions[currentIndex];
      if (!suggestion) return;
      event.preventDefault();
      accept(suggestion);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className={`field h-8 py-0 font-mono text-xs ${className}`}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onFocus={() => {
          const input = inputRef.current;
          if (input) setCaret(input.selectionStart ?? value.length);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? '模板值'}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={
          visible && suggestions[currentIndex]
            ? `${listId}-option-${currentIndex}`
            : undefined
        }
        autoComplete="off"
        spellCheck={false}
      />

      {visible &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            style={{
              position: 'fixed',
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              top: position.top,
              bottom: position.bottom,
              zIndex: 1000,
            }}
            className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-ink-900/95 shadow-2xl shadow-black/50 backdrop-blur-sm"
          >
            <div
              id={listId}
              role="listbox"
              aria-label="模板建议"
              className="min-h-0 flex-1 overflow-y-auto py-1"
            >
              {suggestions.map((suggestion, index) => (
                <div
                  key={`${suggestion.id}:${index}`}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === currentIndex}
                  data-template-index={index}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    accept(suggestion);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`mx-1 cursor-pointer rounded-md px-2 py-1.5 transition-colors ${
                    index === currentIndex
                      ? 'bg-accent-500/10'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-mist-100">
                      {suggestion.label}
                    </span>
                    {suggestion.detail && (
                      <span className="ml-auto max-w-[55%] shrink-0 truncate text-right text-[10px] text-mist-500">
                        {suggestion.detail}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10.5px] leading-4 text-mist-500">
                    {suggestion.description}
                  </div>
                </div>
              ))}
            </div>
            <div className="shrink-0 border-t border-white/10 px-2.5 py-1 text-[10px] text-mist-500">
              ↑↓ 选择 · Enter/Tab 插入 · Esc 关闭
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
