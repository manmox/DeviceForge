import { execFileSync } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import { SerialPort } from 'serialport';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRuntime } from '../runtime/device-runtime';
import { DeviceConfigSchema, type ModbusTables } from '../schema/device';
import { ModbusTrafficMetadataSchema } from '../types';
import {
  encodeModbusRtuFrame,
  encodeModbusTcpFrame,
  modbusRead,
  modbusVirtualSerialTarget,
  modbusWrite,
  processModbusRequest,
} from '../modbus';

const socatAvailable = (() => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
  try {
    execFileSync('socat', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const activeRuntimes: DeviceRuntime[] = [];

afterEach(async () => {
  await Promise.all(activeRuntimes.splice(0).map((runtime) => runtime.stop()));
});

function makeTables(): ModbusTables {
  return {
    coils: { '0': true, '1': false, '2': true, '3': false },
    discreteInputs: { '0': false, '1': true, '2': true, '3': false },
    holdingRegisters: { '0': 0x1234, '1': 0xabcd, '2': 0 },
    inputRegisters: { '0': 0x5678, '1': 0x9abc },
  };
}

function pdu(functionCode: number, address: number, quantityOrValue: number): Buffer {
  const result = Buffer.alloc(5);
  result[0] = functionCode;
  result.writeUInt16BE(address, 1);
  result.writeUInt16BE(quantityOrValue, 3);
  return result;
}

function tcpRequestPdu(response: Buffer): Buffer {
  return response.subarray(7);
}

function rawTcpRequest(transactionId: number, unitId: number, requestPdu: Buffer): Buffer {
  const frame = Buffer.alloc(7 + requestPdu.length);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(requestPdu.length + 1, 4);
  frame[6] = unitId;
  requestPdu.copy(frame, 7);
  return frame;
}

function readTcpFrames(socket: Socket, expected: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const frames: Buffer[] = [];
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('等待 Modbus TCP 响应超时')), 2_000);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) reject(error);
      else resolve(frames);
    };
    const onError = (error: Error): void => finish(error);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 6) {
        const length = buffer.readUInt16BE(4) + 6;
        if (buffer.length < length) break;
        frames.push(Buffer.from(buffer.subarray(0, length)));
        buffer = buffer.subarray(length);
        if (frames.length === expected) finish();
      }
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function readRtuResponse(port: SerialPort, timeoutMs = 1_000): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(), timeoutMs);
    const finish = (frame?: Buffer, error?: Error): void => {
      clearTimeout(timer);
      port.off('data', onData);
      port.off('error', onError);
      if (error) reject(error);
      else resolve(frame);
    };
    const onError = (error: Error): void => finish(undefined, error);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const functionCode = buffer[1]!;
      const expected = functionCode & 0x80
        ? 5
        : functionCode >= 1 && functionCode <= 4
          ? buffer.length >= 3 ? 5 + buffer[2]! : undefined
          : 8;
      if (expected !== undefined && buffer.length >= expected) {
        finish(Buffer.from(buffer.subarray(0, expected)));
      }
    };
    port.on('data', onData);
    port.once('error', onError);
  });
}

function writeSerial(port: SerialPort, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(data, (error) => error ? reject(error) : resolve());
  });
}

async function startTcpRuntime(tables = makeTables()): Promise<{ runtime: DeviceRuntime; host: string; port: number }> {
  const config = DeviceConfigSchema.parse({
    id: 'modbus-tcp-test',
    name: 'Modbus TCP test',
    transport: { type: 'modbus-tcp', host: '127.0.0.1', port: 0, unitId: 1, tables },
  });
  const runtime = new DeviceRuntime(config);
  activeRuntimes.push(runtime);
  await runtime.start();
  const endpoint = runtime.getStatus().endpoints[0]!;
  const separator = endpoint.lastIndexOf(':');
  return { runtime, host: endpoint.slice(0, separator), port: Number(endpoint.slice(separator + 1)) };
}

describe('Modbus 配置与 PDU', () => {
  it('设置 TCP 和 RTU 默认参数，并拒绝通用协议规则', () => {
    const tcp = DeviceConfigSchema.parse({
      id: 'modbus-defaults',
      name: 'defaults',
      transport: { type: 'modbus-tcp' },
    });
    expect(tcp.transport).toMatchObject({ type: 'modbus-tcp', host: '127.0.0.1', port: 1502, unitId: 1 });
    if (tcp.transport.type === 'modbus-tcp') expect(tcp.transport.tables).toEqual(makeEmptyTables());

    const rtu = DeviceConfigSchema.parse({
      id: 'modbus-rtu-defaults',
      name: 'defaults',
      transport: { type: 'modbus-rtu' },
    });
    expect(rtu.transport).toMatchObject({
      type: 'modbus-rtu', unitId: 1,
      serial: { type: 'virtual-serial', baudRate: 9_600, dataBits: 8, parity: 'none', stopBits: 1 },
    });

    expect(DeviceConfigSchema.safeParse({
      id: 'modbus-rule', name: 'invalid', transport: { type: 'modbus-tcp' },
      rules: [{ on: 'frame', send: { ascii: 'ignored' } }],
    }).success).toBe(false);
    expect(DeviceConfigSchema.safeParse({
      id: 'modbus-key', name: 'invalid',
      transport: { type: 'modbus-tcp', tables: { coils: { '01': true } } },
    }).success).toBe(false);
  });

  it('支持四张表读取和位序、寄存器大端字节序', () => {
    const tables = makeTables();
    const cases = [
      { fc: 1, expected: [1, 1, 1] },
      { fc: 2, expected: [2, 1, 2] },
      { fc: 3, expected: [3, 4, 0x12, 0x34, 0xab, 0xcd] },
      { fc: 4, expected: [4, 4, 0x56, 0x78, 0x9a, 0xbc] },
    ];
    for (const item of cases) {
      const response = processModbusRequest(
        encodeModbusTcpFrame(0x1234, 1, pdu(item.fc, 0, 2)),
        'tcp', 1, tables,
      ).response!;
      expect([...tcpRequestPdu(response)]).toEqual(item.expected);
    }
    const bits = processModbusRequest(
      encodeModbusTcpFrame(3, 1, pdu(1, 0, 4)), 'tcp', 1, tables,
    ).response!;
    expect(tcpRequestPdu(bits)[2]).toBe(0x05);
  });

  it('支持单值与多值写入，并只接受已映射地址', () => {
    const tables = makeTables();
    const writes = [
      Buffer.from([5, 0, 0, 0xff, 0]),
      Buffer.from([6, 0, 2, 0x22, 0x33]),
      Buffer.from([15, 0, 1, 0, 3, 1, 0x05]),
      Buffer.from([16, 0, 0, 0, 2, 4, 0, 7, 0, 8]),
    ];
    for (const write of writes) {
      const reply = processModbusRequest(encodeModbusTcpFrame(7, 1, write), 'tcp', 1, tables);
      expect(reply.changed).toBe(true);
      expect(tcpRequestPdu(reply.response!)[0]).toBe(write[0]);
    }
    expect(tables.coils).toMatchObject({ '0': true, '1': true, '2': false, '3': true });
    expect(tables.holdingRegisters).toMatchObject({ '0': 7, '1': 8, '2': 0x2233 });

    const missing = processModbusRequest(
      encodeModbusTcpFrame(8, 1, pdu(3, 4, 1)), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(missing.response!)).toEqual(Buffer.from([0x83, 2]));
  });

  it('返回标准异常码，忽略其他 Unit ID，并处理 RTU 广播与 CRC 错误', () => {
    const tables = makeTables();
    const unsupported = processModbusRequest(
      encodeModbusTcpFrame(1, 1, Buffer.from([0x45])), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(unsupported.response!)).toEqual(Buffer.from([0xc5, 1]));
    const invalidCount = processModbusRequest(
      encodeModbusTcpFrame(2, 1, pdu(3, 0, 126)), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(invalidCount.response!)).toEqual(Buffer.from([0x83, 3]));
    const zeroQuantity = processModbusRequest(
      encodeModbusTcpFrame(13, 1, pdu(3, 0, 0)), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(zeroQuantity.response!)).toEqual(Buffer.from([0x83, 3]));
    expect(ModbusTrafficMetadataSchema.parse(zeroQuantity.request)).toMatchObject({ functionCode: 3, quantity: 0 });
    const tooManyCoils = processModbusRequest(
      encodeModbusTcpFrame(9, 1, pdu(1, 0, 2_001)), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(tooManyCoils.response!)).toEqual(Buffer.from([0x81, 3]));
    const overflow = processModbusRequest(
      encodeModbusTcpFrame(10, 1, pdu(3, 65_535, 2)), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(overflow.response!)).toEqual(Buffer.from([0x83, 2]));
    const tooManyMultiWritePdu = Buffer.alloc(6 + 247);
    tooManyMultiWritePdu[0] = 15;
    tooManyMultiWritePdu.writeUInt16BE(0, 1);
    tooManyMultiWritePdu.writeUInt16BE(1_969, 3);
    tooManyMultiWritePdu[5] = 247;
    const tooManyMultiWrite = processModbusRequest(
      encodeModbusTcpFrame(11, 1, tooManyMultiWritePdu), 'tcp', 1, tables,
    );
    expect(tcpRequestPdu(tooManyMultiWrite.response!)).toEqual(Buffer.from([0x8f, 3]));

    const frozenTables = makeTables();
    Object.freeze(frozenTables.holdingRegisters);
    const internalFailure = processModbusRequest(
      encodeModbusTcpFrame(12, 1, Buffer.from([6, 0, 0, 0, 1])), 'tcp', 1, frozenTables,
    );
    expect(tcpRequestPdu(internalFailure.response!)).toEqual(Buffer.from([0x86, 4]));

    const otherUnit = processModbusRequest(encodeModbusTcpFrame(3, 2, pdu(3, 0, 1)), 'tcp', 1, tables);
    expect(otherUnit.ignored).toBe(true);
    expect(otherUnit.response).toBeUndefined();

    const corrupt = encodeModbusRtuFrame(1, pdu(3, 0, 1));
    corrupt[corrupt.length - 1]! ^= 0xff;
    const invalidCrc = processModbusRequest(corrupt, 'rtu', 1, tables);
    expect(invalidCrc).toMatchObject({ ignored: true, changed: false });
    expect(invalidCrc.response).toBeUndefined();

    const broadcast = processModbusRequest(
      encodeModbusRtuFrame(0, Buffer.from([6, 0, 0, 0x44, 0x55])), 'rtu', 1, tables,
    );
    expect(broadcast).toMatchObject({ changed: true, request: { broadcast: true } });
    expect(broadcast.response).toBeUndefined();
    expect(tables.holdingRegisters['0']).toBe(0x4455);
  });
});

describe('Modbus TCP/RTU 真实传输', () => {
  it('在动态 TCP 端口处理分片、粘连、多客户端、读写和事务 ID', async () => {
    const { runtime, host, port } = await startTcpRuntime();
    const socket = createConnection({ host, port });
    await once(socket, 'connect');
    try {
      const replies = readTcpFrames(socket, 2);
      const first = rawTcpRequest(0x1020, 1, pdu(3, 0, 2));
      const second = rawTcpRequest(0x3040, 1, pdu(4, 0, 1));
      socket.write(first.subarray(0, 3));
      socket.write(first.subarray(3));
      socket.write(second);
      const [a, b] = await replies;
      expect(a.readUInt16BE(0)).toBe(0x1020);
      expect(b.readUInt16BE(0)).toBe(0x3040);
      expect([...tcpRequestPdu(a)]).toEqual([3, 4, 0x12, 0x34, 0xab, 0xcd]);

      const target = { mode: 'tcp' as const, host, port };
      const write = await modbusWrite({ target, unitId: 1, table: 'holdingRegisters', address: 1, values: [77, 88] });
      expect(write.functionCode).toBe(16);
      const read = await modbusRead({ target, unitId: 1, table: 'holdingRegisters', address: 1, quantity: 2 });
      expect(read.values).toEqual([77, 88]);
      expect((runtime.getState().modbus as ModbusTables).holdingRegisters).toMatchObject({ '1': 77, '2': 88 });
    } finally {
      socket.destroy();
    }
  });

  it.skipIf(!socatAvailable)('通过 socat PTY 完成 RTU 收发、CRC 和广播写入', async () => {
    const config = DeviceConfigSchema.parse({
      id: 'modbus-rtu-pty-test', name: 'Modbus RTU PTY test',
      transport: {
        type: 'modbus-rtu', unitId: 7,
        serial: { type: 'virtual-serial', baudRate: 9_600, dataBits: 8, stopBits: 1, parity: 'none' },
        tables: makeTables(),
      },
    });
    const runtime = new DeviceRuntime(config);
    activeRuntimes.push(runtime);
    await runtime.start();
    const masterPath = runtime.getStatus().endpoints[1]!;
    const target = modbusVirtualSerialTarget(masterPath, config.transport.type === 'modbus-rtu' ? config.transport.serial : neverSerial());
    const read = await modbusRead({ target, unitId: 7, table: 'inputRegisters', address: 0, quantity: 2 });
    expect(read.values).toEqual([0x5678, 0x9abc]);

    const master = new SerialPort({
      path: masterPath, baudRate: 9_600, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false,
    });
    await new Promise<void>((resolve, reject) => master.open((error) => error ? reject(error) : resolve()));
    try {
      const invalid = encodeModbusRtuFrame(7, pdu(3, 0, 1));
      invalid[invalid.length - 1]! ^= 0xff;
      const noReply = readRtuResponse(master, 60);
      await writeSerial(master, invalid);
      expect(await noReply).toBeUndefined();

      const fragmentedReply = readRtuResponse(master);
      const valid = encodeModbusRtuFrame(7, pdu(3, 0, 2));
      await writeSerial(master, valid.subarray(0, 3));
      await new Promise((resolve) => setTimeout(resolve, 1));
      await writeSerial(master, valid.subarray(3));
      const response = await fragmentedReply;
      expect(response).toBeDefined();
      const responseBody = response!.subarray(0, -2);
      expect(response!.readUInt16LE(response!.length - 2)).toBe((await import('../checksum')).crc16Modbus(responseBody));
      expect([...responseBody]).toEqual([7, 3, 4, 0x12, 0x34, 0xab, 0xcd]);
    } finally {
      await new Promise<void>((resolve) => master.close(() => resolve()));
    }

    const write = await modbusWrite({ target, unitId: 7, table: 'coils', address: 1, values: [true, true] });
    expect(write.functionCode).toBe(15);
    const broadcast = await modbusWrite({ target, unitId: 7, table: 'holdingRegisters', address: 0, values: [91], broadcast: true });
    expect(broadcast).toMatchObject({ broadcast: true, unitId: 0 });
    expect(broadcast.responseHex).toBeUndefined();
    const updated = await modbusRead({ target, unitId: 7, table: 'holdingRegisters', address: 0, quantity: 1 });
    expect(updated.values).toEqual([91]);
  });
});

function makeEmptyTables(): ModbusTables {
  return { coils: {}, discreteInputs: {}, holdingRegisters: {}, inputRegisters: {} };
}

function neverSerial(): never {
  throw new Error('预期虚拟 RTU 配置');
}
