import { describe, expect, it } from 'vitest';
import { DeviceConfigSchema } from '../schema/device';
import { GlobalDictionaryDefinitionSchema } from '../schema/dictionary';

function baseConfig() {
  return {
    id: 'device-1',
    name: '测试设备',
    transport: { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
  };
}

describe('DeviceConfigSchema deviceInfo', () => {
  it('keeps deviceInfo optional for old configurations', () => {
    const parsed = DeviceConfigSchema.parse(baseConfig());
    expect(parsed.deviceInfo).toBeUndefined();
    expect(parsed.framing).toEqual({ type: 'raw' });
    expect(parsed.codec).toEqual({ type: 'raw', display: 'hex' });
    expect(parsed.state).toEqual({});
    expect(parsed.rules).toEqual([]);
    expect(parsed.autoStart).toBe(false);
  });

  it('accepts full and partial deviceInfo blocks', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: {
        manufacturer: 'Acme',
        model: 'TH-100',
        serialNumber: 'SN-0001',
        hardwareVersion: 'HW-1.0',
        firmwareVersion: 'FW-1.0.3',
        tnsImei: 'TNS/IMEI:DEMO 0001',
      },
    });
    expect(parsed.deviceInfo).toEqual({
      manufacturer: 'Acme',
      model: 'TH-100',
      serialNumber: 'SN-0001',
      hardwareVersion: 'HW-1.0',
      firmwareVersion: 'FW-1.0.3',
      tnsImei: 'TNS/IMEI:DEMO 0001',
    });

    const partial = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 'SN-0002' },
    });
    expect(partial.deviceInfo).toEqual({ serialNumber: 'SN-0002' });
  });

  it('accepts an empty deviceInfo object and empty strings', () => {
    expect(
      DeviceConfigSchema.parse({ ...baseConfig(), deviceInfo: {} }).deviceInfo,
    ).toEqual({});
    expect(
      DeviceConfigSchema.parse({
        ...baseConfig(),
        deviceInfo: { model: '' },
      }).deviceInfo,
    ).toEqual({ model: '' });
  });

  it('strips unknown deviceInfo keys', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 'SN-0001', vendorFoo: 'keep out' },
    });
    expect(parsed.deviceInfo).toEqual({ serialNumber: 'SN-0001' });
    expect('vendorFoo' in (parsed.deviceInfo ?? {})).toBe(false);
  });

  it('rejects wrong field types with a deviceInfo issue path', () => {
    const result = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      deviceInfo: { serialNumber: 123 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['deviceInfo', 'serialNumber']);
  });
});

describe('DeviceConfigSchema transports', () => {
  it('applies tcp-client defaults and keeps tcp-server unchanged', () => {
    const server = DeviceConfigSchema.parse(baseConfig());
    expect(server.transport).toEqual({
      type: 'tcp-server',
      host: '127.0.0.1',
      port: 19001,
    });

    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      transport: { type: 'tcp-client', port: 9000 },
    });
    expect(parsed.transport).toEqual({
      type: 'tcp-client',
      host: '127.0.0.1',
      port: 9000,
      connectTimeoutMs: 5_000,
      reconnect: {
        enabled: true,
        minDelayMs: 500,
        maxDelayMs: 10_000,
      },
    });
  });

  it('rejects missing or zero tcp-client ports', () => {
    for (const port of [undefined, 0]) {
      const result = DeviceConfigSchema.safeParse({
        ...baseConfig(),
        transport: { type: 'tcp-client', port },
      });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0]?.path).toEqual(['transport', 'port']);
    }
  });

  it('rejects invalid tcp-client timeout and reconnect settings', () => {
    const cases = [
      {
        transport: {
          type: 'tcp-client',
          port: 9000,
          connectTimeoutMs: 99,
        },
        path: ['transport', 'connectTimeoutMs'],
      },
      {
        transport: {
          type: 'tcp-client',
          port: 9000,
          reconnect: { minDelayMs: 500, maxDelayMs: 100 },
        },
        path: ['transport', 'reconnect', 'maxDelayMs'],
      },
      {
        transport: {
          type: 'tcp-client',
          port: 9000,
          reconnect: { minDelayMs: 9 },
        },
        path: ['transport', 'reconnect', 'minDelayMs'],
      },
    ];

    for (const item of cases) {
      const result = DeviceConfigSchema.safeParse({
        ...baseConfig(),
        transport: item.transport,
      });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0]?.path).toEqual(item.path);
    }
  });
});

describe('DeviceConfigSchema text codec', () => {
  function textCodec(overrides: Record<string, unknown> = {}) {
    return {
      type: 'text',
      messages: [
        {
          name: 'report',
          slots: [{ kind: 'field', name: 'value', type: 'string' }],
        },
      ],
      ...overrides,
    };
  }

  it('applies text codec defaults', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      codec: textCodec(),
    });

    expect(parsed.codec).toMatchObject({
      type: 'text',
      separator: ':',
      terminator: '\r\n',
      trim: true,
      timezone: 'local',
    });
    expect(parsed.codec.type).toBe('text');
  });

  it('rejects the removed example-terminal codec without migration', () => {
    const result = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      codec: { type: 'example-terminal' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts named timezones and rejects invalid ones', () => {
    const valid = DeviceConfigSchema.parse({
      ...baseConfig(),
      codec: textCodec({ timezone: 'Asia/Shanghai' }),
    });
    expect(valid.codec).toMatchObject({ timezone: 'Asia/Shanghai' });

    const invalid = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      codec: textCodec({ timezone: 'Mars/Olympus' }),
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(
      invalid.error.issues.some(
        (issue) => issue.path.join('.') === 'codec.timezone',
      ),
    ).toBe(true);
  });

  it('validates optional, repeat and session references', () => {
    const cases = [
      {
        codec: textCodec({
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
        path: 'messages.0.slots.1.optional',
      },
      {
        codec: textCodec({
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
        path: 'messages.0.slots.1.countField',
      },
      {
        codec: textCodec({
          messages: [
            {
              name: 'bad',
              slots: [
                {
                  kind: 'field',
                  name: 'timestamp',
                  type: 'timestamp',
                  format: 'HH:mm:ss',
                  auto: 'timestamp',
                },
              ],
            },
          ],
        }),
        path: 'messages.0.slots.0.format',
      },
      {
        codec: textCodec({
          session: {
            ackMessage: 'missing',
            sequenceField: 'sequence',
            statusField: 'status',
          },
        }),
        path: 'session.ackMessage',
      },
    ];

    for (const item of cases) {
      const result = DeviceConfigSchema.safeParse({
        ...baseConfig(),
        codec: item.codec,
      });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(
        result.error.issues.some((issue) =>
          issue.path.join('.').includes(item.path),
        ),
      ).toBe(true);
    }
  });
});

describe('global dictionary schema', () => {
  it('accepts valid IDs and empty entries', () => {
    expect(
      GlobalDictionaryDefinitionSchema.parse({
        id: 'sample-codes',
        name: '示例设备码表',
        entries: {},
      }),
    ).toMatchObject({
      id: 'sample-codes',
      name: '示例设备码表',
      entries: {},
    });
  });

  it('rejects invalid IDs and empty names', () => {
    for (const id of ['', '-bad', 'bad id', 'bad.id', 'x'.repeat(65)]) {
      const result = GlobalDictionaryDefinitionSchema.safeParse({
        id,
        name: 'bad',
        entries: {},
      });
      expect(result.success).toBe(false);
    }
    expect(
      GlobalDictionaryDefinitionSchema.safeParse({
        id: 'good',
        name: '',
        entries: {},
      }).success,
    ).toBe(false);
  });

  it('accepts a global dictionary ID in text repeats without inline entries', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      codec: {
        type: 'text',
        messages: [
          {
            name: 'report',
            slots: [
              { kind: 'field', name: 'count', type: 'int' },
              {
                kind: 'repeat',
                name: 'items',
                countField: 'count',
                dictionary: 'remote-codes',
                valueField: 'values',
                fields: [{ kind: 'field', name: 'values', type: 'stringList' }],
              },
            ],
          },
        ],
      },
    });
    expect(parsed.codec.type).toBe('text');
    if (parsed.codec.type !== 'text') return;
    expect(parsed.codec.messages[0]?.slots[1]).toMatchObject({
      kind: 'repeat',
      dictionary: 'remote-codes',
    });
    expect('dictionaries' in parsed.codec).toBe(false);
  });

  it('rejects invalid dictionary IDs in repeats', () => {
    const result = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      codec: {
        type: 'text',
        messages: [
          {
            name: 'report',
            slots: [
              { kind: 'field', name: 'count', type: 'int' },
              {
                kind: 'repeat',
                name: 'items',
                countField: 'count',
                dictionary: 'bad.id',
                valueField: 'values',
                fields: [{ kind: 'field', name: 'values', type: 'stringList' }],
              },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some((issue) =>
        issue.path.join('.').includes('dictionary'),
      ),
    ).toBe(true);
  });
});

describe('DeviceConfigSchema delimiter framing', () => {
  it('defaults legacy delimiter configs to hex', () => {
    const parsed = DeviceConfigSchema.parse({
      ...baseConfig(),
      framing: { type: 'delimiter', delimiter: '0D0A' },
    });
    expect(parsed.framing).toEqual({
      type: 'delimiter',
      delimiterFormat: 'hex',
      delimiter: '0D0A',
      includeDelimiter: false,
    });
  });

  it('accepts text delimiters including controls and Unicode', () => {
    for (const delimiter of ['|', '\r\n', '帧', '😀', '\0', '0D0A']) {
      const parsed = DeviceConfigSchema.parse({
        ...baseConfig(),
        framing: {
          type: 'delimiter',
          delimiterFormat: 'text',
          delimiter,
        },
      });
      expect(parsed.framing).toEqual({
        type: 'delimiter',
        delimiterFormat: 'text',
        delimiter,
        includeDelimiter: false,
      });
    }
  });

  it('rejects empty text and invalid hex delimiters with the delimiter path', () => {
    const cases = [
      { type: 'delimiter', delimiterFormat: 'text', delimiter: '' },
      { type: 'delimiter', delimiterFormat: 'hex', delimiter: '0D0' },
      { type: 'delimiter', delimiterFormat: 'hex', delimiter: 'ZZ' },
      { type: 'delimiter', delimiterFormat: 'hex', delimiter: '' },
      { type: 'delimiter', delimiter: '|' },
    ];

    for (const framing of cases) {
      const result = DeviceConfigSchema.safeParse({
        ...baseConfig(),
        framing,
      });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0]?.path).toEqual(['framing', 'delimiter']);
    }
  });

  it('rejects an unknown delimiter format', () => {
    const result = DeviceConfigSchema.safeParse({
      ...baseConfig(),
      framing: {
        type: 'delimiter',
        delimiterFormat: 'binary',
        delimiter: '|',
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([
      'framing',
      'delimiterFormat',
    ]);
  });
});
