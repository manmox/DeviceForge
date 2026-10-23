import { Plus, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DictionaryVisualRow } from '../lib/dictionary-editor';
import {
  NumberInput,
  SelectInput,
  SwitchInput,
  TextInput,
} from './form/FormControls';

type ValueFormat = NonNullable<DictionaryVisualRow['valueFormat']>;

const DEFAULT_VALUE_FORMAT: ValueFormat = {
  type: 'int16Array',
  points: 1024,
  endian: 'be',
  encoding: 'hex',
};

export function DictionaryVisualEditor({
  rows,
  onChange,
  disabled = false,
}: {
  rows: DictionaryVisualRow[];
  onChange: (rows: DictionaryVisualRow[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.code, row.name, row.unit, row.description]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLocaleLowerCase().includes(keyword)),
    );
  }, [rows, search]);

  function patchRow(rowKey: string, patch: Partial<DictionaryVisualRow>) {
    onChange(rows.map((row) =>
      row.rowKey === rowKey ? { ...row, ...patch } : row,
    ));
  }

  function addRow() {
    let code = 'new-code';
    let suffix = 2;
    while (rows.some((row) => row.code === code)) {
      code = `new-code-${suffix}`;
      suffix += 1;
    }
    onChange([...rows, { rowKey: code, code }]);
    setSearch('');
  }

  function removeRow(rowKey: string) {
    onChange(rows.filter((row) => row.rowKey !== rowKey));
    if (expandedRowKey === rowKey) setExpandedRowKey(null);
  }

  function setValueFormat(row: DictionaryVisualRow, enabled: boolean) {
    const { valueFormat: _valueFormat, ...withoutFormat } = row;
    patchRow(row.rowKey, {
      ...withoutFormat,
      valueFormat: enabled ? { ...DEFAULT_VALUE_FORMAT } : undefined,
    });
  }

  function patchFormat(row: DictionaryVisualRow, patch: Partial<ValueFormat>) {
    patchRow(row.rowKey, {
      valueFormat: { ...DEFAULT_VALUE_FORMAT, ...row.valueFormat, ...patch },
    });
  }

  function setCrc(row: DictionaryVisualRow, enabled: boolean) {
    const format = { ...DEFAULT_VALUE_FORMAT, ...row.valueFormat };
    if (enabled) {
      patchFormat(row, { crc: { algo: 'crc16-modbus', endian: 'le' } });
    } else {
      const { crc: _crc, ...withoutCrc } = format;
      patchFormat(row, withoutCrc);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/10">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="mr-auto flex items-baseline gap-2">
          <span className="text-xs font-medium text-mist-200">字典条目</span>
          <span className="font-mono text-[10px] text-mist-500">{rows.length} 项</span>
        </div>
        <TextInput
          value={search}
          onChange={setSearch}
          className="w-40"
          placeholder="筛选码值或名称"
          ariaLabel="筛选字典条目"
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={addRow}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          添加条目
        </button>
      </div>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-ink-850 text-[10px] font-medium text-mist-500">
            <tr>
              <th className="w-28 border-b border-white/10 px-3 py-2">码值</th>
              <th className="w-44 border-b border-white/10 px-2 py-2">名称</th>
              <th className="w-28 border-b border-white/10 px-2 py-2">单位</th>
              <th className="w-16 border-b border-white/10 px-2 py-2 text-center">多值</th>
              <th className="border-b border-white/10 px-2 py-2">描述</th>
              <th className="w-32 border-b border-white/10 px-2 py-2">波形格式</th>
              <th className="w-10 border-b border-white/10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const expanded = expandedRowKey === row.rowKey;
              return (
                <DictionaryEntryRows
                  key={row.rowKey}
                  row={row}
                  expanded={expanded}
                  disabled={disabled}
                  onPatch={(patch) => patchRow(row.rowKey, patch)}
                  onToggleFormat={() =>
                    setExpandedRowKey(expanded ? null : row.rowKey)
                  }
                  onRemove={() => removeRow(row.rowKey)}
                  onSetValueFormat={(enabled) => setValueFormat(row, enabled)}
                  onPatchFormat={(patch) => patchFormat(row, patch)}
                  onSetCrc={(enabled) => setCrc(row, enabled)}
                />
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-mist-500">
                  {rows.length === 0 ? '还没有条目，添加第一项码值。' : '没有匹配的条目。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[10px] leading-4 text-mist-500">
        码值用于 repeat 字段查表；波形设置只影响配置了 数组字段 的条目。
      </div>
    </div>
  );
}

function DictionaryEntryRows({
  row,
  expanded,
  disabled,
  onPatch,
  onToggleFormat,
  onRemove,
  onSetValueFormat,
  onPatchFormat,
  onSetCrc,
}: {
  row: DictionaryVisualRow;
  expanded: boolean;
  disabled: boolean;
  onPatch: (patch: Partial<DictionaryVisualRow>) => void;
  onToggleFormat: () => void;
  onRemove: () => void;
  onSetValueFormat: (enabled: boolean) => void;
  onPatchFormat: (patch: Partial<ValueFormat>) => void;
  onSetCrc: (enabled: boolean) => void;
}) {
  const format = row.valueFormat;

  return (
    <>
      <tr className="border-b border-white/[0.06] align-middle hover:bg-white/[0.02]">
        <td className="px-2 py-1.5">
          <TextInput
            value={row.code}
            onChange={(code) => onPatch({ code })}
            className="font-mono"
            ariaLabel={`条目 ${row.code || '新建'} 的码值`}
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          <TextInput
            value={row.name ?? ''}
            onChange={(name) => onPatch({ name })}
            ariaLabel={`条目 ${row.code} 的名称`}
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          <TextInput
            value={row.unit ?? ''}
            onChange={(unit) => onPatch({ unit })}
            ariaLabel={`条目 ${row.code} 的单位`}
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5 text-center">
          <SwitchInput
            checked={row.multi === true}
            onChange={(multi) => onPatch({ multi })}
            label={`条目 ${row.code} 的多值选项`}
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          <TextInput
            value={row.description ?? ''}
            onChange={(description) => onPatch({ description })}
            ariaLabel={`条目 ${row.code} 的描述`}
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:opacity-40 ${
              format
                ? 'bg-sky-400/10 text-sky-200 hover:bg-sky-400/15'
                : 'text-mist-500 hover:bg-white/[0.05] hover:text-mist-300'
            }`}
            onClick={onToggleFormat}
            aria-expanded={expanded}
            disabled={disabled}
          >
            <Settings2 className="h-3 w-3" />
            {format ? '数组字段' : '配置格式'}
          </button>
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            className="btn btn-ghost rounded-md p-1.5 text-mist-500 hover:text-rose-300"
            onClick={onRemove}
            aria-label={`删除条目 ${row.code}`}
            disabled={disabled}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/[0.06] bg-sky-400/[0.025]">
          <td colSpan={7} className="px-4 py-3">
            {!format ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-mist-200">波形数据格式</div>
                  <div className="mt-0.5 text-[10px] text-mist-500">
                    将此码值配置为 int16Array，支持字节序、hex/base64 与 CRC16-Modbus。
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onSetValueFormat(true)}
                  disabled={disabled}
                >
                  配置 数组字段
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-mist-200">数组字段 波形参数</div>
                    <div className="mt-0.5 font-mono text-[10px] text-mist-500">
                      {format.type} · CRC16-Modbus {format.crc ? '开启' : '关闭'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-mist-400"
                    onClick={() => onSetValueFormat(false)}
                    disabled={disabled}
                  >
                    移除波形格式
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-mist-500">点数</span>
                    <NumberInput
                      value={format.points}
                      onChange={(points) => {
                        if (points !== undefined) onPatchFormat({ points });
                      }}
                      min={1}
                      max={65536}
                      step={1}
                      disabled={disabled}
                      ariaLabel={`条目 ${row.code} 的波形点数`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-mist-500">字节序</span>
                    <SelectInput
                      value={format.endian}
                      options={[
                        { value: 'be', label: '大端（BE）' },
                        { value: 'le', label: '小端（LE）' },
                      ]}
                      onChange={(endian) => onPatchFormat({ endian })}
                      disabled={disabled}
                      ariaLabel={`条目 ${row.code} 的波形字节序`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-mist-500">编码</span>
                    <SelectInput
                      value={format.encoding}
                      options={[
                        { value: 'hex', label: 'Hex' },
                        { value: 'base64', label: 'Base64' },
                      ]}
                      onChange={(encoding) => onPatchFormat({ encoding })}
                      disabled={disabled}
                      ariaLabel={`条目 ${row.code} 的波形编码`}
                    />
                  </label>
                  <div className="rounded-lg border border-white/[0.06] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] text-mist-200">CRC16-Modbus</div>
                        <div className="mt-0.5 text-[10px] text-mist-500">
                          {format.crc ? `字节序 ${format.crc.endian.toUpperCase()}` : '不校验 CRC'}
                        </div>
                      </div>
                      <SwitchInput
                        checked={format.crc !== undefined}
                        onChange={onSetCrc}
                        label={`条目 ${row.code} 的 CRC16-Modbus`}
                        disabled={disabled}
                      />
                    </div>
                    {format.crc && (
                      <div className="mt-2">
                        <SelectInput
                          value={format.crc.endian}
                          options={[
                            { value: 'be', label: 'CRC 大端' },
                            { value: 'le', label: 'CRC 小端' },
                          ]}
                          onChange={(endian) =>
                            onPatchFormat({
                              crc: { algo: 'crc16-modbus', endian },
                            })
                          }
                          disabled={disabled}
                          ariaLabel={`条目 ${row.code} 的 CRC 字节序`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
