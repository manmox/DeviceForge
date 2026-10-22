import type { CodecConfig } from '@deviceforge/core';
import { TextCodecSchema } from '@deviceforge/core/schema';
import { describe, expect, it } from 'vitest';
import {
  applyTemplateSuggestion,
  buildTemplateSuggestions,
  filterTemplateSuggestions,
  findTemplateCompletionToken,
  templateRootsFor,
  type TemplateCompletionContext,
} from '../template-suggestions';

const fieldsCodec: CodecConfig = {
  type: 'fields',
  fields: [
    { name: 'cmd', type: 'u8' },
    { name: 'seq', type: 'u16', endian: 'le' },
    { name: 'temp', type: 'i16', scale: 0.1, unit: '℃' },
  ],
  checksum: { algo: 'crc16-modbus', verify: true },
};

const rawCodec: CodecConfig = { type: 'raw', display: 'hex' };
const textCodec: CodecConfig = TextCodecSchema.parse({
  type: 'text',
  messages: [
    {
      name: 'report',
      slots: [
        { kind: 'field', name: 'deviceCode', type: 'string' },
        { kind: 'field', name: 'dataCount', type: 'int' },
        {
          kind: 'repeat',
          name: 'groups',
          countField: 'dataCount',
          itemSeparator: '*',
          keyField: 'id',
          mapField: 'data',
          mapKeyPrefix: 'c',
          dictionary: 'codes',
          fields: [
            { kind: 'field', name: 'id', type: 'string' },
            { kind: 'field', name: 'values', type: 'stringList' },
          ],
        },
        {
          kind: 'field',
          name: 'timestamp',
          type: 'timestamp',
          format: 'YYYY-MM-DD HH-mm-ss',
          auto: 'timestamp',
        },
        { kind: 'field', name: 'sequence', type: 'int', optional: true, auto: 'sequence' },
      ],
    },
  ],
  dictionaries: {
    codes: {
      '000': { name: '示例数值', unit: 'V' },
      '089': { name: '示例状态', unit: 'mm', multi: true },
      '220': {
        name: '示例数组',
        unit: 'Hz',
        valueFormat: {
          type: 'int16Array',
          points: 1024,
          endian: 'be',
          encoding: 'hex',
          crc: { algo: 'crc16-modbus', endian: 'le' },
        },
      },
    },
  },
});

const context: TemplateCompletionContext = {
  roots: ['req', 'state', 'counter', 'conn', 'device', 'now'],
  codec: fieldsCodec,
  state: {
    temp: 25.5,
    nested: { online: true },
    list: [1, 2],
    'bad-key': 1,
  },
  deviceInfo: {
    model: 'TH-100',
    tnsImei: '000000000000000',
  },
};

function tokenAt(value: string, caret = value.length) {
  const token = findTemplateCompletionToken(value, caret);
  expect(token).not.toBeNull();
  return token!;
}

function labels(value: string, ctx = context, caret = value.length) {
  const token = tokenAt(value, caret);
  return buildTemplateSuggestions(token, ctx).map((item) => item.label);
}

describe('templateRootsFor', () => {
  it('respects trigger availability for set/send/manual-send', () => {
    expect(templateRootsFor('rule-set', 'start')).toEqual([
      'state',
      'counter',
      'device',
      'now',
    ]);
    expect(templateRootsFor('rule-set', 'connect')).toEqual([
      'state',
      'counter',
      'conn',
      'device',
      'now',
    ]);
    expect(templateRootsFor('rule-set', 'frame')).toEqual([
      'req',
      'state',
      'counter',
      'conn',
      'device',
      'now',
    ]);
    expect(templateRootsFor('rule-set', 'interval')).toEqual([
      'state',
      'counter',
      'device',
      'now',
    ]);
    for (const trigger of ['start', 'connect', 'frame', 'interval'] as const) {
      expect(templateRootsFor('rule-send', trigger)).toContain('conn');
    }
    expect(templateRootsFor('rule-send', 'frame')).toContain('req');
    expect(templateRootsFor('rule-send', 'start')).not.toContain('req');
    expect(templateRootsFor('manual-send')).toEqual([
      'state',
      'counter',
      'conn',
      'device',
      'now',
    ]);
  });
});

describe('findTemplateCompletionToken', () => {
  it('finds bare tokens and records the current segment', () => {
    expect(tokenAt('$', 1)).toMatchObject({
      mode: 'bare',
      wrap: false,
      wordStart: 0,
      wordEnd: 1,
      segment: '',
      parentSegments: [],
    });
    expect(tokenAt('$state.', 7)).toMatchObject({
      mode: 'bare',
      wrap: false,
      parentSegments: ['state'],
      segment: '',
      segmentStart: 7,
      segmentEnd: 7,
    });
    expect(tokenAt('$state.te', 9)).toMatchObject({
      parentSegments: ['state'],
      segment: 'te',
      segmentStart: 7,
      segmentEnd: 9,
    });
  });

  it('marks embedded bare tokens for wrapping', () => {
    expect(tokenAt('seq=$', 5)).toMatchObject({
      mode: 'bare',
      wrap: true,
      wordStart: 4,
      wordEnd: 5,
      segment: '',
    });
    expect(tokenAt('seq=$state.te', 13)).toMatchObject({
      mode: 'bare',
      wrap: true,
      wordStart: 4,
      wordEnd: 13,
      parentSegments: ['state'],
      segment: 'te',
    });
  });

  it('finds expression tokens and supports mid-expression carets', () => {
    expect(tokenAt('${', 2)).toMatchObject({
      mode: 'expression',
      segment: '',
      wordStart: 2,
      wordEnd: 2,
      needsClosing: true,
    });
    expect(tokenAt('${state.', 8)).toMatchObject({
      mode: 'expression',
      parentSegments: ['state'],
      segment: '',
      segmentStart: 8,
      segmentEnd: 8,
    });
    expect(tokenAt('${random(1, $state.te)}', 19)).toMatchObject({
      mode: 'expression',
      parentSegments: ['state'],
      segment: 'te',
    });
    expect(tokenAt('${and("a}b", $state.te)}', 21)).toMatchObject({
      mode: 'expression',
      parentSegments: ['state'],
      segment: 'te',
    });
  });

  it('ignores strings, completed expressions, numeric literals and calls', () => {
    expect(findTemplateCompletionToken('${state.x}', 10)).toBeNull();
    expect(findTemplateCompletionToken('${"a|b"}', 5)).toBeNull();
    expect(findTemplateCompletionToken('$5', 2)).toBeNull();
    expect(findTemplateCompletionToken('${true}', 7)).toBeNull();
    expect(findTemplateCompletionToken('${random(1, 2)}', 8)).toBeNull();
  });
});

describe('template suggestion catalog', () => {
  it('lists roots and functions at the top level', () => {
    expect(labels('$')).toEqual(
      expect.arrayContaining([
        '$req',
        '$state',
        '$counter',
        '$conn',
        '$device',
        '$now',
        'random(min, max)',
        'and(a, b, ...)',
      ]),
    );
  });

  it('lists codec fields and checksum metadata for req', () => {
    expect(labels('$req.')).toEqual(
      expect.arrayContaining(['$req.cmd', '$req.seq', '$req.temp', '$req._checksum', '$req._checksumValid']),
    );
    expect(labels('${req.}', context, 6)).toEqual(
      expect.arrayContaining(['req.cmd', 'req.seq', 'req.temp', 'req._checksum']),
    );
  });

  it('lists raw codec fields', () => {
    expect(labels('$req.', { ...context, codec: rawCodec })).toEqual([
      '$req.hex',
      '$req.ascii',
      '$req.length',
    ]);
  });

  it('lists structured text request fields and the matched message name', () => {
    const textContext: TemplateCompletionContext = {
      ...context,
      codec: textCodec,
    };
    const textLabels = labels('$req.', textContext);
    expect(textLabels).toEqual(
      expect.arrayContaining([
        '$req._message',
        '$req.deviceCode',
        '$req.dataCount',
        '$req.timestamp',
        '$req.sequence',
        '$req.groups',
        '$req.data',
      ]),
    );
    expect(textLabels).not.toContain('$req._checksum');
  });

  it('expands text dictionary map fields without array indexing', () => {
    const textContext: TemplateCompletionContext = {
      ...context,
      codec: textCodec,
    };
    expect(labels('$req.data.', textContext)).toEqual(
      expect.arrayContaining([
        '$req.data.item101',
        '$req.data.item105',
        '$req.data.item202',
      ]),
    );
    expect(labels('$req.data.item105.', textContext)).toEqual(
      expect.arrayContaining([
        '$req.data.item105.value',
        '$req.data.item105.values',
        '$req.data.item105.name',
        '$req.data.item105.unit',
        '$req.data.item105.multi',
        '$req.data.item105.raw',
      ]),
    );
    expect(labels('$req.data.item105.', textContext)).not.toContain(
      '$req.data.item105.waveform',
    );
    expect(labels('$req.data.item202.', textContext)).toContain(
      '$req.data.item202.waveform',
    );
    expect(labels('$req.data.item202.waveform.', textContext)).toEqual(
      expect.arrayContaining([
        '$req.data.item202.waveform.pointCount',
        '$req.data.item202.waveform.crcValid',
        '$req.data.item202.waveform.encoding',
      ]),
    );
    // fields codec 也可能有名为 data 的字段，不应对其展开协议数据码。
    expect(labels('$req.data.', context)).toEqual([]);
  });

  it('lists configured device fields under $device', () => {
    expect(labels('$device.')).toEqual([
      '$device.model',
      '$device.tnsImei',
    ]);
    expect(labels('$device.', { ...context, deviceInfo: {} })).toEqual([]);
  });

  it('expands state objects and arrays', () => {
    expect(labels('$state.')).toEqual(
      expect.arrayContaining(['$state.temp', '$state.nested', '$state.list']),
    );
    expect(labels('$state.')).not.toContain('$state.bad-key');
    expect(labels('$state.nested.')).toEqual(['$state.nested.online']);
    expect(labels('$state.list.')).toEqual(['$state.list.length']);
  });

  it('lists counters and connection fields', () => {
    expect(labels('$counter.')).toEqual(['$counter.tx', '$counter.rx']);
    expect(labels('$conn.')).toEqual(
      expect.arrayContaining([
        '$conn.id',
        '$conn.remoteAddress',
        '$conn.remotePort',
        '$conn.connectedAt',
        '$conn.rxBytes',
        '$conn.txBytes',
      ]),
    );
  });

  it('does not offer unavailable roots or functions after a dot', () => {
    const withoutReq: TemplateCompletionContext = {
      ...context,
      roots: ['state', 'counter', 'now'],
    };
    expect(labels('$req.', withoutReq)).toEqual([]);
    expect(labels('$state.')).not.toContain('random(min, max)');
    expect(labels('${state.}', context, 8)).not.toContain('random(min, max)');
  });
});

describe('filtering and insertion', () => {
  it('ranks exact, prefix and substring matches', () => {
    const token = tokenAt('$state.');
    const suggestions = buildTemplateSuggestions(token, context);
    const filtered = filterTemplateSuggestions(suggestions, 'te');
    expect(filtered[0]?.label).toBe('$state.temp');
    expect(filtered.map((item) => item.label)).toContain('$state.nested');

    const exact = filterTemplateSuggestions(
      buildTemplateSuggestions(tokenAt('$sta'), context),
      'state',
    );
    expect(exact[0]?.label).toBe('$state');
  });

  it('inserts a root and keeps the popup open for members', () => {
    const token = tokenAt('$sta');
    const suggestion = filterTemplateSuggestions(
      buildTemplateSuggestions(token, context),
      token.segment,
    ).find((item) => item.label === '$state')!;
    expect(applyTemplateSuggestion('$sta', suggestion)).toEqual({
      value: '$state.',
      caret: 7,
      reopen: true,
    });
  });

  it('wraps embedded bare tokens', () => {
    const token = tokenAt('seq=$state.te');
    const suggestions = filterTemplateSuggestions(
      buildTemplateSuggestions(token, context),
      token.segment,
    );
    const suggestion = suggestions.find((item) => item.label === '$state.temp')!;
    expect(applyTemplateSuggestion('seq=$state.te', suggestion)).toEqual({
      value: 'seq=${state.temp}',
      caret: 17,
      reopen: false,
    });
  });

  it('wraps embedded roots and functions and keeps member drill-down open', () => {
    const rootToken = tokenAt('seq=$');
    const rootSuggestions = buildTemplateSuggestions(rootToken, context);
    const stateRoot = rootSuggestions.find((item) => item.label === '$state')!;
    expect(applyTemplateSuggestion('seq=$', stateRoot)).toEqual({
      value: 'seq=${state.}',
      caret: 12,
      reopen: true,
    });

    const functionToken = tokenAt('seq=$ran');
    const fn = filterTemplateSuggestions(
      buildTemplateSuggestions(functionToken, context),
      functionToken.segment,
    ).find((item) => item.matchText === 'random')!;
    const applied = applyTemplateSuggestion('seq=$ran', fn);
    expect(applied.value).toBe('seq=${random()}');
    expect(applied.caret).toBe(13);
    expect(applied.reopen).toBe(false);
  });

  it('replaces mid-word tokens and inserts function parentheses', () => {
    const memberToken = tokenAt('$state.te');
    const member = filterTemplateSuggestions(
      buildTemplateSuggestions(memberToken, context),
      memberToken.segment,
    )[0]!;
    expect(applyTemplateSuggestion('$state.te', member)).toMatchObject({
      value: '$state.temp',
      reopen: false,
    });

    const functionToken = tokenAt('${ran');
    const fn = filterTemplateSuggestions(
      buildTemplateSuggestions(functionToken, context),
      functionToken.segment,
    ).find((item) => item.matchText === 'random')!;
    const applied = applyTemplateSuggestion('${ran', fn);
    expect(applied.value).toBe('${random()}');
    expect(applied.caret).toBe(9);
    expect(applied.reopen).toBe(false);
  });

  it('closes an unclosed interpolation after accepting a suggestion', () => {
    const token = tokenAt('${state.te');
    const suggestion = filterTemplateSuggestions(
      buildTemplateSuggestions(token, context),
      token.segment,
    )[0]!;
    expect(applyTemplateSuggestion('${state.te', suggestion)).toEqual({
      value: '${state.temp}',
      caret: 13,
      reopen: false,
    });

    const rootToken = tokenAt('${');
    const rootSuggestion = buildTemplateSuggestions(rootToken, context).find(
      (item) => item.matchText === 'req',
    )!;
    expect(applyTemplateSuggestion('${', rootSuggestion)).toEqual({
      value: '${req.}',
      caret: 6,
      reopen: true,
    });
  });
});
