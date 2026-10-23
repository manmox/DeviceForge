import { describe, expect, it } from 'vitest';
import {
  entriesToVisualRows,
  parseDictionaryEntries,
  visualRowsToEntries,
} from '../dictionary-editor';

describe('数据字典可视化编辑转换', () => {
  it('在表格行与 JSON 源码之间保留 valueFormat 和可选字段', () => {
    const entries = {
      '000': { name: '电压', unit: 'V', multi: false, description: '测试点' },
      '220': {
        name: '波形',
        valueFormat: {
          type: 'int16Array' as const,
          points: 2048,
          endian: 'le' as const,
          encoding: 'base64' as const,
          crc: { algo: 'crc16-modbus' as const, endian: 'be' as const },
        },
      },
    };
    const rows = entriesToVisualRows(entries);

    expect(visualRowsToEntries(rows)).toEqual(entries);
    const source = JSON.stringify(visualRowsToEntries(rows), null, 2);
    const parsed = parseDictionaryEntries(source);
    expect(parsed).toEqual({ success: true, data: entries });
  });

  it('源码不是合法字典条目时返回可定位的问题', () => {
    expect(parseDictionaryEntries('{')).toMatchObject({
      success: false,
      issues: [{ path: 'entries', message: expect.stringContaining('JSON 解析失败') }],
    });
    expect(parseDictionaryEntries('{"220":{"valueFormat":{"type":"other"}}}')).toMatchObject({
      success: false,
      issues: [
        {
          path: expect.stringContaining('entries.220.valueFormat.type'),
        },
      ],
    });
  });
});
