import { describe, expect, it } from 'vitest';
import { createCodec, type EncodeContext } from '../codec';

const context: EncodeContext = {
  state: {},
  counters: {},
  now: 0,
};

const sensorCodec = createCodec({
  type: 'fields',
  fields: [
    { name: 'magic', type: 'bytes', length: 2, const: 'AA55' },
    { name: 'length', type: 'u16', endian: 'be', calc: 'totalLength' },
    { name: 'cmd', type: 'u8' },
    { name: 'seq', type: 'u16', endian: 'le' },
    { name: 'temp', type: 'i16', endian: 'be', scale: 0.1 },
    { name: 'humidity', type: 'u8' },
  ],
  checksum: { algo: 'crc16-modbus', endian: 'le', verify: true },
});

describe('fields codec', () => {
  it('encodes and decodes a sensor frame with calculated length and CRC', () => {
    const encoded = sensorCodec.encode(
      { fields: { cmd: 3, seq: 1, temp: 25.5, humidity: 60 } },
      context,
    );

    expect(encoded.length).toBe(12);
    expect(encoded.subarray(0, 7).toString('hex')).toBe('aa55000c030100');
    expect(encoded.subarray(7, 9).toString('hex')).toBe('00ff');

    const decoded = sensorCodec.decode(encoded);
    expect(decoded.valid).toBe(true);
    expect(decoded.fields).toMatchObject({
      magic: 'aa55',
      length: 12,
      cmd: 3,
      seq: 1,
      temp: 25.5,
      humidity: 60,
      _checksumValid: true,
    });
  });

  it('detects a corrupted checksum', () => {
    const encoded = sensorCodec.encode(
      { fields: { cmd: 3, seq: 1, temp: 25.5, humidity: 60 } },
      context,
    );
    encoded[4] = encoded[4]! ^ 0x01;

    const decoded = sensorCodec.decode(encoded);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toContain('校验失败');
  });

  it('rejects missing fields', () => {
    expect(() => sensorCodec.encode({ fields: { cmd: 3 } }, context)).toThrow('缺少字段');
  });

  it('supports remaining-length byte fields and fixed strings', () => {
    const codec = createCodec({
      type: 'fields',
      fields: [
        { name: 'cmd', type: 'u8' },
        { name: 'payload', type: 'bytes', length: 'remaining' },
        { name: 'label', type: 'string', length: 4, encoding: 'ascii' },
      ],
    });

    const encoded = codec.encode(
      { fields: { cmd: 1, payload: '010203', label: 'OK' } },
      context,
    );
    expect(encoded.toString('hex')).toBe('010102034f4b0000');

    const decoded = codec.decode(encoded);
    expect(decoded.valid).toBe(true);
    expect(decoded.fields).toMatchObject({
      cmd: 1,
      payload: '010203',
      label: 'OK\u0000\u0000',
    });
  });

  it('supports fromField lengths', () => {
    const codec = createCodec({
      type: 'fields',
      fields: [
        { name: 'len', type: 'u8' },
        { name: 'payload', type: 'bytes', length: { fromField: 'len' } },
      ],
    });
    const encoded = codec.encode({ fields: { len: 3, payload: 'aabbcc' } }, context);
    expect(encoded.toString('hex')).toBe('03aabbcc');
    expect(codec.decode(encoded).fields).toMatchObject({ len: 3, payload: 'aabbcc' });
  });
});

describe('raw codec', () => {
  const codec = createCodec({ type: 'raw', display: 'hex' });

  it('decodes hex and ascii views', () => {
    const decoded = codec.decode(Buffer.from([0x41, 0x00, 0xff]));
    expect(decoded.fields).toMatchObject({ hex: '4100ff', ascii: 'A..', length: 3 });
  });

  it('encodes hex, text, and byte arrays', () => {
    expect(codec.encode({ hex: 'aabb' }, context).toString('hex')).toBe('aabb');
    expect(codec.encode({ fields: { text: 'hi' } }, context).toString('utf8')).toBe('hi');
    expect(codec.encode({ fields: { data: [1, 2, 3] } }, context).toString('hex')).toBe('010203');
  });
});
