import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Save } from 'lucide-react';
import YAML from 'yaml';
import { api, ApiError } from '../api/client';
import { useAppStore } from '../store';
import type { DeviceConfig, DeviceDetail, ValidationIssue } from '../types';
import { YamlEditor } from './YamlEditor';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ConfigPanel({ device }: { device: DeviceDetail }) {
  const updateDevice = useAppStore((state) => state.updateDevice);
  const showToast = useAppStore((state) => state.showToast);

  const currentYaml = useMemo(
    () => YAML.stringify(device.config, { indent: 2, lineWidth: 0 }),
    [device.config],
  );

  const [text, setText] = useState(currentYaml);
  const [dirty, setDirty] = useState(false);
  const [validated, setValidated] = useState<DeviceConfig | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const running =
    device.status.state === 'running' || device.status.state === 'starting';

  useEffect(() => {
    if (!dirty) setText(currentYaml);
  }, [currentYaml, dirty]);

  function updateText(next: string) {
    setText(next);
    setDirty(true);
    setValidated(null);
    setIssues([]);
    setError(null);
  }

  async function handleValidate(): Promise<DeviceConfig | null> {
    setValidating(true);
    setIssues([]);
    setError(null);
    try {
      const config = await api.validateYaml(text);
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

  async function handleSave() {
    if (running) {
      setError('设备运行中，请先停止后再保存配置。');
      return;
    }
    const config = await handleValidate();
    if (!config) return;
    if (config.id !== device.config.id) {
      setError('设备 ID 不能修改。如需更换 ID，请新建设备。');
      return;
    }

    setSaving(true);
    try {
      await updateDevice(device.config.id, config);
      setDirty(false);
      setValidated(null);
    } catch (err) {
      if (err instanceof ApiError && err.issues) setIssues(err.issues);
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setText(currentYaml);
    setDirty(false);
    setValidated(null);
    setIssues([]);
    setError(null);
  }

  function handleCopy() {
    void navigator.clipboard
      .writeText(text)
      .then(() => showToast('YAML 已复制', 'success'))
      .catch(() => showToast('复制失败，请检查浏览器权限', 'error'));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-xs font-medium text-mist-200">设备配置</span>
        <span className="chip font-mono text-[10px]">YAML</span>
        {running && (
          <span className="rounded-md border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 text-[10.5px] text-amber-300">
            运行中 · 停止后可保存
          </span>
        )}
        {dirty && (
          <span className="rounded-md border border-sky-400/20 bg-sky-400/[0.07] px-2 py-0.5 text-[10.5px] text-sky-300">
            未保存
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            disabled={!dirty || saving}
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
            disabled={validating || saving}
          >
            {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            校验
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleSave()}
            disabled={running || validating || saving}
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

      <div className="min-h-0 flex-1">
        <YamlEditor value={text} onChange={updateText} />
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs leading-5 text-rose-200">
          {error}
        </div>
      )}

      {issues.length > 0 && (
        <div className="max-h-32 shrink-0 overflow-y-auto rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2">
          <ul className="space-y-1 text-xs leading-5 text-rose-200">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <span className="font-mono text-rose-300">{issue.path || '(root)'}</span>：
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validated && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-500/20 bg-accent-500/[0.05] px-3 py-2 text-[11px] text-accent-200">
          <span className="inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />
            校验通过
          </span>
          <span className="font-mono">id: {validated.id}</span>
          <span className="font-mono">
            监听: {validated.transport.host}:{validated.transport.port}
          </span>
          <span>{validated.rules.length} 条规则</span>
        </div>
      )}
    </div>
  );
}
