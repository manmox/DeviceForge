import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DictionaryEntries } from '@deviceforge/core';
import { DeviceStore } from '../store/device-store';
import { DictionaryStore } from '../store/dictionary-store';

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-devices-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function textDevice(
  id: string,
  options: { dictionary?: string; inline?: DictionaryEntries } = {},
) {
  return {
    id,
    name: id,
    transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    codec: {
      type: 'text',
      messages: [
        {
          name: 'report',
          slots: [
            { kind: 'field', name: 'count', type: 'int' },
            {
              kind: 'repeat',
              name: 'groups',
              countField: 'count',
              dictionary: options.dictionary,
              keyField: 'id',
              valueField: 'values',
              fields: [
                { kind: 'field', name: 'id', type: 'string' },
                { kind: 'field', name: 'values', type: 'stringList' },
              ],
            },
          ],
        },
      ],
      ...(options.inline ? { dictionaries: { sampleCodes: options.inline } } : {}),
    },
  };
}

function readEnvelope(file: string) {
  return JSON.parse(readFileSync(file, 'utf8')) as {
    version: number;
    devices: unknown[];
    dictionaries?: unknown[];
  };
}

describe('DeviceStore dictionary migration', () => {
  it('migrates inline dictionaries, rewrites refs, backs up and is idempotent', () => {
    const dir = tempDir();
    const devicesFile = path.join(dir, 'devices.json');
    const dictionariesFile = path.join(dir, 'dictionaries.json');
    const inline: DictionaryEntries = {
      '000': { name: '电压', unit: 'V' },
    };

    // B 先出现但引用 A 内联迁移出的字典，验证两遍扫描的前向引用。
    writeFileSync(
      devicesFile,
      JSON.stringify({
        version: 1,
        devices: [
          textDevice('device-b', { dictionary: 'sampleCodes' }),
          textDevice('device-a', { inline }),
          {
            id: 'bad',
            name: 'bad',
            transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
            codec: { type: 'bogus' },
          },
        ],
      }),
      'utf8',
    );

    const dictionaries = new DictionaryStore(dictionariesFile);
    const store = new DeviceStore(devicesFile, dictionaries);
    expect(store.list().map((item) => item.id).sort()).toEqual([
      'device-a',
      'device-b',
    ]);

    const rewritten = readEnvelope(devicesFile);
    expect(rewritten.devices).toHaveLength(3);
    expect(JSON.stringify(rewritten.devices)).not.toContain('"dictionaries"');
    expect(JSON.stringify(rewritten.devices)).toContain('"dictionary":"sampleCodes"');
    expect(rewritten.devices.some((item) =>
      typeof item === 'object' && item !== null && (item as { id?: string }).id === 'bad',
    )).toBe(true);

    const dictionaryFile = JSON.parse(readFileSync(dictionariesFile, 'utf8')) as {
      dictionaries: { id: string }[];
    };
    expect(dictionaryFile.dictionaries.map((item) => item.id)).toContain('sampleCodes');
    expect(
      readdirSync(dir).some((name) => name.startsWith('devices.json.pre-dictionary-migration-')),
    ).toBe(true);

    const backupCount = readdirSync(dir).filter((name) =>
      name.startsWith('devices.json.pre-dictionary-migration-'),
    ).length;
    const reloadedDictionaries = new DictionaryStore(dictionariesFile);
    const reloaded = new DeviceStore(devicesFile, reloadedDictionaries);
    expect(reloaded.list().map((item) => item.id).sort()).toEqual([
      'device-a',
      'device-b',
    ]);
    expect(
      readdirSync(dir).filter((name) =>
        name.startsWith('devices.json.pre-dictionary-migration-'),
      ),
    ).toHaveLength(backupCount);
  });

  it('preserves invalid records on save', () => {
    const dir = tempDir();
    const devicesFile = path.join(dir, 'devices.json');
    const dictionariesFile = path.join(dir, 'dictionaries.json');
    writeFileSync(
      devicesFile,
      JSON.stringify({
        version: 1,
        devices: [
          textDevice('good', {
            inline: { '000': { name: '电压' } },
          }),
          { id: 'bad', name: 'bad' },
        ],
      }),
      'utf8',
    );

    const dictionaries = new DictionaryStore(dictionariesFile);
    const store = new DeviceStore(devicesFile, dictionaries);
    expect(store.list().map((item) => item.id)).toEqual(['good']);
    expect(existsSync(devicesFile)).toBe(true);
    const rewritten = readEnvelope(devicesFile);
    expect(rewritten.devices).toHaveLength(2);
    expect(rewritten.devices.some((item) =>
      typeof item === 'object' && item !== null && (item as { id?: string }).id === 'bad',
    )).toBe(true);
  });
});
