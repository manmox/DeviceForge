import { describe, expect, it } from 'vitest';
import {
  createCodec,
  createDictionaryProvider,
  TextCodecSchema,
  type DictionaryEntries,
  type DictionaryProvider,
  type EncodeContext,
  type TextCodecConfig,
} from '../index';

const DEVICE_CODE = '000000000000000';
const NOW = Date.UTC(2026, 9, 22, 10, 11, 12);

const sampleDictionaryEntries: DictionaryEntries = {
  '101': { name: '示例数值', unit: 'V' },
  '202': {
    name: '示例数组',
    unit: 'Hz',
    valueFormat: {
      type: 'int16Array',
      points: 4,
      endian: 'be',
      encoding: 'hex',
      crc: { algo: 'crc16-modbus', endian: 'le' },
    },
  },
};

const sampleDictionaries = createDictionaryProvider([
  {
    id: 'sampleCodes',
    name: 'sampleCodes',
    entries: sampleDictionaryEntries,
  },
]);

function makeCodec(
  config: unknown,
  dictionaries: DictionaryProvider | null = sampleDictionaries,
) {
  return createCodec(TextCodecSchema.parse(config), {
    dictionaries: dictionaries ?? undefined,
  });
}

function makeContext(overrides: Partial<EncodeContext> = {}): EncodeContext {
  return {
    state: {},
    counters: {},
    now: NOW,
    device: { tnsImei: DEVICE_CODE },
    ...overrides,
  };
}

function textOf(buffer: Buffer): string {
  return buffer.toString('utf8');
}

const simpleConfig = {
  type: 'text',
  messages: [
    {
      name: 'reading',
      slots: [
        { kind: 'field', name: 'device', type: 'string' },
        { kind: 'field', name: 'temperature', type: 'decimal' },
        { kind: 'field', name: 'status', type: 'int' },
      ],
    },
  ],
};

const sampleTextConfig: TextCodecConfig = TextCodecSchema.parse({
  type: 'text',
  separator: ':',
  terminator: '\r\n',
  timezone: 'Asia/Shanghai',
  messages: [
    {
      name: 'report',
      label: '数据上报',
      prefix: 'NO',
      suffix: 'END',
      display: { summary: ['dataCount', 'sequence'] },
      slots: [
        {
          kind: 'field',
          name: 'deviceCode',
          type: 'string',
          defaultFrom: 'tnsImei',
          pattern: '^\\d{15}$',
          patternSeverity: 'warning',
        },
        { kind: 'field', name: 'dataCount', type: 'int', width: 2 },
        {
          kind: 'repeat',
          name: 'groups',
          countField: 'dataCount',
          itemSeparator: '*',
          valueSeparator: '|',
          keyField: 'id',
          mapField: 'data',
          mapKeyPrefix: 'c',
          dictionary: 'sampleCodes',
          fields: [
            { kind: 'field', name: 'id', type: 'string', width: 3 },
            {
              kind: 'field',
              name: 'values',
              type: 'stringList',
              valueSeparator: '|',
            },
          ],
        },
        {
          kind: 'field',
          name: 'timestamp',
          type: 'timestamp',
          format: 'YYYY-MM-DD HH-mm-ss',
          auto: 'timestamp',
        },
        {
          kind: 'field',
          name: 'sequence',
          type: 'int',
          optional: true,
          auto: 'sequence',
        },
      ],
    },
    {
      name: 'ack',
      label: '平台应答',
      prefix: '<RPT',
      suffix: 'DONE>',
      slots: [
        {
          kind: 'field',
          name: 'deviceCode',
          type: 'string',
          defaultFrom: 'tnsImei',
        },
        {
          kind: 'field',
          name: 'date',
          type: 'timestamp',
          format: 'YYYYMMDD',
          auto: 'timestamp',
        },
        {
          kind: 'field',
          name: 'time',
          type: 'timestamp',
          format: 'HHmmss',
          auto: 'timestamp',
        },
        { kind: 'field', name: 'sequence', type: 'int', optional: true },
        { kind: 'field', name: 'status', type: 'string', default: 'OK' },
      ],
    },
    {
      name: 'command',
      label: '平台控制',
      prefix: '<RPT',
      suffix: 'DONE>',
      match: [
        { index: 2, equals: 'C' },
        { index: 4, equals: 'A' },
      ],
      slots: [
        { kind: 'field', name: 'deviceCode', type: 'string', defaultFrom: 'tnsImei' },
        { kind: 'literal', value: 'C' },
        { kind: 'field', name: 'commandId', type: 'string', width: 3 },
        { kind: 'literal', value: 'A' },
        { kind: 'field', name: 'actionValue', type: 'string', width: 4 },
      ],
    },
    {
      name: 'echo',
      label: '设备回显',
      prefix: 'NO',
      suffix: 'END',
      match: [
        { index: 2, equals: 'C' },
        { index: 4, equals: 'A' },
      ],
      slots: [
        { kind: 'field', name: 'deviceCode', type: 'string', defaultFrom: 'tnsImei' },
        { kind: 'literal', value: 'C' },
        { kind: 'field', name: 'commandId', type: 'string', width: 3 },
        { kind: 'literal', value: 'A' },
        { kind: 'field', name: 'actionValue', type: 'string', width: 4 },
      ],
    },
  ],
  session: {
    ackMessage: 'ack',
    trackMessages: ['report'],
    sequenceField: 'sequence',
    statusField: 'status',
    successValues: ['OK'],
    timeoutMs: 100,
    maxRetries: 2,
  },
});

describe('text codec basics', () => {
  it('encodes and decodes simple fields', () => {
    const codec = makeCodec(simpleConfig);
    const data = codec.encode(
      {
        fields: {
          kind: 'reading',
          device: 'sensor-1',
          temperature: '25.5',
          status: 1,
        },
      },
      makeContext(),
    );
    expect(textOf(data)).toBe('sensor-1:25.5:1\r\n');

    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    expect(decoded.fields).toMatchObject({
      device: 'sensor-1',
      temperature: '25.5',
      status: 1,
      _message: 'reading',
    });
  });

  it('pads widths and validates them on decode', () => {
    const codec = makeCodec({
      type: 'text',
      messages: [
        {
          name: 'counted',
          slots: [
            { kind: 'field', name: 'count', type: 'int', width: 2 },
            { kind: 'field', name: 'id', type: 'string', width: 3 },
          ],
        },
      ],
    });
    const data = codec.encode(
      { fields: { kind: 'counted', count: 2, id: '7' } },
      makeContext(),
    );
    expect(textOf(data)).toBe('02:007\r\n');
    expect(codec.decode(data).fields).toMatchObject({ count: 2, id: '007' });
    expect(codec.decode(Buffer.from('2:007\r\n')).valid).toBe(false);
  });

  it('matches command/echo variants and reports unknown messages', () => {
    const codec = makeCodec(sampleTextConfig);
    const command = codec.decode(
      Buffer.from('<RPT:000000000000000:C:123:A:0090:DONE>\r\n'),
    );
    expect(command.valid).toBe(true);
    expect(command.fields).toMatchObject({
      _message: 'command',
      commandId: '123',
      actionValue: '0090',
    });

    const echo = codec.decode(
      Buffer.from('RPT:000000000000000:C:123:A:0090:DONE\r\n'),
    );
    expect(echo.valid).toBe(true);
    expect(echo.fields._message).toBe('echo');

    expect(codec.decode(Buffer.from('BAD:data\r\n')).valid).toBe(false);
  });
});

describe('text codec optional fields', () => {
  const config = {
    type: 'text',
    messages: [
      {
        name: 'tail',
        prefix: 'NO',
        suffix: 'END',
        slots: [
          { kind: 'field', name: 'device', type: 'string' },
          { kind: 'field', name: 'timestamp', type: 'string' },
          { kind: 'field', name: 'sequence', type: 'int', optional: true },
        ],
      },
      {
        name: 'middle',
        prefix: '<RPT',
        suffix: 'DONE>',
        slots: [
          { kind: 'field', name: 'device', type: 'string' },
          { kind: 'field', name: 'sequence', type: 'int', optional: true },
          { kind: 'field', name: 'status', type: 'string' },
        ],
      },
    ],
  };

  it('parses an optional trailing field', () => {
    const codec = makeCodec(config);
    const withSequence = codec.decode(
      Buffer.from('RPT:dev:2026-10-22:7:DONE\r\n'),
    );
    expect(withSequence.fields).toMatchObject({
      device: 'dev',
      timestamp: '2026-10-22',
      sequence: 7,
    });

    const without = codec.decode(Buffer.from('RPT:dev:2026-10-22:DONE\r\n'));
    expect(without.valid).toBe(true);
    expect(without.fields.sequence).toBeUndefined();
  });

  it('parses an optional field before a required tail', () => {
    const codec = makeCodec(config);
    const withSequence = codec.decode(Buffer.from('<RPT:dev:7:OK:DONE>\r\n'));
    expect(withSequence.fields).toMatchObject({
      device: 'dev',
      sequence: 7,
      status: 'OK',
    });

    const without = codec.decode(Buffer.from('<RPT:dev:OK:DONE>\r\n'));
    expect(without.valid).toBe(true);
    expect(without.fields).toMatchObject({ device: 'dev', status: 'OK' });
    expect(without.fields.sequence).toBeUndefined();
  });

  it('omits optional fields when encoding null and includes them when present', () => {
    const codec = makeCodec(config);
    expect(
      textOf(
        codec.encode(
          { fields: { kind: 'tail', device: 'dev', timestamp: 't' } },
          makeContext(),
        ),
      ),
    ).toBe('RPT:dev:t:DONE\r\n');
    expect(
      textOf(
        codec.encode(
          {
            fields: {
              kind: 'tail',
              device: 'dev',
              timestamp: 't',
              sequence: 9,
            },
          },
          makeContext(),
        ),
      ),
    ).toBe('RPT:dev:t:9:DONE\r\n');
  });
});

describe('text codec repeat and dictionaries', () => {
  it('encodes and decodes repeat groups with mapField', () => {
    const codec = makeCodec(sampleTextConfig);
    const data = codec.encode(
      {
        fields: {
          kind: 'report',
          groups: [
            { id: '101', values: ['12.7'] },
            { id: '102', values: ['25', '0'] },
          ],
        },
      },
      makeContext(),
    );
    const text = textOf(data);
    expect(text).toContain('RPT:000000000000000:02:101*12.7:102*25|0:');

    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    expect(decoded.fields.dataCount).toBe(2);
    expect(decoded.fields.groups).toHaveLength(2);
    expect(decoded.fields.data).toMatchObject({
      item101: { id: '101', value: '12.7', values: ['12.7'], name: '示例数值', unit: 'V' },
      item102: { id: '102', value: '25', values: ['25', '0'] },
    });
  });

  it('supports base64 waveform values', () => {
    const entries = structuredClone(sampleDictionaryEntries);
    entries['202']!.valueFormat!.encoding = 'base64';
    const codec = makeCodec(
      sampleTextConfig,
      createDictionaryProvider([
        { id: 'sampleCodes', name: 'sampleCodes', entries },
      ]),
    );
    const data = codec.encode(
      {
        fields: {
          kind: 'report',
          groups: [{ id: '202', waveform: [5, -6, 7, -8] }],
        },
      },
      makeContext(),
    );
    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    const group = (decoded.fields.groups as Record<string, unknown>[])[0]!;
    expect(group.waveform).toMatchObject({
      encoding: 'base64',
      points: [5, -6, 7, -8],
      crcValid: true,
    });
  });

  it('parses a dictionary valueFormat waveform and reports CRC failures', () => {
    const codec = makeCodec(sampleTextConfig);
    const data = codec.encode(
      {
        fields: {
          kind: 'report',
          groups: [{ id: '202', waveform: [1, -2, 3, -4] }],
        },
      },
      makeContext(),
    );
    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    const group = (decoded.fields.groups as Record<string, unknown>[])[0]!;
    expect(group.waveform).toMatchObject({
      pointCount: 4,
      points: [1, -2, 3, -4],
      crcValid: true,
    });
    expect(decoded.fields.data).toMatchObject({
      item202: { waveform: { pointCount: 4, crcValid: true } },
    });
    expect(
      (decoded.fields.data as Record<string, Record<string, unknown>>).item202!
        .waveform,
    ).not.toHaveProperty('points');

    const encoded = textOf(data);
    const marker = encoded.indexOf('202*') + 4;
    const replacement = encoded[marker] === '0' ? '1' : '0';
    const corrupted =
      encoded.slice(0, marker) + replacement + encoded.slice(marker + 1);
    const invalid = codec.decode(Buffer.from(corrupted));
    expect(invalid.valid).toBe(true);
    expect(invalid.warnings?.join(' ')).toContain('CRC');
    const corruptedGroup = (invalid.fields.groups as Record<string, unknown>[])[0]!;
    expect(corruptedGroup.waveform).toMatchObject({
      crcValid: false,
      points: null,
    });
  });

  it('warns and preserves raw values when the global dictionary is missing', () => {
    const codec = makeCodec(sampleTextConfig, null);
    const data = Buffer.from(
      `RPT:${DEVICE_CODE}:01:101*12.7:2026-10-22 10-11-12:1:DONE\r\n`,
    );
    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    expect(decoded.warnings?.join(' ')).toContain('字典 sampleCodes 不存在');
    expect(decoded.fields.data).toMatchObject({
      item101: { value: '12.7', values: ['12.7'] },
    });
    expect(() =>
      codec.encode(
        {
          fields: {
            kind: 'report',
            groups: [{ id: '101', values: ['12.7'] }],
          },
        },
        makeContext(),
      ),
    ).toThrow('字典 sampleCodes 不存在');
  });

  it('uses live dictionary changes without rebuilding the codec', () => {
    let entries: DictionaryEntries = {
      '101': { name: '旧名称', unit: 'V' },
    };
    const provider: DictionaryProvider = { get: () => entries };
    const codec = makeCodec(sampleTextConfig, provider);
    const frame = codec.encode(
      {
        fields: {
          kind: 'report',
          groups: [{ id: '101', values: ['12.7'] }],
        },
      },
      makeContext(),
    );
    expect(
      (codec.decode(frame).fields.data as Record<string, Record<string, unknown>>)
        .item101?.name,
    ).toBe('旧名称');

    entries = { '000': { name: '新名称', unit: 'V' } };
    expect(
      (codec.decode(frame).fields.data as Record<string, Record<string, unknown>>)
        .item101?.name,
    ).toBe('新名称');
  });
});

describe('text codec auto fields and session', () => {
  it('auto-fills timestamp/sequence and returns track metadata', () => {
    const codec = makeCodec(sampleTextConfig);
    const prepared = codec.prepareOutbound!(
      { fields: { kind: 'report', groups: [] } },
      makeContext(),
    );
    expect(prepared.message.fields?.deviceCode).toBe(DEVICE_CODE);
    expect(prepared.message.fields?.sequence).toBe('1');
    expect(prepared.message.fields?.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/,
    );
    expect(prepared.track).toEqual({
      key: '1',
      field: 'sequence',
      timeoutMs: 100,
      maxRetries: 2,
    });

    const data = codec.encode(prepared.message, makeContext());
    expect(textOf(data)).toContain(':1:DONE');
    const decoded = codec.decode(data);
    expect(decoded.fields.sequence).toBe(1);
    expect(decoded.fields._summary).toContain('数据上报');
  });

  it('omits auto sequence when the field is explicitly null', () => {
    const codec = makeCodec(sampleTextConfig);
    const prepared = codec.prepareOutbound!(
      { fields: { kind: 'report', groups: [], sequence: null } },
      makeContext(),
    );
    expect(prepared.track).toBeUndefined();
    const data = codec.encode(prepared.message, makeContext());
    const decoded = codec.decode(data);
    expect(decoded.valid).toBe(true);
    expect(decoded.fields.sequence).toBeUndefined();
  });

  it('recognizes ACK fields for the protocol session', () => {
    const codec = makeCodec(sampleTextConfig);
    const ack = codec.decode(
      Buffer.from(`<RPT:${DEVICE_CODE}:20261022:101112:1:OK:DONE>\r\n`),
    );
    expect(ack.fields._message).toBe('ack');
    expect(codec.observeInbound?.(ack.fields)).toEqual({
      ackKey: '1',
      ackOk: true,
    });

    const failed = codec.decode(
      Buffer.from(`<RPT:${DEVICE_CODE}:20261022:101112:1:FAIL:DONE>\r\n`),
    );
    expect(codec.observeInbound?.(failed.fields)).toEqual({
      ackKey: '1',
      ackOk: false,
    });
  });
});

describe('text codec validation and errors', () => {
  it('reports pattern warnings without invalidating the frame', () => {
    const codec = makeCodec(sampleTextConfig);
    const decoded = codec.decode(
      Buffer.from('RPT:123:01:000*1:2026-10-22 10-11-12:1:DONE\r\n'),
    );
    expect(decoded.valid).toBe(true);
    expect(decoded.warnings?.join(' ')).toContain('不符合格式');
  });

  it('rejects missing required fields and separator collisions on encode', () => {
    const codec = makeCodec(simpleConfig);
    expect(() =>
      codec.encode({ fields: { kind: 'reading', device: 'x' } }, makeContext()),
    ).toThrow(/缺少字段/);

    expect(() =>
      codec.encode(
        {
          fields: {
            kind: 'reading',
            device: 'a:b',
            temperature: '1',
            status: 1,
          },
        },
        makeContext(),
      ),
    ).toThrow(/分隔符/);
  });

  it('rejects invalid text configurations', () => {
    expect(() =>
      TextCodecSchema.parse({
        type: 'text',
        messages: [
          {
            name: 'bad',
            slots: [
              { kind: 'field', name: 'a', type: 'int', optional: true },
              { kind: 'field', name: 'b', type: 'int', optional: true },
            ],
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      TextCodecSchema.parse({
        type: 'text',
        messages: [
          {
            name: 'bad',
            slots: [
              { kind: 'field', name: 'count', type: 'int' },
              {
                kind: 'repeat',
                name: 'items',
                countField: 'missing',
                itemSeparator: '*',
                valueField: 'values',
                fields: [
                  { kind: 'field', name: 'id', type: 'string' },
                  { kind: 'field', name: 'values', type: 'stringList' },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
