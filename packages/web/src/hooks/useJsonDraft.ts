import { useCallback, useEffect, useRef, useState } from 'react';
import { isPlainObject, stringifyJsonValue } from '../lib/config-serialize';
import { useEditorMode, type EditorMode } from './useEditorMode';

export type JsonDraft<T extends Record<string, unknown>> = {
  mode: EditorMode;
  value: T;
  text: string;
  dirty: boolean;
  error: string | null;

  updateValue: (next: T) => void;
  updateText: (next: string) => void;
  switchMode: (next: EditorMode) => boolean;
  parseText: () => T | null;
  reset: () => void;
  load: (next: T) => void;
  markSaved: () => void;
  setError: (message: string | null) => void;
};

export function useJsonDraft<T extends Record<string, unknown>>(
  initial: T,
  surface: string,
  options: {
    baseline?: T;
    baselineKey?: string;
    noun?: string;
  } = {},
): JsonDraft<T> {
  const noun = options.noun ?? 'JSON';
  const [mode, setModePreference] = useEditorMode(surface);
  const [value, setValue] = useState<T>(initial);
  const [text, setText] = useState(() => stringifyJsonValue(initial));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baselineRef = useRef<T>(options.baseline ?? initial);
  const valueMatchesTextRef = useRef(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback((next: T) => {
    baselineRef.current = next;
    setValue(next);
    setText(stringifyJsonValue(next));
    setDirty(false);
    valueMatchesTextRef.current = true;
    setError(null);
  }, []);

  const baselineKey = options.baselineKey;
  const baseline = options.baseline;

  useEffect(() => {
    if (!baseline || baselineKey === undefined) return;
    baselineRef.current = baseline;
    if (dirty) return;
    setValue(baseline);
    setText(stringifyJsonValue(baseline));
    valueMatchesTextRef.current = true;
    setError(null);
    // The key is the external-baseline change detector; the object identity of
    // baseline is intentionally not a dependency to avoid resets on re-render.
  }, [baselineKey]);

  const updateValue = useCallback((next: T) => {
    setValue(next);
    valueMatchesTextRef.current = false;
    setDirty(true);
    setError(null);
  }, []);

  const updateText = useCallback((next: string) => {
    setText(next);
    valueMatchesTextRef.current = false;
    setDirty(true);
    setError(null);
  }, []);

  const parseText = useCallback((): T | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (caught) {
      if (mountedRef.current) {
        setError(
          `JSON 解析失败：${caught instanceof Error ? caught.message : String(caught)}`,
        );
      }
      return null;
    }
    if (!isPlainObject(parsed)) {
      setError(`${noun}必须是 JSON 对象`);
      return null;
    }
    setValue(parsed as T);
    setText(stringifyJsonValue(parsed));
    valueMatchesTextRef.current = true;
    setError(null);
    return parsed as T;
  }, [text, noun]);

  const switchMode = useCallback(
    (next: EditorMode): boolean => {
      if (next === mode) return true;
      if (next === 'code') {
        if (!valueMatchesTextRef.current) {
          setText(stringifyJsonValue(value));
          valueMatchesTextRef.current = true;
        }
        setModePreference('code');
        setError(null);
        return true;
      }
      if (!valueMatchesTextRef.current && !parseText()) {
        return false;
      }
      setModePreference('visual');
      setError(null);
      return true;
    },
    [mode, value, setModePreference, parseText],
  );

  const reset = useCallback(() => {
    load(baselineRef.current);
  }, [load]);

  const markSaved = useCallback(() => {
    setDirty(false);
    valueMatchesTextRef.current = mode === 'code';
    setError(null);
  }, [mode]);

  return {
    mode,
    value,
    text,
    dirty,
    error,
    updateValue,
    updateText,
    switchMode,
    parseText,
    reset,
    load,
    markSaved,
    setError,
  };
}
