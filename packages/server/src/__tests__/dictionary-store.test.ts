import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { DictionaryStore, DictionaryStoreError } from '../store/dictionary-store';

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'deviceforge-dictionaries-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeBuiltin(dir: string, name: string, definition: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}.yaml`),
    YAML.stringify(definition),
    'utf8',
  );
}

describe('DictionaryStore', () => {
  it('loads built-ins before user dictionaries and sorts each group by id', () => {
    const dir = tempDir();
    const builtinDir = path.join(dir, 'builtin');
    const userFile = path.join(dir, 'dictionaries.json');
    writeBuiltin(builtinDir, 'z', {
      id: 'z-builtin',
      name: 'Z',
      entries: {},
    });
    writeBuiltin(builtinDir, 'a', {
      id: 'a-builtin',
      name: 'A',
      entries: {},
    });
    writeFileSync(
      userFile,
      JSON.stringify({
        version: 1,
        dictionaries: [
          { id: 'user-b', name: 'B', entries: {} },
          { id: 'user-a', name: 'A', entries: {} },
        ],
      }),
      'utf8',
    );

    const store = new DictionaryStore(userFile, builtinDir);
    expect(store.list().map((item) => item.id)).toEqual([
      'a-builtin',
      'z-builtin',
      'user-a',
      'user-b',
    ]);
    expect(store.isBuiltin('a-builtin')).toBe(true);
    expect(store.get('user-a')?.name).toBe('A');
  });

  it('backs up a corrupt user file and continues with built-ins', () => {
    const dir = tempDir();
    const builtinDir = path.join(dir, 'builtin');
    const userFile = path.join(dir, 'dictionaries.json');
    writeBuiltin(builtinDir, 'base', {
      id: 'base',
      name: 'Base',
      entries: {},
    });
    writeFileSync(userFile, '{not-json', 'utf8');

    const store = new DictionaryStore(userFile, builtinDir);
    expect(store.list().map((item) => item.id)).toEqual(['base']);
    expect(
      readdirSync(dir).some((name) => name.startsWith('dictionaries.json.corrupt-')),
    ).toBe(true);
  });

  it('creates, updates and deletes user dictionaries with live provider updates', () => {
    const dir = tempDir();
    const store = new DictionaryStore(
      path.join(dir, 'dictionaries.json'),
      path.join(dir, 'builtin'),
    );
    let changes = 0;
    store.onChange(() => {
      changes += 1;
    });

    const created = store.create({
      id: 'codes',
      name: '码表',
      entries: { '000': { name: '电压', unit: 'V' } },
    });
    expect(created.id).toBe('codes');
    expect(store.provider().get('codes')?.['000']?.name).toBe('电压');

    const updated = store.update('codes', {
      id: 'codes',
      name: '新码表',
      entries: { '000': { name: '电流', unit: 'A' } },
    });
    expect(updated.name).toBe('新码表');
    expect(store.provider().get('codes')?.['000']?.unit).toBe('A');
    expect(changes).toBe(2);

    expect(store.delete('codes')).toBe(true);
    expect(store.has('codes')).toBe(false);
    expect(changes).toBe(3);
    expect(existsSync(path.join(dir, 'dictionaries.json'))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(dir, 'dictionaries.json'), 'utf8'))
        .dictionaries,
    ).toEqual([]);
  });

  it('rejects duplicate IDs and built-in writes', () => {
    const dir = tempDir();
    const builtinDir = path.join(dir, 'builtin');
    writeBuiltin(builtinDir, 'base', {
      id: 'base',
      name: 'Base',
      entries: {},
    });
    const store = new DictionaryStore(path.join(dir, 'dictionaries.json'), builtinDir);

    expect(() =>
      store.create({ id: 'base', name: 'duplicate', entries: {} }),
    ).toThrow(DictionaryStoreError);
    expect(() =>
      store.update('base', { id: 'base', name: 'changed', entries: {} }),
    ).toThrow(DictionaryStoreError);
    expect(() => store.delete('base')).toThrow(DictionaryStoreError);
  });

  it('imports definitions idempotently and rejects content conflicts', () => {
    const dir = tempDir();
    const store = new DictionaryStore(
      path.join(dir, 'dictionaries.json'),
      path.join(dir, 'builtin'),
    );
    const definition = {
      id: 'imported',
      name: '导入',
      entries: { '000': { name: '值' } },
    };
    expect(store.importDefinitions([definition])).toHaveLength(1);
    expect(store.importDefinitions([definition])).toHaveLength(0);
    expect(() =>
      store.importDefinitions([
        { id: 'imported', name: '冲突', entries: { '000': { name: '另一个值' } } },
      ]),
    ).toThrow(DictionaryStoreError);
  });
});
