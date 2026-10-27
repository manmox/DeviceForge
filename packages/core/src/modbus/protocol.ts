import { crc16Modbus } from '../checksum';
import type { ModbusTables } from '../schema/device';
import type { ModbusTrafficMetadata } from '../types';

export type ModbusMode = 'tcp' | 'rtu';
export type ModbusTableName = keyof ModbusTables;

export interface ModbusRequestContext {
  mode: ModbusMode;
  unitId: number;
  functionCode: number;
  table?: ModbusTableName;
  address?: number;
  quantity?: number;
  transactionId?: number;
  broadcast?: boolean;
}

export interface ModbusServerResult {
  request: ModbusTrafficMetadata;
  response?: Buffer;
  responseMetadata?: ModbusTrafficMetadata;
  changed: boolean;
  ignored?: boolean;
  error?: string;
}

interface ParsedRequest {
  unitId: number;
  functionCode: number;
  pdu: Buffer;
  transactionId?: number;
}

function metadata(
  mode: ModbusMode,
  unitId: number,
  functionCode: number,
  values: Partial<Pick<ModbusTrafficMetadata, 'table' | 'address' | 'quantity' | 'broadcast' | 'exceptionCode'>> = {},
): ModbusTrafficMetadata {
  return { mode, unitId, functionCode, ...values };
}

function parseRequestFrame(frame: Buffer, mode: ModbusMode): ParsedRequest {
  if (mode === 'tcp') {
    if (frame.length < 8) throw new Error('Modbus TCP 报文长度不足');
    if (frame.readUInt16BE(2) !== 0) throw new Error('Modbus TCP Protocol ID 必须为 0');
    const length = frame.readUInt16BE(4);
    if (length < 2 || length > 254 || frame.length !== length + 6) {
      throw new Error('Modbus TCP MBAP 长度无效');
    }
    return {
      transactionId: frame.readUInt16BE(0),
      unitId: frame[6]!,
      functionCode: frame[7]!,
      pdu: frame.subarray(7),
    };
  }

  if (frame.length < 4) throw new Error('Modbus RTU 报文长度不足');
  const body = frame.subarray(0, -2);
  const suppliedCrc = frame.readUInt16LE(frame.length - 2);
  if (crc16Modbus(body) !== suppliedCrc) throw new Error('Modbus RTU CRC 校验失败');
  return {
    unitId: frame[0]!,
    functionCode: frame[1]!,
    pdu: frame.subarray(1, -2),
  };
}

export function encodeModbusRtuFrame(unitId: number, pdu: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([unitId]), pdu]);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(crc16Modbus(body));
  return Buffer.concat([body, crc]);
}

export function encodeModbusTcpFrame(transactionId: number, unitId: number, pdu: Buffer): Buffer {
  const frame = Buffer.alloc(7 + pdu.length);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame[6] = unitId;
  pdu.copy(frame, 7);
  return frame;
}

function exceptionPdu(functionCode: number, exceptionCode: number): Buffer {
  return Buffer.from([functionCode | 0x80, exceptionCode]);
}

function addressOf(pdu: Buffer): number | undefined {
  return pdu.length >= 3 ? pdu.readUInt16BE(1) : undefined;
}

function readRange(
  table: Record<string, boolean | number>,
  address: number,
  quantity: number,
): (boolean | number)[] | undefined {
  const values: (boolean | number)[] = [];
  for (let offset = 0; offset < quantity; offset += 1) {
    const key = String(address + offset);
    if (!Object.hasOwn(table, key)) return undefined;
    values.push(table[key]!);
  }
  return values;
}

function hasRange(
  table: Record<string, boolean | number>,
  address: number,
  quantity: number,
): boolean {
  for (let offset = 0; offset < quantity; offset += 1) {
    if (!Object.hasOwn(table, String(address + offset))) return false;
  }
  return true;
}

function rangeIsValid(address: number, quantity: number): boolean {
  return quantity > 0 && address >= 0 && address + quantity <= 65_536;
}

function processPdu(
  pdu: Buffer,
  tables: ModbusTables,
): { response: Buffer; details: Omit<ModbusTrafficMetadata, 'mode' | 'unitId'>; changed: boolean } {
  const functionCode = pdu[0]!;
  const address = addressOf(pdu);
  let table: ModbusTableName | undefined;
  let quantity: number | undefined;
  let changed = false;
  let response: Buffer;
  let exceptionCode: number | undefined;

  const exception = (code: number): void => {
    exceptionCode = code;
    response = exceptionPdu(functionCode, code);
  };
  const exactLength = (length: number): boolean => {
    if (pdu.length === length) return true;
    exception(3);
    return false;
  };
  const validateRange = (start: number, count: number): boolean => {
    if (!rangeIsValid(start, count)) {
      exception(2);
      return false;
    }
    return true;
  };

  switch (functionCode) {
    case 1:
    case 2:
    case 3:
    case 4: {
      if (!exactLength(5)) break;
      const start = pdu.readUInt16BE(1);
      const count = pdu.readUInt16BE(3);
      quantity = count;
      table = functionCode === 1 ? 'coils'
        : functionCode === 2 ? 'discreteInputs'
          : functionCode === 3 ? 'holdingRegisters' : 'inputRegisters';
      const max = functionCode <= 2 ? 2_000 : 125;
      if (count < 1 || count > max) {
        exception(3);
        break;
      }
      if (!validateRange(start, count)) break;
      const values = readRange(tables[table], start, count);
      if (!values) {
        exception(2);
        break;
      }
      if (functionCode <= 2) {
        const bytes = Buffer.alloc(Math.ceil(count / 8));
        values.forEach((value, index) => {
          if (value) bytes[index >> 3]! |= 1 << (index & 7);
        });
        response = Buffer.concat([Buffer.from([functionCode, bytes.length]), bytes]);
      } else {
        const bytes = Buffer.alloc(count * 2);
        values.forEach((value, index) => bytes.writeUInt16BE(Number(value), index * 2));
        response = Buffer.concat([Buffer.from([functionCode, bytes.length]), bytes]);
      }
      break;
    }
    case 5:
    case 6: {
      if (!exactLength(5)) break;
      const start = pdu.readUInt16BE(1);
      const value = pdu.readUInt16BE(3);
      table = functionCode === 5 ? 'coils' : 'holdingRegisters';
      quantity = 1;
      if (functionCode === 5 && value !== 0 && value !== 0xff00) {
        exception(3);
        break;
      }
      if (!Object.hasOwn(tables[table], String(start))) {
        exception(2);
        break;
      }
      tables[table][String(start)] = functionCode === 5 ? value === 0xff00 : value;
      changed = true;
      response = Buffer.from(pdu);
      break;
    }
    case 15:
    case 16: {
      if (pdu.length < 6) {
        exception(3);
        break;
      }
      const start = pdu.readUInt16BE(1);
      const count = pdu.readUInt16BE(3);
      const byteCount = pdu[5]!;
      table = functionCode === 15 ? 'coils' : 'holdingRegisters';
      quantity = count;
      const max = functionCode === 15 ? 1_968 : 123;
      const expectedBytes = functionCode === 15 ? Math.ceil(count / 8) : count * 2;
      if (count < 1 || count > max || byteCount !== expectedBytes || pdu.length !== 6 + byteCount) {
        exception(3);
        break;
      }
      if (!validateRange(start, count)) break;
      if (!hasRange(tables[table], start, count)) {
        exception(2);
        break;
      }
      if (functionCode === 15) {
        for (let offset = 0; offset < count; offset += 1) {
          const value = Boolean(pdu[6 + (offset >> 3)]! & (1 << (offset & 7)));
          tables.coils[String(start + offset)] = value;
        }
      } else {
        for (let offset = 0; offset < count; offset += 1) {
          tables.holdingRegisters[String(start + offset)] = pdu.readUInt16BE(6 + offset * 2);
        }
      }
      changed = true;
      response = Buffer.alloc(5);
      response[0] = functionCode;
      response.writeUInt16BE(start, 1);
      response.writeUInt16BE(count, 3);
      break;
    }
    default:
      exception(1);
  }

  const details: Omit<ModbusTrafficMetadata, 'mode' | 'unitId'> = {
    functionCode,
    ...(table ? { table } : {}),
    ...(address !== undefined ? { address } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(exceptionCode !== undefined ? { exceptionCode } : {}),
  };
  return { response: response!, details, changed };
}

export function processModbusRequest(
  frame: Buffer,
  mode: ModbusMode,
  unitId: number,
  tables: ModbusTables,
): ModbusServerResult {
  let parsed: ParsedRequest;
  try {
    parsed = parseRequestFrame(frame, mode);
  } catch (error) {
    const unit = frame[mode === 'tcp' ? 6 : 0] ?? 0;
    const functionCode = frame[mode === 'tcp' ? 7 : 1] ?? 1;
    return {
      request: metadata(mode, unit, functionCode),
      changed: false,
      ignored: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const broadcast = mode === 'rtu' && parsed.unitId === 0;
  const requestMeta = metadata(mode, parsed.unitId, parsed.functionCode, {
    ...(addressOf(parsed.pdu) !== undefined ? { address: addressOf(parsed.pdu) } : {}),
    ...(broadcast ? { broadcast: true } : {}),
  });
  if (!broadcast && parsed.unitId !== unitId) {
    return { request: requestMeta, changed: false, ignored: true };
  }

  let processed: ReturnType<typeof processPdu>;
  try {
    processed = processPdu(parsed.pdu, tables);
  } catch {
    const functionCode = parsed.functionCode;
    const table: ModbusTableName | undefined = functionCode === 1 || functionCode === 5 || functionCode === 15
      ? 'coils'
      : functionCode === 2
        ? 'discreteInputs'
        : functionCode === 3 || functionCode === 6 || functionCode === 16
          ? 'holdingRegisters'
          : functionCode === 4
            ? 'inputRegisters'
            : undefined;
    const details: Omit<ModbusTrafficMetadata, 'mode' | 'unitId'> = {
      functionCode,
      ...(table ? { table } : {}),
      ...(addressOf(parsed.pdu) !== undefined ? { address: addressOf(parsed.pdu) } : {}),
      ...(parsed.pdu.length >= 5 && functionCode >= 1 && functionCode <= 4
        ? { quantity: parsed.pdu.readUInt16BE(3) }
        : functionCode === 5 || functionCode === 6
          ? { quantity: 1 }
          : parsed.pdu.length >= 5 && (functionCode === 15 || functionCode === 16)
            ? { quantity: parsed.pdu.readUInt16BE(3) }
            : {}),
      exceptionCode: 4,
    };
    const request = metadata(mode, parsed.unitId, functionCode, {
      ...(broadcast ? { broadcast: true } : {}),
      ...details,
    });
    if (broadcast) return { request, changed: false, ignored: true };
    const exception = exceptionPdu(functionCode, 4);
    const response = mode === 'tcp'
      ? encodeModbusTcpFrame(parsed.transactionId!, parsed.unitId, exception)
      : encodeModbusRtuFrame(parsed.unitId, exception);
    return {
      request,
      response,
      responseMetadata: metadata(mode, parsed.unitId, functionCode, details),
      changed: false,
    };
  }
  const request = { ...requestMeta, ...processed.details };
  if (broadcast) {
    const isWrite = [5, 6, 15, 16].includes(parsed.functionCode);
    return {
      request,
      changed: isWrite && processed.changed,
      ignored: !isWrite,
    };
  }

  const response = mode === 'tcp'
    ? encodeModbusTcpFrame(parsed.transactionId!, parsed.unitId, processed.response)
    : encodeModbusRtuFrame(parsed.unitId, processed.response);
  return {
    request,
    response,
    responseMetadata: metadata(mode, parsed.unitId, parsed.functionCode, processed.details),
    changed: processed.changed,
  };
}
