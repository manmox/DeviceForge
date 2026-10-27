import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { SerialPort } from 'serialport';
import type { SerialTransport, VirtualSerialTransport } from '../schema/device';
import type { ConnectionInfo, TransportStatus } from '../types';
import type { TransportAdapter, TransportEvents } from './types';

type SerialConfig = SerialTransport | VirtualSerialTransport;

interface VirtualPair {
  directory: string;
  devicePath: string;
  hostPath: string;
  process: ChildProcess;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPath(path: string, child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(new Error(`启动 socat 失败：${error.message}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(new Error(`socat 已退出，无法创建虚拟串口（${signal ?? `退出码 ${code}`}）`));
    const timer = setInterval(() => {
      void stat(path).then(() => finish()).catch(() => undefined);
    }, 25);
    const timeout = setTimeout(
      () => finish(new Error(`等待虚拟串口 ${path} 超时，请确认 socat 可正常创建 PTY`)),
      timeoutMs,
    );
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export function serialPortOptions(config: SerialConfig, path: string) {
  return {
    path,
    baudRate: config.baudRate,
    dataBits: config.dataBits,
    stopBits: config.stopBits,
    parity: config.parity,
    rtscts: config.flowControl === 'rtscts',
    xon: config.flowControl === 'xon-xoff',
    xoff: config.flowControl === 'xon-xoff',
    autoOpen: false,
  };
}

export class SerialTransportAdapter implements TransportAdapter {
  readonly kind: SerialConfig['type'];
  private events?: TransportEvents;
  private port?: SerialPort;
  private pair?: VirtualPair;
  private connection?: ConnectionInfo;
  private currentStatus: TransportStatus;
  private activePath?: string;
  private endpointsList: string[] = [];

  constructor(private readonly config: SerialConfig) {
    this.kind = config.type;
    this.currentStatus = { kind: this.kind, state: 'idle' };
  }

  async start(events: TransportEvents): Promise<void> {
    if (this.port) return;
    this.events = events;
    this.currentStatus = { kind: this.kind, state: 'connecting' };
    events.onStatus(this.currentStatus);

    try {
      const path = this.config.type === 'serial'
        ? this.config.portPath
        : await this.createVirtualPair();
      this.activePath = path;
      const port = new SerialPort(serialPortOptions(this.config, path));
      this.port = port;
      port.on('data', (data: Buffer) => {
        if (!this.connection) return;
        this.connection.rxBytes += data.length;
        this.events?.onData(this.connection.id, Buffer.from(data));
      });
      port.on('error', (error) => {
        this.currentStatus = { kind: this.kind, state: 'error', error: error.message };
        this.events?.onStatus(this.currentStatus);
        this.events?.onError(error, this.connection?.id);
      });

      await new Promise<void>((resolve, reject) => {
        port.open((error) => error ? reject(error) : resolve());
      });
      const id = `serial:${path}`;
      this.connection = {
        id,
        remoteAddress: path,
        connectedAt: Date.now(),
        rxBytes: 0,
        txBytes: 0,
      };
      this.currentStatus = { kind: this.kind, state: 'connected' };
      events.onStatus(this.currentStatus);
      events.onConnect(this.connection);
      if (this.config.type === 'serial') this.endpointsList = [path];
      else this.endpointsList = [path, this.pair!.hostPath];
    } catch (error) {
      await this.closePort();
      await this.closeVirtualPair();
      this.currentStatus = {
        kind: this.kind,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      events.onStatus(this.currentStatus);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const connectionId = this.connection?.id;
    await this.closePort();
    await this.closeVirtualPair();
    if (connectionId) this.events?.onDisconnect(connectionId);
    this.connection = undefined;
    this.activePath = undefined;
    this.endpointsList = [];
    this.currentStatus = { kind: this.kind, state: 'idle' };
    this.events?.onStatus(this.currentStatus);
    this.events = undefined;
  }

  async send(connectionId: string, data: Buffer): Promise<void> {
    const port = this.port;
    if (!port?.isOpen || !this.connection || connectionId !== this.connection.id) {
      throw new Error('串口当前未打开');
    }
    await new Promise<void>((resolve, reject) => {
      port.write(data, (writeError) => {
        if (writeError) {
          reject(writeError);
          return;
        }
        port.drain((drainError) => drainError ? reject(drainError) : resolve());
      });
    });
    this.connection.txBytes += data.length;
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!this.connection || this.connection.id !== connectionId) return;
    await this.closePort();
    await this.closeVirtualPair();
    this.connection = undefined;
    if (this.config.type === 'virtual-serial') this.endpointsList = [];
    this.currentStatus = { kind: this.kind, state: 'disconnected' };
    this.events?.onStatus(this.currentStatus);
    this.events?.onDisconnect(connectionId);
  }

  connections(): ConnectionInfo[] {
    return this.connection ? [{ ...this.connection }] : [];
  }

  endpoints(): string[] {
    return [...this.endpointsList];
  }

  lastConnectionId(): string | undefined {
    return this.connection?.id;
  }

  status(): TransportStatus {
    return this.currentStatus;
  }

  private async createVirtualPair(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'deviceforge-serial-'));
    const devicePath = join(directory, 'device');
    const hostPath = join(directory, 'host');
    const child = spawn('socat', [
      '-d', '-d',
      `pty,raw,echo=0,link=${devicePath}`,
      `pty,raw,echo=0,link=${hostPath}`,
    ], { stdio: 'ignore' });
    this.pair = { directory, devicePath, hostPath, process: child };
    child.once('error', (error) => {
      if (this.pair?.process !== child) return;
      this.events?.onError(new Error(`启动 socat 失败：${error.message}`));
    });
    child.once('exit', (code, signal) => {
      if (this.pair?.process !== child || !this.port) return;
      const message = `虚拟串口 socat 已退出（${signal ?? `退出码 ${code}`}）`;
      this.currentStatus = { kind: this.kind, state: 'error', error: message };
      this.events?.onStatus(this.currentStatus);
      this.events?.onError(new Error(message), this.connection?.id);
    });

    try {
      await Promise.all([
        waitForPath(devicePath, child),
        waitForPath(hostPath, child),
      ]);
    } catch (error) {
      await this.closeVirtualPair();
      throw error;
    }
    return devicePath;
  }

  private async closePort(): Promise<void> {
    const port = this.port;
    this.port = undefined;
    if (!port?.isOpen) return;
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
  }

  private async closeVirtualPair(): Promise<void> {
    const pair = this.pair;
    this.pair = undefined;
    if (!pair) return;
    if (pair.process.exitCode === null && !pair.process.killed) {
      await new Promise<void>((resolve) => {
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
          if (graceTimer) clearTimeout(graceTimer);
          if (killTimer) clearTimeout(killTimer);
          pair.process.off('exit', finish);
          resolve();
        };
        pair.process.once('exit', finish);
        pair.process.kill('SIGTERM');
        graceTimer = setTimeout(() => {
          pair.process.kill('SIGKILL');
          killTimer = setTimeout(finish, 500);
        }, 1_500);
      });
    }
    await rm(pair.directory, { recursive: true, force: true });
  }
}
