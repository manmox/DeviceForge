import type { ModbusTables } from '@deviceforge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NumberInput, SelectInput } from '../form/FormControls';

type TableName = keyof ModbusTables;
type TableValue = boolean | number;

const TABLES: { value: TableName; label: string; boolean: boolean }[] = [
  { value: 'coils', label: '线圈', boolean: true },
  { value: 'discreteInputs', label: '离散输入', boolean: true },
  { value: 'holdingRegisters', label: '保持寄存器', boolean: false },
  { value: 'inputRegisters', label: '输入寄存器', boolean: false },
];

export function ModbusTablesEditor({
  tables,
  onChange,
  disabled = false,
}: {
  tables: ModbusTables;
  onChange: (tables: ModbusTables) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<TableName>('coils');
  const definition = TABLES.find((table) => table.value === selected)!;
  const values = tables[selected] as Record<string, TableValue>;
  const rows = Object.entries(values).sort(([left], [right]) => Number(left) - Number(right));

  function update(next: Record<string, TableValue>) {
    onChange({ ...tables, [selected]: next } as ModbusTables);
  }

  function addRow() {
    let address = 0;
    while (Object.hasOwn(values, String(address)) && address < 65_535) address += 1;
    if (Object.hasOwn(values, String(address))) return;
    update({ ...values, [address]: definition.boolean ? false : 0 });
  }

  function changeAddress(oldAddress: string, address: number | undefined) {
    if (address === undefined || address < 0 || address > 65_535) return;
    const nextAddress = String(address);
    if (nextAddress !== oldAddress && Object.hasOwn(values, nextAddress)) return;
    const next = { ...values };
    const value = next[oldAddress]!;
    delete next[oldAddress];
    next[nextAddress] = value;
    update(next);
  }

  function changeValue(address: string, value: TableValue) {
    update({ ...values, [address]: value });
  }

  function removeRow(address: string) {
    const next = { ...values };
    delete next[address];
    update(next);
  }

  return (
    <div className="sm:col-span-2 rounded-xl border border-white/10 bg-ink-900/30 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium text-mist-200">线圈与寄存器表</h3>
          <p className="mt-1 text-[10.5px] text-mist-500">地址使用零基 PDU 地址；未配置的地址会返回非法数据地址异常。</p>
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-mist-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50" onClick={addRow} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" /> 添加地址
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {TABLES.map((table) => (
          <button
            key={table.value}
            type="button"
            aria-pressed={selected === table.value}
            onClick={() => setSelected(table.value)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${selected === table.value ? 'bg-white/10 text-mist-100' : 'text-mist-500 hover:bg-white/[0.04] hover:text-mist-300'}`}
          >
            {table.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-[11px] text-mist-500">该表暂无已配置地址</div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(110px,1fr)_32px] gap-2 px-1 text-[10px] text-mist-500">
            <span>地址</span><span>初始值</span><span />
          </div>
          {rows.map(([address, value]) => (
            <div key={address} className="grid grid-cols-[minmax(90px,1fr)_minmax(110px,1fr)_32px] items-center gap-2">
              <NumberInput value={Number(address)} onChange={(next) => changeAddress(address, next)} min={0} max={65_535} step={1} disabled={disabled} ariaLabel={`${definition.label} 地址`} />
              {definition.boolean ? (
                <SelectInput<string>
                  value={String(value)}
                  options={[{ value: 'false', label: 'OFF' }, { value: 'true', label: 'ON' }]}
                  onChange={(next) => changeValue(address, next === 'true')}
                  disabled={disabled}
                  ariaLabel={`${definition.label} ${address} 初始值`}
                />
              ) : (
                <NumberInput value={Number(value)} onChange={(next) => next !== undefined && changeValue(address, next)} min={0} max={65_535} step={1} disabled={disabled} ariaLabel={`${definition.label} ${address} 初始值`} />
              )}
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-mist-500 transition-colors hover:bg-white/[0.05] hover:text-rose-300 disabled:opacity-50" onClick={() => removeRow(address)} disabled={disabled} aria-label={`删除地址 ${address}`} title="删除地址">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
