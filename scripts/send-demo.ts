import { readFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import path from 'node:path';
import {
  createCodec,
  createFramer,
  DeviceConfigSchema,
  type DecodeResult,
} from '@deviceforge/core';
import YAML from 'yaml';

const [host = '127.0.0.1', portArg = '19001', seqArg = '1'] = process.argv.slice(2);
const port = Number(portArg);
const seq = Number(seqArg);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`端口无效: ${portArg}`);
  process.exit(1);
}

const presetPath = path.resolve(import.meta.dirname, '../presets/vendor-sensor.yaml');
const config = DeviceConfigSchema.parse(YAML.parse(readFileSync(presetPath, 'utf8')));
const codec = createCodec(config.codec);
const framer = createFramer(config.framing);
const context = { state: {}, counters: {}, now: Date.now() };

const socket: Socket = createConnection({ host, port });
const queue: Buffer[] = [];
const waiters: ((frame: Buffer) => void)[] = [];

socket.on('data', (chunk: Buffer) => {
  for (const frame of framer.push(chunk)) {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else queue.push(frame);
  }
});

socket.on('error', (error) => {
  console.error(`连接失败: ${error.message}`);
  process.exit(1);
});

const timeout = setTimeout(() => {
  console.error('等待响应超时');
  socket.destroy();
  process.exit(1);
}, 5000);

function nextFrame(): Promise<Buffer> {
  const queued = queue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

function printFrame(title: string, frame: Buffer, decoded: DecodeResult): void {
  console.log(`\n${title}`);
  console.log(`  hex:    ${frame.toString('hex')}`);
  console.log(`  字段:   ${JSON.stringify(decoded.fields, null, 2).replace(/\n/g, '\n  ')}`);
  console.log(`  校验:   ${decoded.valid ? '通过' : `失败 (${decoded.error ?? '未知错误'})`}`);
}

await new Promise<void>((resolve, reject) => {
  socket.once('connect', resolve);
  socket.once('error', reject);
});

const greeting = await nextFrame();
printFrame('← 设备上线握手', greeting, codec.decode(greeting));

const request = codec.encode(
  { fields: { cmd: 3, seq, temp: 0, humidity: 0 } },
  context,
);
console.log(`\n→ 读取温湿度请求: ${request.toString('hex')}`);
socket.write(request);

const response = await nextFrame();
printFrame('← 设备响应', response, codec.decode(response));

clearTimeout(timeout);
socket.end();
