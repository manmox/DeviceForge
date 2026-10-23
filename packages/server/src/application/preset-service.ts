import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { validateDeviceDocument } from '../lib/device-validation';
import type { DevicePreset, DictionaryRepository, PresetApplication } from './contracts';

export type { DevicePreset } from './contracts';

export class PresetApplicationService implements PresetApplication {
  constructor(
    private readonly presetsDir: string,
    private readonly dictionaries: Pick<DictionaryRepository, 'has'>,
  ) {}

  list(): DevicePreset[] {
    if (!existsSync(this.presetsDir)) return [];

    const presets: DevicePreset[] = [];
    const files = readdirSync(this.presetsDir)
      .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort();

    for (const file of files) {
      try {
        const yaml = readFileSync(path.join(this.presetsDir, file), 'utf8');
        const result = validateDeviceDocument(
          YAML.parse(yaml),
          (id) => this.dictionaries.has(id),
        );
        if (!result.config) {
          console.warn(`[presets] 跳过无效预设 ${file}`, result.issues);
          continue;
        }
        presets.push({
          file,
          id: result.config.id,
          name: result.config.name,
          description: result.config.description ?? '',
          yaml,
          config: result.config,
        });
      } catch (error) {
        console.warn(`[presets] 读取预设 ${file} 失败`, error);
      }
    }

    const priority = ['vendor-sensor', 'line-protocol', 'tcp-echo'];
    presets.sort((left, right) => {
      const leftIndex = priority.indexOf(left.id);
      const rightIndex = priority.indexOf(right.id);
      return (leftIndex === -1 ? priority.length : leftIndex) -
        (rightIndex === -1 ? priority.length : rightIndex);
    });
    return presets;
  }
}
