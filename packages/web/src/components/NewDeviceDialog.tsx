import {
  ArrowLeft,
  FileCode2,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeviceConfigDraft } from '../hooks/useDeviceConfigDraft';
import type { ConfigSectionId } from '../lib/config-sections';
import { createBlankConfig, uniqueDeviceId } from '../lib/config-defaults';
import { stringifyDeviceConfig } from '../lib/config-serialize';
import { useAppStore } from '../store';
import type { Preset } from '../types';
import { CodeEditor } from './CodeEditor';
import { DeviceConfigForm } from './config/DeviceConfigForm';
import { EditorModeToggle } from './form/EditorModeToggle';
import { ValidationIssues, ValidationSummary } from './ValidationIssues';

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

  const initialConfig = useMemo(() => createBlankConfig(), []);
  const initialYaml = useMemo(
    () => stringifyDeviceConfig(initialConfig),
    [initialConfig],
  );
  const draft = useDeviceConfigDraft({ config: initialConfig, yaml: initialYaml });

  const [step, setStep] = useState<'presets' | 'editor'>('presets');
  const [creating, setCreating] = useState(false);
  const [activeSection, setActiveSection] = useState<ConfigSectionId>('basic');

  useEffect(() => {
    if (!initialPresetFile) return;
    const preset = presets.find((item) => item.file === initialPresetFile);
    if (!preset) return;
    draft.load(preset.config, preset.yaml);
    setActiveSection('basic');
    setStep('editor');
  }, [initialPresetFile, presets, draft.load]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const candidateId =
    draft.mode === 'visual' ? draft.config.id : draft.validated?.id;
  const idConflict = candidateId
    ? devices.some((device) => device.config.id === candidateId)
    : false;

  function openPreset(preset: Preset) {
    draft.load(preset.config, preset.yaml);
    setActiveSection('basic');
    setStep('editor');
  }

  function openBlank() {
    const base = createBlankConfig();
    const config = {
      ...base,
      id: uniqueDeviceId(devices.map((device) => device.config.id)),
    };
    draft.load(config, stringifyDeviceConfig(config));
    setActiveSection('basic');
    setStep('editor');
  }

  async function handleValidate() {
    await draft.validate();
  }

  async function handleCreate() {
    const config = await draft.validate();
    if (!config) return;
    if (devices.some((device) => device.config.id === config.id)) {
      draft.reportError(
        new Error(`设备 ID「${config.id}」已存在，请修改 id 后再创建。`),
      );
      return;
    }

    setCreating(true);
    try {
      await createDevice(config);
      onClose();
    } catch (error) {
      draft.reportError(error);
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
        className={`animate-fade-in flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/50 ${
          step === 'editor'
            ? 'h-[min(92vh,56rem)] max-h-[92vh]'
            : 'max-h-[92vh]'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="新建设备"
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          {step === 'editor' ? (
            <button
              className="btn btn-ghost mt-0.5 rounded-lg p-1.5"
              onClick={() => setStep('presets')}
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
              {step === 'presets' ? '选择起点' : '新建设备'}
            </h2>
            <p className="mt-0.5 text-xs text-mist-500">
              {step === 'presets'
                ? '从预设开始，或使用空白配置自己定义协议。'
                : '用可视化表单或 YAML 编辑配置；设备默认只监听本机地址。'}
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

        {step === 'presets' ? (
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
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-mist-400">配置方式</span>
                <EditorModeToggle
                  mode={draft.mode}
                  onChange={(mode) => {
                    void draft.switchMode(mode);
                  }}
                  codeLabel="YAML 源码"
                  disabled={creating}
                  switching={draft.switching}
                />
                <span className="ml-auto text-[10.5px] text-mist-500">
                  配置以 JSON 保存，YAML 注释不会保留。
                </span>
              </div>

              <div className="flex min-h-[280px] flex-1 flex-col">
                {draft.mode === 'visual' ? (
                  <DeviceConfigForm
                    value={draft.config}
                    onChange={draft.updateConfig}
                    issues={draft.issues}
                    disabled={creating}
                    activeSection={activeSection}
                    onActiveSectionChange={setActiveSection}
                  />
                ) : (
                  <div className="min-h-0 flex-1">
                    <CodeEditor
                      value={draft.yaml}
                      onChange={draft.updateYaml}
                      language="yaml"
                      readOnly={creating}
                      ariaLabel="新建设备 YAML 配置"
                    />
                  </div>
                )}
              </div>

              {draft.error && (
                <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2 text-xs leading-5 text-rose-200">
                  {draft.error}
                </div>
              )}

              <ValidationIssues issues={draft.issues} />

              {draft.validated && <ValidationSummary config={draft.validated} />}

              {idConflict && candidateId && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-200">
                  设备 ID「{candidateId}」已存在，请修改 id 后再创建。
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
                  onClick={() => void handleValidate()}
                  disabled={draft.validating || draft.switching || creating}
                >
                  {draft.validating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  校验配置
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleCreate()}
                  disabled={
                    draft.validating || draft.switching || creating || idConflict
                  }
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
