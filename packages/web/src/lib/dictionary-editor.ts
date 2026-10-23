import { DictionaryEntriesSchema } from '@deviceforge/core/schema';
import type { DictionaryInput } from '../types';

export type DictionaryVisualRow = DictionaryInput['entries'][string] & {
  /** 编辑期间保持稳定，修改码值时不重置输入框焦点。 */
  rowKey: string;
  code: string;
};

export function entriesToVisualRows(
  entries: DictionaryInput['entries'],
): DictionaryVisualRow[] {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([code, entry]) => ({
      rowKey: code,
      code,
      ...entry,
    }));
}

export function visualRowsToEntries(
  rows: readonly DictionaryVisualRow[],
): DictionaryInput['entries'] {
  return Object.fromEntries(
    rows.map((row) => {
      const { rowKey: _rowKey, code, ...entry } = row;
      return [code, entry];
    }),
  );
}

export type DictionaryEntriesParseResult =
  | { success: true; data: DictionaryInput['entries'] }
  | {
      success: false;
      issues: { path: string; message: string }[];
    };

export function parseDictionaryEntries(
  source: string,
): DictionaryEntriesParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      success: false,
      issues: [
        {
          path: 'entries',
          message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = DictionaryEntriesSchema.safeParse(value);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map((issue) => ({
        path: ['entries', ...issue.path.map(String)].join('.'),
        message: issue.message,
      })),
    };
  }
  return { success: true, data: result.data };
}
