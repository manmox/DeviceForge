import type { ChecksumConfig } from '../schema/device';
import type { Endian } from '../schema/device';

export type ChecksumAlgo = ChecksumConfig['algo'];

export function checksumSize(algo: ChecksumAlgo): number {
  switch (algo) {
    case 'crc16-modbus':
    case 'crc16-ccitt':
      return 2;
    case 'crc32':
      return 4;
    default:
      return 1;
  }
}

export function defaultChecksumEndian(algo: ChecksumAlgo): Endian {
  switch (algo) {
    case 'crc16-modbus':
    case 'crc32':
      return 'le';
    default:
      return 'be';
  }
}

export function sum8(data: Buffer): number {
  let sum = 0;
  for (const byte of data) sum = (sum + byte) & 0xff;
  return sum;
}

export function xor8(data: Buffer): number {
  let value = 0;
  for (const byte of data) value ^= byte;
  return value & 0xff;
}

/** Modbus ASCII LRC: two's complement of the 8-bit sum. */
export function lrc(data: Buffer): number {
  return (-sum8(data) + 0x100) & 0xff;
}

/** CRC-8/ATM: poly 0x07, init 0x00, xorout 0x00. */
export function crc8(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/** CRC-16/MODBUS: poly 0xA001 (reflected), init 0xFFFF, xorout 0x0000. */
export function crc16Modbus(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, xorout 0x0000. */
export function crc16Ccitt(data: Buffer): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** CRC-32/ISO-HDLC (Ethernet / zip): poly 0xEDB88320, init 0xFFFFFFFF, xorout 0xFFFFFFFF. */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeChecksum(algo: ChecksumAlgo, data: Buffer): number {
  switch (algo) {
    case 'sum8':
      return sum8(data);
    case 'xor8':
      return xor8(data);
    case 'lrc':
      return lrc(data);
    case 'crc8':
      return crc8(data);
    case 'crc16-modbus':
      return crc16Modbus(data);
    case 'crc16-ccitt':
      return crc16Ccitt(data);
    case 'crc32':
      return crc32(data);
  }
}

export function encodeChecksum(algo: ChecksumAlgo, data: Buffer, endian?: Endian): Buffer {
  const value = computeChecksum(algo, data);
  const size = checksumSize(algo);
  const output = Buffer.alloc(size);
  const byteOrder = endian ?? defaultChecksumEndian(algo);

  if (size === 1) {
    output.writeUInt8(value & 0xff, 0);
  } else if (size === 2) {
    if (byteOrder === 'le') output.writeUInt16LE(value & 0xffff, 0);
    else output.writeUInt16BE(value & 0xffff, 0);
  } else {
    if (byteOrder === 'le') output.writeUInt32LE(value >>> 0, 0);
    else output.writeUInt32BE(value >>> 0, 0);
  }

  return output;
}

export function verifyChecksum(
  algo: ChecksumAlgo,
  frame: Buffer,
  endian?: Endian,
): { valid: boolean; expected: number; actual: number } {
  const size = checksumSize(algo);
  if (frame.length < size) {
    return { valid: false, expected: 0, actual: 0 };
  }

  const payload = frame.subarray(0, frame.length - size);
  const tail = frame.subarray(frame.length - size);
  const byteOrder = endian ?? defaultChecksumEndian(algo);
  let actual: number;
  if (size === 1) actual = tail.readUInt8(0);
  else if (size === 2) actual = byteOrder === 'le' ? tail.readUInt16LE(0) : tail.readUInt16BE(0);
  else actual = byteOrder === 'le' ? tail.readUInt32LE(0) : tail.readUInt32BE(0);

  const expected = computeChecksum(algo, payload);
  return { valid: expected === actual, expected, actual };
}
