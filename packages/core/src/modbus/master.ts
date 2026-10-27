import { randomInt } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { SerialPort } from 'serialport';
import type {
  ModbusRtuTransport,
  SerialTransport,
  VirtualSerialTransport,
} from '../schema/device';
import { crc16Modbus } from '../checksum';
import { serialPortOptions } from '../transport/serial';
import {
  encodeModbusRtuFrame,
  encodeModbusTcpFrame,
  type ModbusMode,
  type ModbusTableName,
} from './protocol';

export type ModbusReadableTable = ModbusTableName;
export type ModbusWritableTable = 'coils' | 'holdingRegisters';
export type ModbusWriteValues = boolean[] | number[];

export type ModbusClientTarget =
  | { mode: 'tcp'; host: string; port: number }
  | {
      mode: 'rtu';
      path: string;
      serial: SerialTransport | VirtualSerialTransport;
    };

export interface ModbusOperationResult {
  mode: ModbusMode;
  unitId: number;
  functionCode: number;
  table: ModbusTableName;
  address: number;
  quantity: number;
  values: (boolean | number)[];
  requestHex: string;
  responseHex?: string;
  exceptionCode?: number;
  broadcast?: boolean;
}

export interface ModbusReadOptions {
  target: ModbusClientTarget;
  unitId: number;
  table: ModbusReadableTable;
  address: number;
  quantity: number;
  timeoutMs?: number;
}

export interface ModbusWriteOptions {
  target: ModbusClientTarget;
  unitId: number;
  table: ModbusWritableTable;
  address: number;
  values: ModbusWriteValues;
  broadcast?: boolean;
  timeoutMs?: number;
}

interface ExchangeResponse {
  frame?: Buffer;
  transactionId: number;
  requestFrame: Buffer;
  mode: ModbusMode;
  unitId: number;
}

function validateAddressRange(address: number, quantity: number): void {
  if (!Number.isInteger(address) || address < 0 || address > 65_535) {
    throw new Error('Modbus 地址必须在 0–65535 之间');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || address + quantity > 65_536) {
    throw new Error('Modbus 数量或地址范围无效');
  }
}

function readFunctionCode(table: ModbusReadableTable): number {
  switch (table) {
    case 'coils': return 1;
    case 'discreteInputs': return 2;
    case 'holdingRegisters': return 3;
    case 'inputRegisters': return 4;
  }
}

function createReadPdu(table: ModbusReadableTable, address: number, quantity: number): Buffer {
  validateAddressRange(address, quantity);
  const functionCode = readFunctionCode(table);
  const max = functionCode <= 2 ? 2_000 : 125;
  if (quantity > max) throw new Error(`功能码 ${functionCode} 最多读取 ${max} 项`);
  const pdu = Buffer.alloc(5);
  pdu[0] = functionCode;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(quantity, 3);
  return pdu;
}

function createWritePdu(
  table: ModbusWritableTable,
  address: number,
  values: ModbusWriteValues,
): { pdu: Buffer; functionCode: number } {
  validateAddressRange(address, values.length);
  if (values.length < 1) throw new Error('Modbus 写入值不能为空');
  const isCoil = table === 'coils';
  if (isCoil && !values.every((value) => typeof value === 'boolean')) {
    throw new Error('线圈写入值必须是布尔值');
  }
  if (!isCoil && !values.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65_535)) {
    throw new Error('保持寄存器写入值必须是 0–65535 的整数');
  }
  if (values.length === 1) {
    const functionCode = isCoil ? 5 : 6;
    const pdu = Buffer.alloc(5);
    pdu[0] = functionCode;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(isCoil ? (values[0] ? 0xff00 : 0) : Number(values[0]), 3);
    return { pdu, functionCode };
  }

  const functionCode = isCoil ? 15 : 16;
  const max = isCoil ? 1_968 : 123;
  if (values.length > max) throw new Error(`功能码 ${functionCode} 最多写入 ${max} 项`);
  const byteCount = isCoil ? Math.ceil(values.length / 8) : values.length * 2;
  const pdu = Buffer.alloc(6 + byteCount);
  pdu[0] = functionCode;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(values.length, 3);
  pdu[5] = byteCount;
  if (isCoil) {
    values.forEach((value, index) => {
      if (value) pdu[6 + (index >> 3)]! |= 1 << (index & 7);
    });
  } else {
    values.forEach((value, index) => pdu.writeUInt16BE(Number(value), 6 + index * 2));
  }
  return { pdu, functionCode };
}

function encodeRequest(
  target: ModbusClientTarget,
  unitId: number,
  pdu: Buffer,
  transactionId: number,
): Buffer {
  return target.mode === 'tcp'
    ? encodeModbusTcpFrame(transactionId, unitId, pdu)
    : encodeModbusRtuFrame(unitId, pdu);
}

function isLoopbackTarget(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    return host.includes(':') ? '::1' : '127.0.0.1';
  }
  return host;
}

async function exchangeTcp(
  host: string,
  port: number,
  requestFrame: Buffer,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: isLoopbackTarget(host), port });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Modbus TCP 主站请求超时')), timeoutMs);
    const finish = (error?: Error, frame?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.destroy();
      if (error) reject(error);
      else resolve(frame!);
    };
    const onError = (error: Error): void => finish(error);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 6) return;
      const length = buffer.readUInt16BE(4);
      if (buffer.readUInt16BE(2) !== 0 || length < 2 || length > 254) {
        finish(new Error('Modbus TCP 响应 MBAP 头无效'));
        return;
      }
      const frameLength = length + 6;
      if (buffer.length >= frameLength) finish(undefined, Buffer.from(buffer.subarray(0, frameLength)));
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('connect', () => socket.write(requestFrame, (error) => {
      if (error) finish(error);
    }));
  });
}

function rtuResponseLength(buffer: Buffer): number | undefined {
  if (buffer.length < 2) return undefined;
  const functionCode = buffer[1]!;
  if (functionCode & 0x80) return 5;
  if (functionCode >= 1 && functionCode <= 4) {
    return buffer.length >= 3 ? 5 + buffer[2]! : undefined;
  }
  return 8;
}

function openPort(port: SerialPort): Promise<void> {
  return new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
}

function closePort(port: SerialPort): Promise<void> {
  if (!port.isOpen) return Promise.resolve();
  return new Promise((resolve) => port.close(() => resolve()));
}

function writeAndDrain(port: SerialPort, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(frame, (error) => {
      if (error) return reject(error);
      port.drain((drainError) => drainError ? reject(drainError) : resolve());
    });
  });
}

async function exchangeRtu(
  path: string,
  serial: SerialTransport | VirtualSerialTransport,
  requestFrame: Buffer,
  timeoutMs: number,
  broadcast: boolean,
): Promise<Buffer | undefined> {
  const port = new SerialPort(serialPortOptions(serial, path));
  await openPort(port);
  try {
    if (broadcast) {
      await writeAndDrain(port, requestFrame);
      return undefined;
    }
    const response = new Promise<Buffer>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('Modbus RTU 主站请求超时')), timeoutMs);
      const finish = (error?: Error, frame?: Buffer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        port.off('data', onData);
        port.off('error', onError);
        if (error) reject(error);
        else resolve(frame!);
      };
      const onError = (error: Error): void => finish(error);
      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk]);
        const length = rtuResponseLength(buffer);
        if (length !== undefined && buffer.length >= length) {
          finish(undefined, Buffer.from(buffer.subarray(0, length)));
        }
      };
      port.on('data', onData);
      port.once('error', onError);
      void writeAndDrain(port, requestFrame).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return await response;
  } finally {
    await closePort(port);
  }
}

function parseReplyFrame(
  frame: Buffer,
  mode: ModbusMode,
  expectedTransactionId: number,
  expectedUnitId: number,
): { unitId: number; pdu: Buffer } {
  if (mode === 'tcp') {
    if (frame.length < 8 || frame.readUInt16BE(2) !== 0 || frame.length !== frame.readUInt16BE(4) + 6) {
      throw new Error('Modbus TCP 响应报文无效');
    }
    if (frame.readUInt16BE(0) !== expectedTransactionId) throw new Error('Modbus TCP 事务 ID 不匹配');
    const unitId = frame[6]!;
    if (unitId !== expectedUnitId) throw new Error('Modbus TCP 响应 Unit ID 不匹配');
    return { unitId, pdu: frame.subarray(7) };
  }

  if (frame.length < 5) throw new Error('Modbus RTU 响应报文长度不足');
  const body = frame.subarray(0, -2);
  if (crc16Modbus(body) !== frame.readUInt16LE(frame.length - 2)) {
    throw new Error('Modbus RTU 响应 CRC 校验失败');
  }
  const unitId = frame[0]!;
  if (unitId !== expectedUnitId) throw new Error('Modbus RTU 响应从站地址不匹配');
  return { unitId, pdu: frame.subarray(1, -2) };
}

function decodeReply(
  pdu: Buffer,
  requestPdu: Buffer,
  table: ModbusTableName,
  address: number,
  quantity: number,
): { values: (boolean | number)[]; exceptionCode?: number } {
  const functionCode = requestPdu[0]!;
  if (pdu.length === 2 && pdu[0] === (functionCode | 0x80)) {
    return { values: [], exceptionCode: pdu[1]! };
  }
  if (pdu[0] !== functionCode) throw new Error('Modbus 响应功能码不匹配');
  if (functionCode <= 4) {
    const expectedBytes = functionCode <= 2 ? Math.ceil(quantity / 8) : quantity * 2;
    if (pdu.length !== expectedBytes + 2 || pdu[1] !== expectedBytes) {
      throw new Error('Modbus 读取响应长度无效');
    }
    const values = functionCode <= 2
      ? Array.from({ length: quantity }, (_, index) => Boolean(pdu[2 + (index >> 3)]! & (1 << (index & 7))))
      : Array.from({ length: quantity }, (_, index) => pdu.readUInt16BE(2 + index * 2));
    return { values };
  }
  if (pdu.length !== 5 || !pdu.subarray(0, 5).equals(requestPdu.subarray(0, 5))) {
    throw new Error(`Modbus 写入响应与请求不匹配（地址 ${address}，数量 ${quantity}）`);
  }
  return { values: [] };
}

async function exchange(
  target: ModbusClientTarget,
  unitId: number,
  requestPdu: Buffer,
  timeoutMs: number,
  broadcast = false,
): Promise<ExchangeResponse> {
  if (!Number.isInteger(unitId) || unitId < (broadcast ? 0 : 1) || unitId > 247) {
    throw new Error('Modbus Unit ID 必须在 1–247 之间');
  }
  if (broadcast && target.mode !== 'rtu') throw new Error('仅 Modbus RTU 支持广播写入');
  const actualUnitId = broadcast ? 0 : unitId;
  const transactionId = randomInt(0, 65_536);
  const requestFrame = encodeRequest(target, actualUnitId, requestPdu, transactionId);
  const frame = target.mode === 'tcp'
    ? await exchangeTcp(target.host, target.port, requestFrame, timeoutMs)
    : await exchangeRtu(
        target.path,
        target.serial,
        requestFrame,
        timeoutMs,
        broadcast,
      );
  return {
    frame,
    transactionId,
    requestFrame,
    mode: target.mode,
    unitId: actualUnitId,
  };
}

export async function modbusRead(options: ModbusReadOptions): Promise<ModbusOperationResult> {
  const pdu = createReadPdu(options.table, options.address, options.quantity);
  const request = await exchange(
    options.target,
    options.unitId,
    pdu,
    options.timeoutMs ?? 3_000,
  );
  const parsed = parseReplyFrame(request.frame!, request.mode, request.transactionId, request.unitId);
  const reply = decodeReply(parsed.pdu, pdu, options.table, options.address, options.quantity);
  return {
    mode: request.mode,
    unitId: parsed.unitId,
    functionCode: pdu[0]!,
    table: options.table,
    address: options.address,
    quantity: options.quantity,
    values: reply.values,
    requestHex: request.requestFrame.toString('hex'),
    responseHex: request.frame!.toString('hex'),
    ...(reply.exceptionCode !== undefined ? { exceptionCode: reply.exceptionCode } : {}),
  };
}

export async function modbusWrite(options: ModbusWriteOptions): Promise<ModbusOperationResult> {
  if (options.broadcast && !options.values.length) throw new Error('广播写入值不能为空');
  if (options.broadcast && options.target.mode !== 'rtu') throw new Error('仅 Modbus RTU 支持广播写入');
  const { pdu, functionCode } = createWritePdu(options.table, options.address, options.values);
  const request = await exchange(
    options.target,
    options.unitId,
    pdu,
    options.timeoutMs ?? 3_000,
    options.broadcast,
  );
  if (options.broadcast) {
    return {
      mode: request.mode,
      unitId: 0,
      functionCode,
      table: options.table,
      address: options.address,
      quantity: options.values.length,
      values: [...options.values],
      requestHex: request.requestFrame.toString('hex'),
      broadcast: true,
    };
  }
  const parsed = parseReplyFrame(request.frame!, request.mode, request.transactionId, request.unitId);
  const reply = decodeReply(parsed.pdu, pdu, options.table, options.address, options.values.length);
  return {
    mode: request.mode,
    unitId: parsed.unitId,
    functionCode,
    table: options.table,
    address: options.address,
    quantity: options.values.length,
    values: [...options.values],
    requestHex: request.requestFrame.toString('hex'),
    responseHex: request.frame!.toString('hex'),
    ...(reply.exceptionCode !== undefined ? { exceptionCode: reply.exceptionCode } : {}),
  };
}

export function modbusVirtualSerialTarget(
  path: string,
  serial: ModbusRtuTransport['serial'],
): ModbusClientTarget {
  if (serial.type !== 'virtual-serial') throw new Error('MCP Modbus RTU 请求仅支持虚拟串口');
  return { mode: 'rtu', path, serial };
}
