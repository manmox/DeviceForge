import type {
  CodecConfig,
  TextCodecConfig,
  TextDictionaryEntry,
  TextField,
  TextMessage,
  TextRepeat,
  TextSlot,
} from '@deviceforge/core';
import type { DictionaryRegistry } from '../types';

export function isTextCodec(
  codec: CodecConfig | undefined,
): codec is TextCodecConfig {
  return codec?.type === 'text';
}

export function newTextField(name: string, type: TextField['type'] = 'string'): TextField {
  return {
    kind: 'field',
    name,
    type,
    padChar: '0',
    optional: false,
    sequenceStart: 1,
    patternSeverity: 'error',
    allowEmpty: false,
  };
}

export function newTextMessage(name: string): TextMessage {
  return {
    name,
    slots: [newTextField('payload')],
  };
}

export function newTextRepeat(name = 'items'): TextRepeat {
  return {
    kind: 'repeat',
    name,
    countField: 'count',
    itemSeparator: '*',
    valueSeparator: '|',
    valueField: 'values',
    fields: [
      newTextField('id'),
      { ...newTextField('values', 'stringList'), valueSeparator: '|' },
    ],
  };
}

export function topLevelFieldSlots(message: TextMessage): TextField[] {
  return message.slots.filter((slot): slot is TextField => slot.kind === 'field');
}

export function topLevelRepeatSlots(message: TextMessage): TextRepeat[] {
  return message.slots.filter(
    (slot): slot is TextRepeat => slot.kind === 'repeat',
  );
}

export function allTopLevelFields(
  codec: TextCodecConfig,
): { name: string; type?: string; description?: string }[] {
  const seen = new Set<string>();
  const fields: { name: string; type?: string; description?: string }[] = [];
  for (const message of codec.messages) {
    for (const slot of message.slots) {
      if (slot.kind === 'literal' || seen.has(slot.name)) continue;
      seen.add(slot.name);
      fields.push({
        name: slot.name,
        type: slot.kind === 'repeat' ? 'array' : slot.type,
        description:
          slot.kind === 'repeat'
            ? slot.description ?? `重复组 · ${slot.name}`
            : slot.description,
      });
    }
  }
  return fields;
}

export function allTopLevelNames(codec: TextCodecConfig): string[] {
  return allTopLevelFields(codec).map((field) => field.name);
}

export function findMessage(
  codec: TextCodecConfig,
  name: string,
): TextMessage | undefined {
  return codec.messages.find((message) => message.name === name);
}

export function findRepeatByMapField(
  codec: TextCodecConfig,
  mapField: string,
): { message: TextMessage; repeat: TextRepeat } | undefined {
  for (const message of codec.messages) {
    for (const slot of message.slots) {
      if (slot.kind === 'repeat' && slot.mapField === mapField) {
        return { message, repeat: slot };
      }
    }
  }
  return undefined;
}

export function dictionaryOf(
  registry: DictionaryRegistry | undefined,
  repeat: TextRepeat,
): Record<string, TextDictionaryEntry> | undefined {
  const definition = repeat.dictionary
    ? registry?.get(repeat.dictionary)
    : undefined;
  return definition?.entries;
}

export function dictionaryEntry(
  registry: DictionaryRegistry | undefined,
  repeat: TextRepeat,
  key: string,
): TextDictionaryEntry | undefined {
  return dictionaryOf(registry, repeat)?.[key];
}

export function mapKeyFor(
  prefix: string | undefined,
  value: unknown,
): string {
  const raw = String(value ?? '');
  let key = `${prefix ?? ''}${raw}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    key = `c_${raw.replace(/[^A-Za-z0-9_]/g, '_')}`;
  }
  return key;
}

export function mapKeyForCode(
  repeat: TextRepeat,
  code: string,
): string {
  return mapKeyFor(repeat.mapKeyPrefix, code);
}

export function defaultFieldValue(field: TextField): unknown {
  switch (field.type) {
    case 'int':
      return 0;
    case 'decimal':
      return '0';
    case 'string':
      return 'value';
    case 'stringList':
      return ['value'];
    case 'timestamp':
      return '';
    case 'int16Array':
      return [];
  }
}

function defaultRepeatItem(
  repeat: TextRepeat,
  registry?: DictionaryRegistry,
): Record<string, unknown> {
  const dictionary = dictionaryOf(registry, repeat);
  const entries = dictionary
    ? Object.entries(dictionary).sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];
  const normalEntry = entries.find(([, entry]) => !entry.valueFormat);
  const [code, entry] = normalEntry ?? entries[0] ?? ['000', undefined];
  const item: Record<string, unknown> = {};

  for (const field of repeat.fields) {
    if (field.name === repeat.keyField && code) {
      item[field.name] = code;
      continue;
    }
    if (field.name === repeat.valueField) {
      item[field.name] = entry?.valueFormat
        ? Array.from({ length: entry.valueFormat.points }, () => 0)
        : ['0'];
      continue;
    }
    item[field.name] = defaultFieldValue(field);
  }
  return item;
}

export function defaultFieldsForTextMessage(
  codec: TextCodecConfig,
  message: TextMessage,
  registry?: DictionaryRegistry,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { kind: message.name };

  for (const slot of message.slots) {
    if (slot.kind === 'literal') continue;
    if (slot.kind === 'repeat') {
      fields[slot.name] = [defaultRepeatItem(slot, registry)];
      continue;
    }
    if (
      slot.optional ||
      slot.auto !== undefined ||
      slot.default !== undefined ||
      slot.defaultFrom !== undefined
    ) {
      continue;
    }
    fields[slot.name] = defaultFieldValue(slot);
  }

  return fields;
}

export function defaultFieldsForTextCodec(
  codec: TextCodecConfig,
  registry?: DictionaryRegistry,
): Record<string, unknown> {
  const message = codec.messages[0];
  return message ? defaultFieldsForTextMessage(codec, message, registry) : {};
}

export function slotSummary(slot: TextSlot): string {
  if (slot.kind === 'literal') return `literal ${slot.value}`;
  if (slot.kind === 'repeat') {
    return `repeat ${slot.name} × ${slot.countField}`;
  }
  return `${slot.type} ${slot.name}`;
}

export function textCodecHint(codec: TextCodecConfig): string {
  return `text · ${codec.messages.length} 报文 · 「${codec.separator}」`;
}
