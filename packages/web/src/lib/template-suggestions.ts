import type { CodecConfig, DeviceInfo, FieldDef } from '@deviceforge/core';
import { TEMPLATE_FUNCTIONS } from '@deviceforge/core/template-functions';
import { fieldSummary } from './config-summary';
import type { RuleTrigger } from './rule-shape';
import {
  allTopLevelFields,
  dictionaryEntry,
  dictionaryOf,
  findRepeatByMapField,
  mapKeyForCode,
} from './text-codec-model';

export type TemplateScope = 'rule-set' | 'rule-send' | 'manual-send';
export type TemplateRoot =
  | 'req'
  | 'state'
  | 'counter'
  | 'conn'
  | 'device'
  | 'now';

export type TemplateSuggestionKind =
  | 'root'
  | 'function'
  | 'field'
  | 'state'
  | 'counter'
  | 'connection'
  | 'device';

export interface TemplateCompletionContext {
  roots: TemplateRoot[];
  codec?: CodecConfig;
  state?: Record<string, unknown>;
  deviceInfo?: DeviceInfo;
  counters?: readonly ('tx' | 'rx')[];
  /** 默认值 4。 */
  maxStateDepth?: number;
  /** 默认值 200。 */
  maxItems?: number;
}

export interface TemplateCompletionToken {
  mode: 'bare' | 'expression';
  /** 裸 token 嵌在其他文本中，插入时需要包一层 `${...}`。 */
  wrap: boolean;
  wordStart: number;
  wordEnd: number;
  segmentStart: number;
  segmentEnd: number;
  parentSegments: string[];
  segment: string;
  dollar: boolean;
  complete: boolean;
  /** 表达式缺少闭合 `}`，可以自动补全。 */
  needsClosing: boolean;
}

export interface TemplateSuggestion {
  id: string;
  kind: TemplateSuggestionKind;
  label: string;
  detail?: string;
  description: string;
  matchText: string;
  insertText: string;
  replaceStart: number;
  replaceEnd: number;
  caretOffset: number;
  reopen: boolean;
  closeExpression: boolean;
}

interface Candidate {
  id: string;
  kind: TemplateSuggestionKind;
  name: string;
  fullPath: string;
  signature?: string;
  detail?: string;
  description: string;
  hasChildren: boolean;
}

const IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PATH_CHAR = /[A-Za-z0-9_.$]/;
const DEFAULT_MAX_STATE_DEPTH = 4;
// 数据码字典约 300 项，上限需要覆盖完整字典；弹窗最终仍只显示前 50 条匹配。
const DEFAULT_MAX_ITEMS = 400;
const MAX_RENDERED = 50;

const FUNCTION_DESCRIPTIONS: Record<string, string> = {
  random: '闭区间随机整数',
  randomFloat: '随机浮点数，保留两位小数',
  and: '逻辑与，所有参数为真时返回 true',
  or: '逻辑或，任一参数为真时返回 true',
  not: '逻辑非，对真值取反',
};

const ROOT_ORDER: TemplateRoot[] = [
  'req',
  'state',
  'counter',
  'conn',
  'device',
  'now',
];

export function templateRootsFor(
  scope: TemplateScope,
  trigger?: RuleTrigger,
): TemplateRoot[] {
  const roots: TemplateRoot[] = [];
  if (scope !== 'manual-send' && trigger === 'frame') roots.push('req');
  roots.push('state', 'counter');
  if (
    scope === 'manual-send' ||
    scope === 'rule-send' ||
    trigger === 'connect' ||
    trigger === 'frame'
  ) {
    roots.push('conn');
  }
  roots.push('device', 'now');
  return roots;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isValidKey(key: string): boolean {
  return IDENT_PATTERN.test(key) && !BLOCKED_KEYS.has(key);
}

function clip(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describeStateValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (typeof value === 'object') return `对象（${Object.keys(value).length} 项）`;
  if (typeof value === 'string') return `文本 ${clip(JSON.stringify(value))}`;
  if (typeof value === 'number') return `数值 ${value}`;
  if (typeof value === 'boolean') return `布尔 ${value}`;
  return typeof value;
}

function stateNodeAt(
  state: Record<string, unknown> | undefined,
  parentSegments: string[],
): unknown {
  let current: unknown = state;
  for (const segment of parentSegments.slice(1)) {
    if (!isValidKey(segment) || !isPlainObject(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasStateChildren(
  value: unknown,
  depth: number,
  maxDepth: number,
): boolean {
  if (depth >= maxDepth || !isPlainObject(value)) return false;
  if (Array.isArray(value)) return true;
  return Object.keys(value).some(isValidKey);
}

function stateChildren(
  value: unknown,
  parentSegments: string[],
  depth: number,
  maxDepth: number,
  limit: number,
): Candidate[] {
  if (depth >= maxDepth || !isPlainObject(value)) return [];
  const hasChildren = (next: unknown) => hasStateChildren(next, depth + 1, maxDepth);
  const basePath = parentSegments.join('.');

  if (Array.isArray(value)) {
    return [
      {
        id: `state:${basePath}.length`,
        kind: 'state',
        name: 'length',
        fullPath: `${basePath}.length`,
        description: '数组长度',
        detail: `数值 ${value.length}`,
        hasChildren: false,
      },
    ];
  }

  const candidates: Candidate[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (candidates.length >= limit) break;
    if (!isValidKey(key)) continue;
    const childPath = `${basePath}.${key}`;
    candidates.push({
      id: `state:${childPath}`,
      kind: 'state',
      name: key,
      fullPath: childPath,
      description: Array.isArray(child)
        ? '状态数组'
        : isPlainObject(child)
          ? '状态对象'
          : '状态变量',
      detail: describeStateValue(child),
      hasChildren: hasChildren(child),
    });
  }
  return candidates;
}

function reqCandidates(context: TemplateCompletionContext): Candidate[] {
  const codec = context.codec;
  if (!codec) return [];

  if (codec.type === 'raw') {
    return [
      {
        id: 'req:hex',
        kind: 'field',
        name: 'hex',
        fullPath: 'req.hex',
        description: '整帧十六进制内容',
        detail: '文本',
        hasChildren: false,
      },
      {
        id: 'req:ascii',
        kind: 'field',
        name: 'ascii',
        fullPath: 'req.ascii',
        description: '可打印 ASCII 视图',
        detail: '文本',
        hasChildren: false,
      },
      {
        id: 'req:length',
        kind: 'field',
        name: 'length',
        fullPath: 'req.length',
        description: '帧字节长度',
        detail: '数值',
        hasChildren: false,
      },
    ];
  }

  if (codec.type === 'text') {
    const candidates: Candidate[] = [
      {
        id: 'req:_message',
        kind: 'field',
        name: '_message',
        fullPath: 'req._message',
        description: '命中的报文名，用于入站规则 match',
        detail: '文本',
        hasChildren: false,
      },
    ];

    for (const field of allTopLevelFields(codec)) {
      if (!isValidKey(field.name)) continue;
      candidates.push({
        id: `req:${field.name}`,
        kind: 'field',
        name: field.name,
        fullPath: `req.${field.name}`,
        description: field.description ?? '解码字段',
        detail: field.type ?? '字段',
        hasChildren: false,
      });
    }

    for (const message of codec.messages) {
      for (const slot of message.slots) {
        if (slot.kind !== 'repeat' || !slot.mapField) continue;
        if (!isValidKey(slot.mapField)) continue;
        const dictionary = dictionaryOf(codec, slot);
        candidates.push({
          id: `req:${slot.mapField}`,
          kind: 'field',
          name: slot.mapField,
          fullPath: `req.${slot.mapField}`,
          description: `按 ${slot.keyField ?? '键'} 索引的重复组；模板不支持数组下标`,
          detail: dictionary
            ? Object.keys(dictionary).slice(0, 4).join(' / ')
            : '对象',
          hasChildren: true,
        });
      }
    }

    return candidates;
  }

  const candidates: Candidate[] = [];
  for (const field of codec.fields) {
    if (!isValidKey(field.name)) continue;
    const summary = fieldSummary(field);
    candidates.push(reqFieldCandidate(field, summary));
  }

  if (codec.checksum) {
    candidates.push(
      {
        id: 'req:_checksum',
        kind: 'field',
        name: '_checksum',
        fullPath: 'req._checksum',
        description: '校验字段的解码值',
        detail: '数值',
        hasChildren: false,
      },
      {
        id: 'req:_checksumValid',
        kind: 'field',
        name: '_checksumValid',
        fullPath: 'req._checksumValid',
        description: '校验是否通过',
        detail: '布尔',
        hasChildren: false,
      },
    );
  }
  return candidates;
}

function reqFieldCandidate(field: FieldDef, summary: string): Candidate {
  return {
    id: `req:${field.name}`,
    kind: 'field',
    name: field.name,
    fullPath: `req.${field.name}`,
    description: field.description ?? '解码字段',
    detail: `${field.type}${summary ? ` · ${summary}` : ''}`,
    hasChildren: false,
  };
}

function textMapCandidates(
  context: TemplateCompletionContext,
  mapField: string,
): Candidate[] {
  const codec = context.codec;
  if (codec?.type !== 'text') return [];
  const found = findRepeatByMapField(codec, mapField);
  if (!found) return [];
  const dictionary = dictionaryOf(codec, found.repeat);
  if (!dictionary) return [];

  return Object.keys(dictionary)
    .sort((left, right) => left.localeCompare(right))
    .map((code) => {
      const entry = dictionary[code];
      const key = mapKeyForCode(found.repeat, code);
      return {
        id: `req:${mapField}:${key}`,
        kind: 'field' as const,
        name: key,
        fullPath: `req.${mapField}.${key}`,
        description: entry?.name ?? `数据码 ${code}`,
        detail: entry?.unit ?? (entry?.valueFormat ? '波形' : entry?.multi ? '多值' : '数值'),
        hasChildren: true,
      };
    });
}

function dictionaryCodeForMapKey(
  repeat: { mapKeyPrefix?: string },
  key: string,
): string {
  const prefix = repeat.mapKeyPrefix ?? '';
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function textMapEntryCandidates(
  context: TemplateCompletionContext,
  mapField: string,
  mapKey: string,
): Candidate[] {
  const codec = context.codec;
  if (codec?.type !== 'text') return [];
  const found = findRepeatByMapField(codec, mapField);
  if (!found) return [];
  const code = dictionaryCodeForMapKey(found.repeat, mapKey);
  const entry = dictionaryEntry(codec, found.repeat, code);
  const base = `req.${mapField}.${mapKey}`;
  const waveform: Candidate[] = entry?.valueFormat
    ? [
        {
          id: `req:${mapField}:${mapKey}:waveform`,
          kind: 'field',
          name: 'waveform',
          fullPath: `${base}.waveform`,
          description: '波形摘要（不含全部点数据）',
          detail: `${entry.valueFormat.points} 点`,
          hasChildren: true,
        },
      ]
    : [];

  return [
    ...waveform,
    {
      id: `req:${mapField}:${mapKey}:value`,
      kind: 'field',
      name: 'value',
      fullPath: `${base}.value`,
      description: '首个数值',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:values`,
      kind: 'field',
      name: 'values',
      fullPath: `${base}.values`,
      description: '全部数值（数组，不能下标访问）',
      detail: '数组',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:id`,
      kind: 'field',
      name: 'id',
      fullPath: `${base}.id`,
      description: '数据标识码',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:name`,
      kind: 'field',
      name: 'name',
      fullPath: `${base}.name`,
      description: '数据名称',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:unit`,
      kind: 'field',
      name: 'unit',
      fullPath: `${base}.unit`,
      description: '数据单位',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:multi`,
      kind: 'field',
      name: 'multi',
      fullPath: `${base}.multi`,
      description: '是否多值数据码',
      detail: '布尔',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:raw`,
      kind: 'field',
      name: 'raw',
      fullPath: `${base}.raw`,
      description: '原始 group token',
      detail: '文本',
      hasChildren: false,
    },
  ];
}

function textWaveformCandidates(
  mapField: string,
  mapKey: string,
): Candidate[] {
  const base = `req.${mapField}.${mapKey}.waveform`;
  return [
    {
      id: `req:${mapField}:${mapKey}:waveform:pointCount`,
      kind: 'field',
      name: 'pointCount',
      fullPath: `${base}.pointCount`,
      description: '波形点数',
      detail: '数值',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:waveform:byteLength`,
      kind: 'field',
      name: 'byteLength',
      fullPath: `${base}.byteLength`,
      description: '波形字节数',
      detail: '数值',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:waveform:encoding`,
      kind: 'field',
      name: 'encoding',
      fullPath: `${base}.encoding`,
      description: '波形数据格式',
      detail: 'hex / base64',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:waveform:crcValid`,
      kind: 'field',
      name: 'crcValid',
      fullPath: `${base}.crcValid`,
      description: '波形 CRC 是否通过',
      detail: '布尔',
      hasChildren: false,
    },
    {
      id: `req:${mapField}:${mapKey}:waveform:crc`,
      kind: 'field',
      name: 'crc',
      fullPath: `${base}.crc`,
      description: '收到的 CRC 字节（hex）',
      detail: '文本',
      hasChildren: false,
    },
  ];
}

function counterCandidates(context: TemplateCompletionContext): Candidate[] {
  const counters = context.counters ?? ['tx', 'rx'];
  return counters.map((name) => ({
    id: `counter:${name}`,
    kind: 'counter' as const,
    name,
    fullPath: `counter.${name}`,
    description:
      name === 'tx' ? '已发送帧计数（发送后递增）' : '已接收帧计数',
    detail: '数值',
    hasChildren: false,
  }));
}

function connCandidates(): Candidate[] {
  return [
    {
      id: 'conn:id',
      kind: 'connection',
      name: 'id',
      fullPath: 'conn.id',
      description: '连接 ID',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: 'conn:remoteAddress',
      kind: 'connection',
      name: 'remoteAddress',
      fullPath: 'conn.remoteAddress',
      description: '对端地址',
      detail: '文本',
      hasChildren: false,
    },
    {
      id: 'conn:remotePort',
      kind: 'connection',
      name: 'remotePort',
      fullPath: 'conn.remotePort',
      description: '对端端口',
      detail: '数值',
      hasChildren: false,
    },
    {
      id: 'conn:connectedAt',
      kind: 'connection',
      name: 'connectedAt',
      fullPath: 'conn.connectedAt',
      description: '连接时间戳（毫秒）',
      detail: '数值',
      hasChildren: false,
    },
    {
      id: 'conn:rxBytes',
      kind: 'connection',
      name: 'rxBytes',
      fullPath: 'conn.rxBytes',
      description: '已接收字节数',
      detail: '数值',
      hasChildren: false,
    },
    {
      id: 'conn:txBytes',
      kind: 'connection',
      name: 'txBytes',
      fullPath: 'conn.txBytes',
      description: '已发送字节数',
      detail: '数值',
      hasChildren: false,
    },
  ];
}

const DEVICE_FIELD_DESCRIPTIONS: {
  key: keyof DeviceInfo;
  description: string;
}[] = [
  { key: 'manufacturer', description: '厂商' },
  { key: 'model', description: '型号' },
  { key: 'serialNumber', description: '序列号' },
  { key: 'hardwareVersion', description: '硬件版本' },
  { key: 'firmwareVersion', description: '固件版本' },
  { key: 'tnsImei', description: 'TNS/IMEI 设备编码' },
];

function deviceCandidates(context: TemplateCompletionContext): Candidate[] {
  const info = context.deviceInfo;
  if (!info) return [];
  return DEVICE_FIELD_DESCRIPTIONS.flatMap(({ key, description }) => {
    const value = info[key];
    if (value === undefined || value === '') return [];
    return [
      {
        id: `device:${key}`,
        kind: 'device' as const,
        name: key,
        fullPath: `device.${key}`,
        description,
        detail: clip(value),
        hasChildren: false,
      },
    ];
  });
}

function rootHasChildren(
  root: TemplateRoot,
  context: TemplateCompletionContext,
): boolean {
  switch (root) {
    case 'req':
      return reqCandidates(context).length > 0;
    case 'state':
      return hasStateChildren(
        context.state,
        0,
        context.maxStateDepth ?? DEFAULT_MAX_STATE_DEPTH,
      );
    case 'counter':
      return (context.counters ?? ['tx', 'rx']).length > 0;
    case 'conn':
      return true;
    case 'device':
      return deviceCandidates(context).length > 0;
    case 'now':
      return false;
  }
}

const ROOT_DESCRIPTIONS: Record<
  TemplateRoot,
  { description: string; detail?: string }
> = {
  req: { description: '触发帧的解码字段', detail: '仅收到帧时可用' },
  state: { description: '设备状态变量', detail: '所有连接共享' },
  counter: { description: '收发帧计数', detail: 'tx / rx' },
  conn: { description: '当前连接信息', detail: '发送目标连接' },
  device: { description: '设备信息', detail: '型号、序列号、TNS/IMEI 等' },
  now: { description: '当前时间戳（毫秒）' },
};

function rootCandidates(context: TemplateCompletionContext): Candidate[] {
  return ROOT_ORDER.filter((root) => context.roots.includes(root)).map((root) => ({
    id: `root:${root}`,
    kind: 'root' as const,
    name: root,
    fullPath: root,
    description: ROOT_DESCRIPTIONS[root].description,
    detail: ROOT_DESCRIPTIONS[root].detail,
    hasChildren: rootHasChildren(root, context),
  }));
}

function functionCandidates(): Candidate[] {
  return TEMPLATE_FUNCTIONS.map((fn) => ({
    id: `function:${fn.name}`,
    kind: 'function' as const,
    name: fn.name,
    fullPath: '',
    signature: fn.signature,
    description: FUNCTION_DESCRIPTIONS[fn.name] ?? '模板函数',
    detail: '函数',
    hasChildren: false,
  }));
}

function memberCandidates(
  token: TemplateCompletionToken,
  context: TemplateCompletionContext,
): Candidate[] {
  if (token.parentSegments.length === 0) return [];
  const root = token.parentSegments[0] as TemplateRoot;
  if (!context.roots.includes(root)) return [];

  if (root === 'req') {
    if (token.parentSegments.length === 1) return reqCandidates(context);
    if (context.codec?.type === 'text') {
      const mapField = token.parentSegments[1]!;
      if (token.parentSegments.length === 2) {
        return textMapCandidates(context, mapField);
      }
      if (token.parentSegments.length === 3) {
        return textMapEntryCandidates(context, mapField, token.parentSegments[2]!);
      }
      if (
        token.parentSegments.length === 4 &&
        token.parentSegments[3] === 'waveform'
      ) {
        return textWaveformCandidates(mapField, token.parentSegments[2]!);
      }
    }
    return [];
  }
  if (root === 'counter') {
    return token.parentSegments.length === 1 ? counterCandidates(context) : [];
  }
  if (root === 'conn') {
    return token.parentSegments.length === 1 ? connCandidates() : [];
  }
  if (root === 'device') {
    return token.parentSegments.length === 1 ? deviceCandidates(context) : [];
  }
  if (root === 'now') return [];

  const maxDepth = context.maxStateDepth ?? DEFAULT_MAX_STATE_DEPTH;
  const node = stateNodeAt(context.state, token.parentSegments);
  return stateChildren(
    node,
    token.parentSegments,
    token.parentSegments.length - 1,
    maxDepth,
    context.maxItems ?? DEFAULT_MAX_ITEMS,
  );
}

function toSuggestion(
  candidate: Candidate,
  token: TemplateCompletionToken,
): TemplateSuggestion {
  const expression = token.mode === 'expression';
  const wrap = token.mode === 'bare' && token.wrap;
  let replaceStart: number;
  let replaceEnd: number;
  let insertText: string;
  let caretOffset: number;
  let reopen = candidate.hasChildren;

  if (candidate.kind === 'function') {
    replaceStart = token.wordStart;
    replaceEnd = token.wordEnd;
    insertText = expression
      ? `${candidate.name}()`
      : `\${${candidate.name}()}`;
    caretOffset = (expression ? 0 : 2) + candidate.name.length + 1;
    reopen = false;
  } else if (candidate.kind === 'root') {
    replaceStart = token.wordStart;
    replaceEnd = token.wordEnd;
    if (expression) {
      insertText = `${candidate.fullPath}${candidate.hasChildren ? '.' : ''}`;
    } else if (wrap) {
      insertText = `\${${candidate.fullPath}${candidate.hasChildren ? '.' : ''}}`;
    } else {
      insertText = `$${candidate.fullPath}${candidate.hasChildren ? '.' : ''}`;
    }
    caretOffset =
      candidate.hasChildren && wrap ? insertText.length - 1 : insertText.length;
  } else {
    replaceStart = wrap ? token.wordStart : token.segmentStart;
    replaceEnd = wrap ? token.wordEnd : token.segmentEnd;
    if (expression) {
      insertText = `${candidate.name}${candidate.hasChildren ? '.' : ''}`;
    } else if (wrap) {
      insertText = `\${${candidate.fullPath}${candidate.hasChildren ? '.' : ''}}`;
    } else {
      insertText = `${candidate.name}${candidate.hasChildren ? '.' : ''}`;
    }
    caretOffset =
      candidate.hasChildren && wrap ? insertText.length - 1 : insertText.length;
  }

  const label =
    candidate.kind === 'function'
      ? (candidate.signature ?? candidate.name)
      : expression
        ? candidate.fullPath
        : `$${candidate.fullPath}`;

  return {
    id: candidate.id,
    kind: candidate.kind,
    label,
    detail: candidate.detail,
    description: candidate.description,
    matchText: candidate.name,
    insertText,
    replaceStart,
    replaceEnd,
    caretOffset,
    reopen,
    closeExpression: expression && token.needsClosing,
  };
}

function buildCandidates(
  token: TemplateCompletionToken,
  context: TemplateCompletionContext,
): Candidate[] {
  const candidates =
    token.parentSegments.length === 0
      ? [...rootCandidates(context), ...functionCandidates()]
      : memberCandidates(token, context);
  return candidates.slice(0, context.maxItems ?? DEFAULT_MAX_ITEMS);
}

export function buildTemplateSuggestions(
  token: TemplateCompletionToken,
  context: TemplateCompletionContext,
): TemplateSuggestion[] {
  return buildCandidates(token, context).map((candidate) =>
    toSuggestion(candidate, token),
  );
}

export function filterTemplateSuggestions(
  suggestions: TemplateSuggestion[],
  segment: string,
): TemplateSuggestion[] {
  const needle = segment.toLowerCase();
  const ranked: { suggestion: TemplateSuggestion; rank: number; index: number }[] = [];

  suggestions.forEach((suggestion, index) => {
    const text = suggestion.matchText.toLowerCase();
    let rank = -1;
    if (!needle) rank = 0;
    else if (text === needle) rank = 0;
    else if (text.startsWith(needle)) rank = 1;
    else if (text.includes(needle)) rank = 2;
    if (rank >= 0) ranked.push({ suggestion, rank, index });
  });

  ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);
  return ranked.slice(0, MAX_RENDERED).map((entry) => entry.suggestion);
}

export function applyTemplateSuggestion(
  value: string,
  suggestion: TemplateSuggestion,
): { value: string; caret: number; reopen: boolean } {
  let next =
    value.slice(0, suggestion.replaceStart) +
    suggestion.insertText +
    value.slice(suggestion.replaceEnd);
  let caret = suggestion.replaceStart + suggestion.caretOffset;

  if (suggestion.closeExpression) {
    const suffix = next.slice(suggestion.replaceStart + suggestion.insertText.length);
    if (/^\s*$/.test(suffix)) {
      next += '}';
      if (!suggestion.reopen && suggestion.kind !== 'function') {
        caret = next.length;
      }
    }
  }

  return { value: next, caret, reopen: suggestion.reopen };
}

// 引号和转义扫描必须与 core 的 scanTemplateParts 保持一致；字符串字面量
// 内部同样不提供补全。
function findExpressionEnd(value: string, start: number): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start + 2; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '}') {
      return index;
    }
  }
  return -1;
}

function findActiveExpression(
  value: string,
  caret: number,
): { innerStart: number; close: number | null } | null {
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('${', cursor);
    if (start === -1 || start >= caret) return null;
    const innerStart = start + 2;
    const close = findExpressionEnd(value, start);
    if (close === -1) {
      return caret >= innerStart ? { innerStart, close: null } : null;
    }
    if (caret >= innerStart && caret <= close) {
      return { innerStart, close };
    }
    cursor = close + 1;
  }
  return null;
}

function insideStringLiteral(
  value: string,
  start: number,
  caret: number,
): boolean {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < caret; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return quote !== null;
}

function splitWord(
  word: string,
): { parentSegments: string[]; segment: string; lastDot: number } | null {
  const dollarOffset = word.startsWith('$') ? 1 : 0;
  const path = word.slice(dollarOffset);
  if (path.startsWith('.') || path.includes('..')) return null;
  const lastDot = path.lastIndexOf('.');
  const parentSegments =
    lastDot >= 0 ? path.slice(0, lastDot).split('.').filter(Boolean) : [];
  const segment = lastDot >= 0 ? path.slice(lastDot + 1) : path;
  return { parentSegments, segment, lastDot };
}

function isNumericWord(word: string): boolean {
  return /^(?:\d|\.\d)/.test(word) || /^[0-9.]+$/.test(word);
}

/**
 * 找到光标所在的路径 token。裸 `$` token 在插入时会包成 `${...}`；
 * `${...}` 内的 token 保持在原表达式里。`needsClosing` 表示接受建议时
 * 需要补上缺失的 `}`。
 */
export function findTemplateCompletionToken(
  value: string,
  caret: number,
): TemplateCompletionToken | null {
  if (caret < 0 || caret > value.length) return null;

  const active = findActiveExpression(value, caret);
  if (active) {
    if (insideStringLiteral(value, active.innerStart, caret)) return null;
    const limit = active.close ?? value.length;
    let wordStart = caret;
    while (wordStart > active.innerStart && PATH_CHAR.test(value[wordStart - 1]!)) {
      wordStart -= 1;
    }
    let wordEnd = caret;
    while (wordEnd < limit && PATH_CHAR.test(value[wordEnd]!)) {
      wordEnd += 1;
    }

    const word = value.slice(wordStart, wordEnd);
    if (word.includes('$') && !word.startsWith('$')) return null;
    if (isNumericWord(word.replace(/^\$/, ''))) return null;
    if (word.replace(/^\$/, '') === 'true') return null;
    if (word.replace(/^\$/, '') === 'false') return null;
    if (word.replace(/^\$/, '') === 'null') return null;
    if (word && wordEnd < limit && value[wordEnd] === '(') return null;

    const split = splitWord(word);
    if (!split) return null;
    const dollar = word.startsWith('$');
    const segmentStart =
      wordStart + (dollar ? 1 : 0) + (split.lastDot >= 0 ? split.lastDot + 1 : 0);

    return {
      mode: 'expression',
      wrap: false,
      wordStart,
      wordEnd,
      segmentStart,
      segmentEnd: wordEnd,
      parentSegments: split.parentSegments,
      segment: split.segment,
      dollar,
      complete: false,
      needsClosing:
        active.close === null && /^\s*$/.test(value.slice(wordEnd)),
    };
  }

  let start = caret;
  while (start > 0 && PATH_CHAR.test(value[start - 1]!) && value[start - 1] !== '$') {
    start -= 1;
  }
  if (start === 0 || value[start - 1] !== '$') return null;
  const wordStart = start - 1;
  if (value[wordStart + 1] === '{') return null;

  let wordEnd = caret;
  while (wordEnd < value.length && PATH_CHAR.test(value[wordEnd]!) && value[wordEnd] !== '$') {
    wordEnd += 1;
  }
  if (wordEnd < value.length && value[wordEnd] === '{') return null;

  const word = value.slice(wordStart + 1, wordEnd);
  if (word.includes('$')) return null;
  if (isNumericWord(word)) return null;
  if (word && wordEnd < value.length && value[wordEnd] === '(') return null;

  const split = splitWord(word);
  if (!split) return null;
  const segmentStart = wordStart + 1 + (split.lastDot >= 0 ? split.lastDot + 1 : 0);

  return {
    mode: 'bare',
    wrap: wordStart !== 0 || wordEnd !== value.length,
    wordStart,
    wordEnd,
    segmentStart,
    segmentEnd: wordEnd,
    parentSegments: split.parentSegments,
    segment: split.segment,
    dollar: true,
    complete:
      caret === wordEnd &&
      PATH_SEGMENT_PATTERN.test(word.split('.').pop() ?? '') &&
      !word.endsWith('.'),
    needsClosing: false,
  };
}
