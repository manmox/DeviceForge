import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  FileCode2,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAppStore } from '../store';
import type { DeviceConfig, Preset, ValidationIssue } from '../types';
import { YamlEditor } from './YamlEditor';

const BLANK_TEMPLATE = `id: my-device
name: 我的设备
transport:
  type: tcp-server
  host: 127.0.0.1
  port: 19010
framing:
  type: raw
codec:
  type: raw
  display: hex
state: {}
rules: []
autoStart: false
`;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function NewDeviceDialog({
  onClose,
  initialPresetFile,
}: {
  onClose: () => void;
  initialPresetFile?: string | null;
}) {
  const presets = useAppStore((state) => state.presets);
  const devices = useAppStore((state) => state.devices);
  const createDevice = useAppStore((state) => state.createDevice);

  const [mode, setMode] = useState<'presets' | 'editor'>('presets');
  const [yaml, setYaml] = useState(BLANK_TEMPLATE);
  const [validated, setValidated] = useState<DeviceConfig | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!initialPresetFile) return;
    const preset = presets.find((item) => item.file === initialPresetFile);
    if (preset) {
      setYaml(preset.yaml);
      setMode('editor');
    }
  }, [initialPresetFile, presets]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function openPreset(preset: Preset) {
    setYaml(preset.yaml);
    setValidated(null);
    setIssues([]);
    setError(null);
    setMode('editor');
  }

  function openBlank() {
    setYaml(BLANK_TEMPLATE);
    setValidated(null);
    setIssues([]);
    setError(null);
    setMode('editor');
  }

  function updateYaml(next: string) {
    setYaml(next);
    setValidated(null);
    setIssues([]);
    setError(null);
  }

  async function validate(): Promise<DeviceConfig | null> {
    setValidating(true);
    setIssues([]);
    setError(null);
    try {
      const config = await api.validateYaml(yaml);
      setValidated(config);
      return config;
    } catch (err) {
      if (err instanceof ApiError && err.issues) setIssues(err.issues);
      setError(errorText(err));
      return null;
    } finally {
      setValidating(false);
    }
  }

  const idConflict = validated
    ? devices.some((device) => device.config.id === validated.id)
    : false;

  async function handleCreate() {
    const config = validated ?? (await validate());
    if (!config) return;
    if (devices.some((device) => device.config.id === config.id)) {
      setError(`设备 ID「${config.id}」已存在，请修改 YAML 中的 id 后再创建。`);
      return;
    }

    setCreating(true);
    setIssues([]);
    setError(null);
    try {
      await createDevice(config);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.issues) setIssues(err.issues);
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="animate-fade-in flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/50"
        role="dialog"
        aria-modal="true"
        aria-label="新建设备"
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          {mode === 'editor' ? (
            <button
              className="btn btn-ghost mt-0.5 rounded-lg p-1.5"
              onClick={() => setMode('presets')}
              aria-label="返回预设"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-accent-500/25 bg-accent-500/10">
              <Sparkles className="h-4 w-4 text-accent-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-mist-100">
              {mode === 'presets' ? '选择起点' : '新建设备'}
            </h2>
            <p className="mt-0.5 text-xs text-mist-500">
              {mode === 'presets'
                ? '从预设开始，或使用空白配置自己定义协议。'
                : '编辑 YAML，校验通过后创建设备。设备默认只监听本机地址。'}
            </p>
          </div>
          <button
            className="btn btn-ghost rounded-lg p-1.5"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'presets' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <button
                className="group flex min-h-[150px] flex-col items-start rounded-xl border border-dashed border-white/15 px-4 py-4 text-left transition-colors hover:border-accent-500/40 hover:bg-accent-500/[0.04]"
                onClick={openBlank}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                  <Plus className="h-4 w-4 text-mist-300" />
                </div>
                <h3 className="mt-3 text-sm font-medium text-mist-100">空白配置</h3>
                <p className="mt-1.5 text-xs leading-5 text-mist-500">
                  一个裸 TCP 设备，从零开始定义 framing、codec 和规则。
                </p>
              </button>

              {presets.map((preset) => (
                <button
                  key={preset.file}
                  className="group flex min-h-[150px] flex-col items-start rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.04]"
                  onClick={() => openPreset(preset)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="chip font-mono text-[10px]">
                      TCP :{preset.config.transport.port}
                    </span>
                    <FileCode2 className="h-4 w-4 text-mist-500 transition-colors group-hover:text-accent-400" />
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-mist-100">{preset.name}</h3>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-mist-500">
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
              <div className="h-[52vh] min-h-[300px]">
                <YamlEditor value={yaml} onChange={updateYaml} />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2 text-xs leading-5 text-rose-200">
                  {error}
                </div>
              )}

              {issues.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2">
                  <ul className="space-y-1 text-xs leading-5 text-rose-200">
                    {issues.map((issue, index) => (
                      <li key={`${issue.path}-${index}`}>
                        <span className="font-mono text-rose-300">
                          {issue.path || '(root)'}
                        </span>
                        ：{issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validated && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-500/20 bg-accent-500/[0.05] px-3 py-2 text-xs text-accent-200">
                  <span className="inline-flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" />
                    校验通过
                  </span>
                  <span className="font-mono">id: {validated.id}</span>
                  <span>名称: {validated.name}</span>
                  <span className="font-mono">
                    监听: {validated.transport.host}:{validated.transport.port}
                  </span>
                  <span>{validated.rules.length} 条规则</span>
                  {idConflict && (
                    <span className="text-amber-300">该 ID 已存在，请修改 id</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3.5">
              <p className="hidden text-[11px] text-mist-500 sm:block">
                设备 ID 不能与现有设备重复；端口被占用时启动会提示。
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-outline"
                  onClick={() => void validate()}
                  disabled={validating || creating}
                >
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  校验配置
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleCreate()}
                  disabled={validating || creating || idConflict}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  创建设备
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
