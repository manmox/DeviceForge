import { describe, expect, it } from 'vitest';
import {
  crc8,
  crc16Ccitt,
  crc16Modbus,
  crc32,
  encodeChecksum,
  lrc,
  sum8,
  verifyChecksum,
  xor8,
} from '../checksum';

describe('checksum algorithms', () => {
  const check = Buffer.from('123456789');

  it('computes CRC-16/MODBUS', () => {
    expect(crc16Modbus(check)).toBe(0x4b37);
  });

  it('computes CRC-16/CCITT-FALSE', () => {
    expect(crc16Ccitt(check)).toBe(0x29b1);
  });

  it('computes CRC-32/ISO-HDLC', () => {
    expect(crc32(check)).toBe(0xcbf43926);
  });

  it('computes CRC-8/ATM', () => {
    expect(crc8(check)).toBe(0xf4);
  });

  it('computes LRC', () => {
    expect(lrc(check)).toBe(0x23);
  });

  it('computes sum8 and xor8', () => {
    expect(sum8(Buffer.from([1, 2, 3]))).toBe(6);
    expect(xor8(Buffer.from([1, 2, 3]))).toBe(0);
  });

  it('writes CRC-16/MODBUS low byte first and verifies it', () => {
    const checksum = encodeChecksum('crc16-modbus', check);
    expect(checksum.toString('hex')).toBe('374b');

    const frame = Buffer.concat([check, checksum]);
    expect(verifyChecksum('crc16-modbus', frame)).toMatchObject({ valid: true, expected: 0x4b37 });

    const corrupted = Buffer.from(frame);
    corrupted[0] = corrupted[0]! ^ 0xff;
    expect(verifyChecksum('crc16-modbus', corrupted).valid).toBe(false);
  });
});
