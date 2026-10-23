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

describe('DictionaryStore', () => {
  it('只从本机用户数据文件加载字典，不扫描仓库目录', () => {
    const dir = tempDir();
    const userFile = path.join(dir, 'dictionaries.json');
    const formerBuiltinDir = path.join(dir, 'dictionaries');
    mkdirSync(formerBuiltinDir, { recursive: true });
    writeFileSync(
      path.join(formerBuiltinDir, 'codes.yaml'),
      'id: leaked-codes\nname: 仓库字典\nentries: {}\n',
      'utf8',
    );
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

    const store = new DictionaryStore(userFile);
    expect(store.list().map((item) => item.id)).toEqual(['user-a', 'user-b']);
    expect(store.get('leaked-codes')).toBeUndefined();
    expect(store.get('user-a')?.name).toBe('A');
  });

  it('字典文件损坏时备份文件并以空列表启动', () => {
    const dir = tempDir();
    const userFile = path.join(dir, 'dictionaries.json');
    writeFileSync(userFile, '{not-json', 'utf8');

    const store = new DictionaryStore(userFile);
    expect(store.list()).toEqual([]);
    expect(
      readdirSync(dir).some((name) => name.startsWith('dictionaries.json.corrupt-')),
    ).toBe(true);
  });

  it('creates, updates and deletes user dictionaries with live provider updates', () => {
    const dir = tempDir();
    const store = new DictionaryStore(path.join(dir, 'dictionaries.json'));
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

  it('拒绝重复 ID，并拒绝更新或删除不存在的字典', () => {
    const dir = tempDir();
    const store = new DictionaryStore(path.join(dir, 'dictionaries.json'));

    store.create({ id: 'base', name: 'Base', entries: {} });
    expect(() => store.create({ id: 'base', name: 'duplicate', entries: {} })).toThrow(
      DictionaryStoreError,
    );
    expect(() =>
      store.update('missing', { id: 'missing', name: 'changed', entries: {} }),
    ).toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(() => store.delete('missing')).toThrowError(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('拒绝仅大小写不同的字典 ID', () => {
    const dir = tempDir();
    const store = new DictionaryStore(path.join(dir, 'dictionaries.json'));
    store.create({ id: 'Sensor-Codes', name: '传感器码表', entries: {} });

    expect(() =>
      store.create({ id: 'sensor-codes', name: '重复码表', entries: {} }),
    ).toThrowError(expect.objectContaining({ statusCode: 409 }));
    expect(() =>
      store.importDefinitions([
        { id: 'new-codes', name: '新码表', entries: {} },
        { id: 'NEW-CODES', name: '重复码表', entries: {} },
      ]),
    ).toThrowError(expect.objectContaining({ statusCode: 409 }));
    expect(store.has('new-codes')).toBe(false);
  });

  it('加载大小写冲突记录时保留冲突原文，写入时不覆盖', () => {
    const dir = tempDir();
    const file = path.join(dir, 'dictionaries.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        dictionaries: [
          { id: 'Alpha', name: '首条', entries: {} },
          { id: 'alpha', name: '冲突项', entries: {} },
        ],
      }),
      'utf8',
    );
    const store = new DictionaryStore(file);

    expect(store.list().map((item) => item.id)).toEqual(['Alpha']);
    store.update('Alpha', { id: 'Alpha', name: '已更新', entries: {} });
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      dictionaries: { id: string }[];
    };
    expect(saved.dictionaries.map((item) => item.id)).toEqual(['Alpha', 'alpha']);
  });

  it('按条目内容幂等导入，保留现有名称说明并拒绝条目冲突', () => {
    const dir = tempDir();
    const store = new DictionaryStore(path.join(dir, 'dictionaries.json'));
    const definition = {
      id: 'imported',
      name: '导入',
      entries: { '000': { name: '值' } },
    };
    expect(store.importDefinitions([definition])).toHaveLength(1);
    expect(store.importDefinitions([{
      ...definition,
      name: '迁移来源名称',
      description: '迁移来源说明',
    }])).toHaveLength(0);
    expect(store.get('imported')?.name).toBe('导入');
    expect(store.get('imported')?.description).toBeUndefined();
    expect(() =>
      store.importDefinitions([
        { id: 'imported', name: '冲突', entries: { '000': { name: '另一个值' } } },
      ]),
    ).toThrow(DictionaryStoreError);
  });

  it('持久化失败时不保留内存中的新增字典', () => {
    const dir = tempDir();
    const blockedParent = path.join(dir, 'blocked-parent');
    writeFileSync(blockedParent, 'file blocks directory creation', 'utf8');
    const store = new DictionaryStore(path.join(blockedParent, 'dictionaries.json'));

    expect(() => store.create({ id: 'codes', name: '码表', entries: {} })).toThrow();
    expect(store.has('codes')).toBe(false);
    expect(() =>
      store.importDefinitions([
        { id: 'imported', name: '迁移字典', entries: {} },
      ]),
    ).toThrow();
    expect(store.has('imported')).toBe(false);
  });
});
