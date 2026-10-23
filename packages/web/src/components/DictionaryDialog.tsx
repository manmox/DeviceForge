import {
  DictionaryEntriesSchema,
  DictionaryIdSchema,
} from '@deviceforge/core/schema';
import {
  BookOpen,
  Check,
  Code2,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useAppStore } from '../store';
import type {
  DictionaryInput,
  DictionarySummary,
  ValidationIssue,
} from '../types';
import {
  entriesToVisualRows,
  parseDictionaryEntries,
  visualRowsToEntries,
  type DictionaryVisualRow,
} from '../lib/dictionary-editor';
import { CodeEditor } from './CodeEditor';
import { DictionaryVisualEditor } from './DictionaryVisualEditor';
import {
  FormField,
  InlineWarning,
  SegmentedControl,
  TextArea,
  TextInput,
} from './form/FormControls';
import { ValidationIssues } from './ValidationIssues';

interface DictionaryDraft {
  id: string;
  name: string;
  description: string;
  entriesText: string;
  rows: DictionaryVisualRow[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDraft(dictionary: DictionarySummary): DictionaryDraft {
  return {
    id: dictionary.id,
    name: dictionary.name,
    description: dictionary.description ?? '',
    entriesText: JSON.stringify(dictionary.entries, null, 2),
    rows: entriesToVisualRows(dictionary.entries),
  };
}

function uniqueDictionaryId(base: string, dictionaries: DictionarySummary[]): string {
  const ids = new Set(dictionaries.map((dictionary) => dictionary.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function DictionaryDialog() {
  const dictionaries = useAppStore((state) => state.dictionaries);
  const loading = useAppStore((state) => state.dictionariesLoading);
  const dialog = useAppStore((state) => state.dictionaryDialog);
  const close = useAppStore((state) => state.closeDictionaryManager);
  const createDictionary = useAppStore((state) => state.createDictionary);
  const updateDictionary = useAppStore((state) => state.updateDictionary);
  const deleteDictionary = useAppStore((state) => state.deleteDictionary);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    dialog.focusId ?? dictionaries[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DictionaryDraft | null>(null);
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadedIdRef = useRef<string | null>(null);

  const selected = dictionaries.find((dictionary) => dictionary.id === selectedId);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return dictionaries;
    return dictionaries.filter(
      (dictionary) =>
        dictionary.name.toLowerCase().includes(keyword) ||
        dictionary.id.toLowerCase().includes(keyword),
    );
  }, [dictionaries, search]);
  function canDiscard(): boolean {
    if (saving) return false;
    if (!dirty) return true;
    return window.confirm('当前字典有未保存的修改，继续将丢弃这些修改。');
  }

  function requestClose() {
    if (!canDiscard()) return;
    close();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!canDiscard()) return;
      close();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, dirty, saving]);

  useEffect(() => {
    if (!dialog.focusId) return;
    setCreating(false);
    setSelectedId(dialog.focusId);
  }, [dialog.focusId]);

  useEffect(() => {
    if (creating) return;
    if (selectedId && dictionaries.some((dictionary) => dictionary.id === selectedId)) {
      return;
    }
    setSelectedId(dictionaries[0]?.id ?? null);
  }, [creating, dictionaries, selectedId]);

  // 只在切换选中项时加载草稿；后台 WS 刷新列表不会重置正在编辑的内容。
  useEffect(() => {
    if (creating) {
      loadedIdRef.current = null;
      return;
    }
    if (!selected) {
      loadedIdRef.current = null;
      setDraft(null);
      return;
    }
    if (loadedIdRef.current === selected.id) return;
    loadedIdRef.current = selected.id;
    setDraft(toDraft(selected));
    setEditorMode('visual');
    setDirty(false);
    setIssues([]);
    setError(null);
  }, [creating, selected, selectedId]);

  function patch(partial: Partial<DictionaryDraft>) {
    setDraft((current) => (current ? { ...current, ...partial } : current));
    setDirty(true);
    setIssues([]);
    setError(null);
  }

  function patchRows(rows: DictionaryVisualRow[]) {
    patch({
      rows,
      entriesText: JSON.stringify(visualRowsToEntries(rows), null, 2),
    });
  }

  function switchEditorMode(nextMode: 'visual' | 'json') {
    if (!draft || nextMode === editorMode) return;

    if (nextMode === 'json') {
      const rowIssues: ValidationIssue[] = [];
      const seen = new Set<string>();
      for (const row of draft.rows) {
        if (row.code.trim() === '') {
          rowIssues.push({ path: 'entries', message: '条目码值不能为空' });
        } else if (seen.has(row.code)) {
          rowIssues.push({ path: `entries.${row.code}`, message: `码值 ${row.code} 重复` });
        }
        seen.add(row.code);
      }
      if (rowIssues.length > 0) {
        setIssues(rowIssues);
        setError('请先修正可视化表格中的码值。');
        return;
      }
      const entries = visualRowsToEntries(draft.rows);
      setDraft((current) => current
        ? { ...current, entriesText: JSON.stringify(entries, null, 2) }
        : current);
      setEditorMode('json');
      setIssues([]);
      setError(null);
      return;
    }

    const parsed = parseDictionaryEntries(draft.entriesText);
    if (!parsed.success) {
      setIssues(parsed.issues);
      setError('JSON 内容无效，修正后才能切换到可视化视图。');
      return;
    }
    setDraft((current) => current
      ? {
          ...current,
          rows: entriesToVisualRows(parsed.data),
          entriesText: JSON.stringify(parsed.data, null, 2),
        }
      : current);
    setEditorMode('visual');
    setIssues([]);
    setError(null);
  }

  function selectDictionary(id: string) {
    if (id === selectedId) return;
    if (!canDiscard()) return;
    setCreating(false);
    setSelectedId(id);
  }

  function startCreate() {
    if (!canDiscard()) return;
    setCreating(true);
    setSelectedId(null);
    setDraft({
      id: uniqueDictionaryId('new-dictionary', dictionaries),
      name: '新数据字典',
      description: '',
      entriesText: '{}',
      rows: [],
    });
    setEditorMode('visual');
    setDirty(false);
    setIssues([]);
    setError(null);
  }

  function cancelCreate() {
    setCreating(false);
    const fallback = dictionaries[0];
    setSelectedId(fallback?.id ?? null);
    setDraft(fallback ? toDraft(fallback) : null);
    setEditorMode('visual');
    setDirty(false);
    setIssues([]);
    setError(null);
  }

  function validateDraft(): DictionaryInput | null {
    if (!draft) return null;
    const nextIssues: ValidationIssue[] = [];
    const idResult = DictionaryIdSchema.safeParse(draft.id.trim());
    if (!idResult.success) {
      nextIssues.push(...zodIssues(idResult.error).map((issue) => ({
        ...issue,
        path: `id${issue.path ? `.${issue.path}` : ''}`,
      })));
    } else {
      const collision = dictionaries.find(
        (dictionary) =>
          dictionary.id !== idResult.data &&
          dictionary.id.toLowerCase() === idResult.data.toLowerCase(),
      );
      if (collision) {
        nextIssues.push({
          path: 'id',
          message: `已存在仅大小写不同的字典 ID：${collision.id}`,
        });
      }
    }
    if (draft.name.trim() === '') {
      nextIssues.push({ path: 'name', message: '名称不能为空' });
    }
    let entries: DictionaryInput['entries'] | undefined;
    if (editorMode === 'json') {
      const parsed = parseDictionaryEntries(draft.entriesText);
      if (!parsed.success) nextIssues.push(...parsed.issues);
      else entries = parsed.data;
    } else {
      const seen = new Set<string>();
      for (const row of draft.rows) {
        if (row.code.trim() === '') {
          nextIssues.push({ path: 'entries', message: '条目码值不能为空' });
        } else if (seen.has(row.code)) {
          nextIssues.push({ path: `entries.${row.code}`, message: `码值 ${row.code} 重复` });
        }
        seen.add(row.code);
      }
      const entriesResult = DictionaryEntriesSchema.safeParse(
        visualRowsToEntries(draft.rows),
      );
      if (!entriesResult.success) {
        nextIssues.push(...zodIssues(entriesResult.error).map((issue) => ({
          ...issue,
          path: `entries${issue.path ? `.${issue.path}` : ''}`,
        })));
      } else {
        entries = entriesResult.data;
      }
    }

    if (!idResult.success || nextIssues.length > 0 || !entries) {
      setIssues(nextIssues);
      setError('请先修正字典配置。');
      return null;
    }

    return {
      id: idResult.data,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      entries,
    };
  }

  async function save() {
    const input = validateDraft();
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      if (creating) {
        const created = await createDictionary(input);
        setCreating(false);
        setSelectedId(created.id);
      } else {
        const updated = await updateDictionary(input.id, input);
        setDraft(toDraft(updated));
        loadedIdRef.current = updated.id;
      }
      setDirty(false);
      setIssues([]);
    } catch (caught) {
      if (caught instanceof ApiError && caught.issues) {
        setIssues(caught.issues);
        setError('保存失败，请查看问题列表。');
      } else {
        setError(errorText(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;
    if (selected.usedBy.length > 0) {
      setError(
        `字典仍被 ${selected.usedBy.length} 台设备引用：${selected.usedBy
          .map((device) => device.name)
          .join('、')}`,
      );
      return;
    }
    if (!window.confirm(`确定删除字典「${selected.name}」？此操作不可撤销。`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteDictionary(selected.id);
      const fallback = dictionaries.find((dictionary) => dictionary.id !== selected.id);
      setSelectedId(fallback?.id ?? null);
      setDraft(fallback ? toDraft(fallback) : null);
      loadedIdRef.current = fallback?.id ?? null;
      setEditorMode('visual');
      setDirty(false);
      setIssues([]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  const readOnly = saving;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="数据字典管理"
    >
      <div className="animate-fade-in flex h-[min(88vh,760px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/50">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
          <BookOpen className="h-4 w-4 text-accent-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-mist-100">数据字典</div>
            <div className="text-[10.5px] text-mist-500">
              仅保存在本机；设备只保存 ID，修改后立即生效
            </div>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-mist-500" />}
          <button
            type="button"
            className="btn btn-ghost rounded-lg p-1.5"
            onClick={requestClose}
            aria-label="关闭数据字典"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="space-y-2 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-500" />
                <TextInput
                  value={search}
                  onChange={setSearch}
                  placeholder="搜索名称或 ID"
                  className="pl-8"
                  ariaLabel="搜索数据字典"
                />
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm w-full"
                onClick={startCreate}
                disabled={saving}
              >
                <Plus className="h-3.5 w-3.5" />
                新建字典
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
              {filtered.length > 0 && (
                <DictionaryGroup
                  title="本机字典"
                  dictionaries={filtered}
                  selectedId={selectedId}
                  onSelect={selectDictionary}
                />
              )}
              {filtered.length === 0 && (
                <div className="mx-2 rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[11px] leading-5 text-mist-500">
                  {dictionaries.length === 0
                    ? '还没有数据字典。创建一份码表后即可在多个设备中复用。'
                    : '没有匹配的字典。'}
                </div>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-3 sm:p-4">
            {!draft ? (
              <div className="flex h-full items-center justify-center text-xs text-mist-500">
                选择左侧字典，或新建一份。
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-mist-100">
                    {draft.name || '未命名字典'}
                  </h3>
                  <span className="chip font-mono text-[10px]">{draft.id}</span>
                  <span className="chip border-accent-500/20 text-[10px] text-accent-300">
                    {creating ? '新建' : '本机自定义'}
                  </span>
                  {dirty && (
                    <span className="chip border-amber-400/20 text-[10px] text-amber-300">
                      未保存
                    </span>
                  )}
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <FormField label="字典 ID" hint="字母/数字/_/-，创建后不可修改。">
                    <TextInput
                      value={draft.id}
                      onChange={(id) => patch({ id })}
                      disabled={!creating || saving}
                      monospace
                      placeholder="vendor-codes"
                    />
                  </FormField>
                  <FormField label="名称" required>
                    <TextInput
                      value={draft.name}
                      onChange={(name) => patch({ name })}
                      disabled={readOnly}
                      placeholder="厂商数据码"
                    />
                  </FormField>
                </div>

                <FormField label="描述">
                  <TextArea
                    value={draft.description}
                    onChange={(description) => patch({ description })}
                    rows={2}
                    disabled={readOnly}
                    placeholder="可选，说明码表来源和用途"
                  />
                </FormField>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-mist-400">字典内容</div>
                      <div className="mt-0.5 text-[10px] text-mist-500">
                        可视化表格和 JSON 源码编辑同一份草稿。
                      </div>
                    </div>
                    <SegmentedControl
                      ariaLabel="字典编辑视图"
                      value={editorMode}
                      onChange={switchEditorMode}
                      disabled={saving}
                      size="sm"
                      options={[
                        {
                          value: 'visual',
                          label: '可视化',
                          icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
                        },
                        {
                          value: 'json',
                          label: 'JSON 源码',
                          icon: <Code2 className="h-3.5 w-3.5" />,
                        },
                      ]}
                    />
                  </div>
                  {editorMode === 'visual' ? (
                    <DictionaryVisualEditor
                      rows={draft.rows}
                      onChange={patchRows}
                      disabled={readOnly}
                    />
                  ) : (
                    <FormField
                      label="条目 JSON"
                      hint="数据码 → { name, unit, multi, description, valueFormat }"
                    >
                      <CodeEditor
                        value={draft.entriesText}
                        onChange={(entriesText) => patch({ entriesText })}
                        language="json"
                        height="420px"
                        readOnly={readOnly}
                        ariaLabel="数据字典条目 JSON"
                      />
                    </FormField>
                  )}
                </div>

                {error && <InlineWarning>{error}</InlineWarning>}
                <ValidationIssues issues={issues} />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                  <div className="text-[10.5px] leading-4 text-mist-500">
                    {selected
                      ? selected.usedBy.length > 0
                        ? `被 ${selected.usedBy.length} 台设备引用：${selected.usedBy
                            .map((device) => device.name)
                            .join('、')}`
                        : '当前没有设备引用此字典'
                      : '保存后即可在设备 repeat 中选择'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {creating ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={cancelCreate}
                        disabled={saving}
                      >
                        取消
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void remove()}
                        disabled={saving || (selected?.usedBy.length ?? 0) > 0}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void save()}
                      disabled={saving || !dirty && !creating}
                    >
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function DictionaryGroup({
  title,
  dictionaries,
  selectedId,
  onSelect,
}: {
  title: string;
  dictionaries: DictionarySummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-mist-500">
        <span>{title}</span>
        <span>{dictionaries.length}</span>
      </div>
      <div className="space-y-0.5">
        {dictionaries.map((dictionary) => {
          const selected = dictionary.id === selectedId;
          return (
            <button
              key={dictionary.id}
              type="button"
              className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
              }`}
              onClick={() => onSelect(dictionary.id)}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-mist-200">
                  {dictionary.name}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mist-500">
                <span className="truncate font-mono">{dictionary.id}</span>
                <span className="shrink-0">
                  {Object.keys(dictionary.entries).length} 项
                </span>
                {dictionary.usedBy.length > 0 && (
                  <span className="shrink-0">
                    {dictionary.usedBy.length} 台设备
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
