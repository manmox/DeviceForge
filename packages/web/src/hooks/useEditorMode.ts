import { useCallback, useState } from 'react';

export type EditorMode = 'visual' | 'code';

const STORAGE_PREFIX = 'deviceforge.editorMode.v1.';

function readMode(key: string, fallback: EditorMode): EditorMode {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'visual' || value === 'code') return value;
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
  return fallback;
}

export function useEditorMode(
  surface: string,
  defaultMode: EditorMode = 'visual',
): [EditorMode, (mode: EditorMode) => void] {
  const storageKey = `${STORAGE_PREFIX}${surface}`;
  const [mode, setModeState] = useState<EditorMode>(() => readMode(storageKey, defaultMode));

  const setMode = useCallback(
    (next: EditorMode) => {
      setModeState(next);
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Ignore storage failures; the in-memory mode still works.
      }
    },
    [storageKey],
  );

  return [mode, setMode];
}
