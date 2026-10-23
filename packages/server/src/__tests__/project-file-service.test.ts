import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectFileApplicationService } from '../application/project-file-service';

const directories: string[] = [];

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ProjectFileApplicationService', () => {
  it('可列出、搜索和读取仓库内的本地 data 文件', async () => {
    const root = tempDirectory('deviceforge-project-');
    mkdirSync(path.join(root, 'data'));
    writeFileSync(path.join(root, 'data', 'devices.json'), '{"password":"local-secret"}\n');
    writeFileSync(path.join(root, 'README.md'), 'DeviceForge project\n');
    const service = new ProjectFileApplicationService(root);

    const listing = await service.listFiles({ directory: 'data' });
    const search = await service.searchFiles({ query: 'local-secret', directory: 'data' });
    const contents = await service.readFile('data/devices.json');

    expect(listing.entries).toContainEqual(expect.objectContaining({
      path: 'data/devices.json',
      type: 'file',
    }));
    expect(search.matches).toMatchObject([{ path: 'data/devices.json', line: 1 }]);
    expect(contents.content).toContain('local-secret');
  });

  it('拒绝越界路径及指向仓库外的符号链接', async () => {
    const root = tempDirectory('deviceforge-root-');
    const outside = tempDirectory('deviceforge-outside-');
    writeFileSync(path.join(outside, 'secret.txt'), 'outside-secret');
    symlinkSync(outside, path.join(root, 'external'));
    const service = new ProjectFileApplicationService(root);

    await expect(service.readFile('../secret.txt')).rejects.toThrow('超出项目根目录');
    await expect(service.readFile('external/secret.txt')).rejects.toThrow('符号链接指向项目根目录之外');
    await expect(service.listFiles({ directory: 'external' })).rejects.toThrow('符号链接指向项目根目录之外');
    await expect(service.searchFiles({ query: 'outside-secret', directory: 'external' }))
      .rejects.toThrow('符号链接指向项目根目录之外');
  });
});
