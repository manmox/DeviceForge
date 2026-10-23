import { encodeChecksum } from '../checksum';
import type { TextValueFormat } from '../schema/dictionary';

export interface TextWaveform {
  encoding: TextValueFormat['encoding'];
  pointCount: number;
  byteLength: number;
  /** CRC 失败时为 null，表示波形点已按协议丢弃。 */
  points: number[] | null;
  crc: string;
  crcValid: boolean;
}

export type WaveformParseResult =
  | { ok: true; waveform: TextWaveform }
  | { ok: false; error: string };

const HEX_PATTERN = /^[0-9a-fA-F]*$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function normalizeEncodedText(raw: string): string {
  return raw.replace(/\s+/g, '');
}

function readPoints(data: Buffer, pointCount: number, endian: 'be' | 'le'): number[] {
  const points: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    points.push(
      endian === 'be'
        ? data.readInt16BE(index * 2)
        : data.readInt16LE(index * 2),
    );
  }
  return points;
}

export function parseInt16ArrayValue(
  raw: string,
  format: TextValueFormat,
): WaveformParseResult {
  const text = normalizeEncodedText(raw);
  const dataBytes = format.points * 2;
  const crcBytes = format.crc ? 2 : 0;
  const expectedBytes = dataBytes + crcBytes;

  let bytes: Buffer;
  if (format.encoding === 'hex') {
    if (!HEX_PATTERN.test(text) || text.length !== expectedBytes * 2) {
      return {
        ok: false,
        error: `波形值不是 ${expectedBytes * 2} 位十六进制`,
      };
    }
    bytes = Buffer.from(text, 'hex');
  } else {
    if (!BASE64_PATTERN.test(text)) {
      return { ok: false, error: '波形值不是合法的 base64' };
    }
    bytes = Buffer.from(text, 'base64');
    if (bytes.length !== expectedBytes) {
      return {
        ok: false,
        error: `波形 base64 解码后应为 ${expectedBytes} 字节，实际 ${bytes.length} 字节`,
      };
    }
  }

  const data = bytes.subarray(0, dataBytes);
  const crc = bytes.subarray(dataBytes, expectedBytes);
  let crcValid = true;
  if (format.crc) {
    const expected = encodeChecksum('crc16-modbus', data, format.crc.endian);
    crcValid = crc.length === 2 && crc.equals(expected);
  }

  return {
    ok: true,
    waveform: {
      encoding: format.encoding,
      pointCount: format.points,
      byteLength: dataBytes,
      points: crcValid ? readPoints(data, format.points, format.endian) : null,
      crc: crc.toString('hex'),
      crcValid,
    },
  };
}

export function encodeInt16ArrayValue(
  values: unknown[],
  format: TextValueFormat,
): string {
  if (values.length !== format.points) {
    throw new Error(
      `波形需要 ${format.points} 个 int16 点，实际收到 ${values.length} 个`,
    );
  }

  const data = Buffer.alloc(format.points * 2);
  values.forEach((value, index) => {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < -0x8000 ||
      value > 0x7fff
    ) {
      throw new Error(`波形第 ${index + 1} 个点不是 -32768..32767 的整数`);
    }
    if (format.endian === 'be') data.writeInt16BE(value, index * 2);
    else data.writeInt16LE(value, index * 2);
  });

  const body = format.crc
    ? Buffer.concat([data, encodeChecksum('crc16-modbus', data, format.crc.endian)])
    : data;

  return format.encoding === 'hex'
    ? body.toString('hex')
    : body.toString('base64');
}

export function waveformSummary(
  waveform: TextWaveform,
): Omit<TextWaveform, 'points'> {
  const { points: _points, ...summary } = waveform;
  return summary;
}
