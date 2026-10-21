import { Copy, Loader2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceConfigDraft } from '../hooks/useDeviceConfigDraft';
import type { ConfigSectionId } from '../lib/config-sections';
import { stringifyDeviceConfig } from '../lib/config-serialize';
import { useAppStore } from '../store';
import type { DeviceConfig, DeviceDetail } from '../types';
import { CodeEditor } from './CodeEditor';
import { DeviceConfigForm } from './config/DeviceConfigForm';
import { EditorModeToggle } from './form/EditorModeToggle';
import { ValidationIssues, ValidationSummary } from './ValidationIssues';

export function ConfigPanel({ device }: { device: DeviceDetail }) {
  const updateDevice = useAppStore((state) => state.updateDevice);
  const showToast = useAppStore((state) => state.showToast);

  const currentYaml = useMemo(
    () => stringifyDeviceConfig(device.config),
    [device.config],
  );
  const draft = useDeviceConfigDraft({ config: device.config, yaml: currentYaml });
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<ConfigSectionId>('basic');

  const loadedDeviceIdRef = useRef(device.config.id);
  const lastSyncedConfigRef = useRef<DeviceConfig | null>(null);

  useEffect(() => {
    const deviceChanged = loadedDeviceIdRef.current !== device.config.id;
    if (!deviceChanged && draft.dirty) return;
    if (!deviceChanged && lastSyncedConfigRef.current === device.config) return;
    loadedDeviceIdRef.current = device.config.id;
    lastSyncedConfigRef.current = device.config;
    draft.load(device.config, currentYaml);
  }, [device.config, currentYaml, draft.dirty, draft.load]);

  const running =
    device.status.state === 'running' || device.status.state === 'starting';

  async function handleValidate() {
    await draft.validate();
  }

  async function handleSave() {
    if (running) {
      draft.reportError(new Error('设备运行中，请先停止后再保存配置。'));
      return;
    }
    const config = await draft.validate();
    if (!config) return;
    if (config.id !== device.config.id) {
      draft.reportError(new Error('设备 ID 不能修改。如需更换 ID，请新建设备。'));
      return;
    }

    setSaving(true);
    try {
      await updateDevice(device.config.id, config);
      draft.markSaved(config);
    } catch (error) {
      draft.reportError(error);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    draft.load(device.config, currentYaml);
  }

  function handleCopy() {
    void navigator.clipboard
      .writeText(draft.yamlForCopy())
      .then(() => showToast('YAML 已复制', 'success'))
      .catch(() => showToast('复制失败，请检查浏览器权限', 'error'));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-xs font-medium text-mist-200">设备配置</span>
        <EditorModeToggle
          mode={draft.mode}
          onChange={(mode) => {
            void draft.switchMode(mode);
          }}
          codeLabel="YAML 源码"
          disabled={saving}
          switching={draft.switching}
        />
        {running && (
          <span className="rounded-md border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 text-[10.5px] text-amber-300">
            运行中 · 停止后可保存
          </span>
        )}
        {draft.dirty && (
          <span className="rounded-md border border-sky-400/20 bg-sky-400/[0.07] px-2 py-0.5 text-[10.5px] text-sky-300">
            未保存
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            disabled={!draft.dirty || saving}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新加载
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" />
            复制
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => void handleValidate()}
            disabled={draft.validating || draft.switching || saving}
          >
            {draft.validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            校验
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleSave()}
            disabled={running || draft.validating || draft.switching || saving}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            校验并保存
          </button>
        </div>
      </div>

      {draft.mode === 'visual' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <DeviceConfigForm
            value={draft.config}
            onChange={draft.updateConfig}
            issues={draft.issues}
            idLocked
            disabled={saving}
            activeSection={activeSection}
            onActiveSectionChange={setActiveSection}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 shrink-0 text-[10.5px] text-mist-500">
            源码模式；配置以 JSON 持久化，YAML 注释不会跨保存保留。
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor
              value={draft.yaml}
              onChange={draft.updateYaml}
              language="yaml"
              borderless
              readOnly={saving}
              ariaLabel="YAML 配置源码"
            />
          </div>
        </div>
      )}

      {draft.error && (
        <div className="shrink-0 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs leading-5 text-rose-200">
          {draft.error}
        </div>
      )}

      <ValidationIssues issues={draft.issues} />

      {draft.validated && <ValidationSummary config={draft.validated} />}
    </div>
  );
}
