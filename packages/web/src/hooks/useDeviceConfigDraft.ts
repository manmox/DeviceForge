import type { DeviceConfig } from '@deviceforge/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { stringifyDeviceConfig } from '../lib/config-serialize';
import type { ValidationIssue } from '../types';
import { useEditorMode, type EditorMode } from './useEditorMode';

export type DeviceConfigDraft = {
  mode: EditorMode;
  config: DeviceConfig;
  yaml: string;
  dirty: boolean;
  switching: boolean;
  validating: boolean;
  validated: DeviceConfig | null;
  issues: ValidationIssue[];
  error: string | null;

  updateConfig: (next: DeviceConfig) => void;
  updateYaml: (next: string) => void;
  switchMode: (next: EditorMode) => Promise<boolean>;
  validate: () => Promise<DeviceConfig | null>;
  reset: () => void;
  load: (config: DeviceConfig, yaml?: string) => void;
  markSaved: (saved?: DeviceConfig) => void;
  yamlForCopy: () => string;
  reportError: (error: unknown) => void;
  clearValidation: () => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDeviceConfigDraft(initial: {
  config: DeviceConfig;
  yaml?: string;
}): DeviceConfigDraft {
  const [mode, setModePreference] = useEditorMode('config');
  const [config, setConfig] = useState(initial.config);
  const [yaml, setYaml] = useState(
    () => initial.yaml ?? stringifyDeviceConfig(initial.config),
  );
  const [dirty, setDirty] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<DeviceConfig | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  // versionRef 用于让编辑后返回的旧异步校验/切换结果失效；
  // codeMatchesConfigRef 表示 YAML 是当前权威形式；switchingRef 保证异步
  // 模式切换串行执行。
  const baselineRef = useRef({ config: initial.config, yaml });
  const codeMatchesConfigRef = useRef(true);
  const versionRef = useRef(0);
  const mountedRef = useRef(true);
  const switchingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearValidation = useCallback(() => {
    setValidated(null);
    setIssues([]);
    setError(null);
  }, []);

  const applyError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.issues) {
      setIssues(caught.issues);
      setError('配置校验失败，请查看问题列表。');
      return;
    }
    setIssues([]);
    setError(errorText(caught));
  }, []);

  const updateConfig = useCallback(
    (next: DeviceConfig) => {
      versionRef.current += 1;
      setConfig(next);
      codeMatchesConfigRef.current = false;
      setDirty(true);
      clearValidation();
    },
    [clearValidation],
  );

  const updateYaml = useCallback(
    (next: string) => {
      versionRef.current += 1;
      setYaml(next);
      codeMatchesConfigRef.current = false;
      setDirty(true);
      clearValidation();
    },
    [clearValidation],
  );

  const switchMode = useCallback(
    async (next: EditorMode): Promise<boolean> => {
      if (next === mode) return true;
      if (switchingRef.current) return false;

      if (next === 'code') {
        if (!codeMatchesConfigRef.current) {
          setYaml(stringifyDeviceConfig(config));
          codeMatchesConfigRef.current = true;
        }
        setModePreference('code');
        clearValidation();
        return true;
      }

      if (codeMatchesConfigRef.current) {
        setModePreference('visual');
        return true;
      }

      switchingRef.current = true;
      setSwitching(true);
      setIssues([]);
      setError(null);
      const version = versionRef.current;
      try {
        const normalized = await api.validateYaml(yaml);
        if (!mountedRef.current || version !== versionRef.current) return false;
        setConfig(normalized);
        codeMatchesConfigRef.current = true;
        setValidated(null);
        setIssues([]);
        setError(null);
        setModePreference('visual');
        return true;
      } catch (caught) {
        if (!mountedRef.current || version !== versionRef.current) return false;
        applyError(caught);
        return false;
      } finally {
        switchingRef.current = false;
        if (mountedRef.current) setSwitching(false);
      }
    },
    [mode, config, yaml, setModePreference, clearValidation, applyError],
  );

  const validate = useCallback(async (): Promise<DeviceConfig | null> => {
    const version = versionRef.current;
    setValidating(true);
    setIssues([]);
    setError(null);
    try {
      const normalized =
        mode === 'visual'
          ? await api.validateConfig(config)
          : await api.validateYaml(yaml);
      if (!mountedRef.current || version !== versionRef.current) return null;
      setConfig(normalized);
      setValidated(normalized);
      setIssues([]);
      setError(null);
      codeMatchesConfigRef.current = mode === 'code';
      return normalized;
    } catch (caught) {
      if (!mountedRef.current || version !== versionRef.current) return null;
      applyError(caught);
      return null;
    } finally {
      if (mountedRef.current) setValidating(false);
    }
  }, [mode, config, yaml, applyError]);

  const load = useCallback((nextConfig: DeviceConfig, nextYaml?: string) => {
    const code = nextYaml ?? stringifyDeviceConfig(nextConfig);
    baselineRef.current = { config: nextConfig, yaml: code };
    versionRef.current += 1;
    setConfig(nextConfig);
    setYaml(code);
    setDirty(false);
    codeMatchesConfigRef.current = true;
    setValidated(null);
    setIssues([]);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    load(baselineRef.current.config, baselineRef.current.yaml);
  }, [load]);

  const markSaved = useCallback(
    (saved?: DeviceConfig) => {
      if (saved) setConfig(saved);
      setDirty(false);
      setValidated(null);
      codeMatchesConfigRef.current = mode === 'code';
    },
    [mode],
  );

  const yamlForCopy = useCallback(
    () => (codeMatchesConfigRef.current ? yaml : stringifyDeviceConfig(config)),
    [yaml, config],
  );

  return {
    mode,
    config,
    yaml,
    dirty,
    switching,
    validating,
    validated,
    issues,
    error,
    updateConfig,
    updateYaml,
    switchMode,
    validate,
    reset,
    load,
    markSaved,
    yamlForCopy,
    reportError: applyError,
    clearValidation,
  };
}
