import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DeviceConfigSchema, type DeviceConfig } from '@deviceforge/core';
import { z } from 'zod';

const StoreFileSchema = z.object({
  version: z.number().int().default(1),
  devices: z.array(z.unknown()).default([]),
});

export class DeviceStore {
  private readonly devices = new Map<string, DeviceConfig>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): DeviceConfig[] {
    return [...this.devices.values()];
  }

  get(id: string): DeviceConfig | undefined {
    return this.devices.get(id);
  }

  has(id: string): boolean {
    return this.devices.has(id);
  }

  create(config: DeviceConfig): DeviceConfig {
    if (this.devices.has(config.id)) throw new Error(`设备 ${config.id} 已存在`);
    this.devices.set(config.id, config);
    this.save();
    return config;
  }

  update(id: string, config: DeviceConfig): DeviceConfig {
    if (!this.devices.has(id)) throw new Error(`设备 ${id} 不存在`);
    if (config.id !== id) throw new Error('不能修改设备 ID');
    this.devices.set(id, config);
    this.save();
    return config;
  }

  delete(id: string): boolean {
    const deleted = this.devices.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const parsed = StoreFileSchema.parse(raw);
      for (const item of parsed.devices) {
        const result = DeviceConfigSchema.safeParse(item);
        if (result.success) {
          this.devices.set(result.data.id, result.data);
        } else {
          console.warn(`[store] 跳过无效设备配置`, result.error.issues);
        }
      }
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        copyFileSync(this.filePath, backup);
      } catch {
        // ignore backup failure
      }
      console.error(`[store] 读取 ${this.filePath} 失败，已备份到 ${backup}`, error);
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = {
      version: 1,
      devices: [...this.devices.values()],
    };
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tempPath, this.filePath);
  }
}
