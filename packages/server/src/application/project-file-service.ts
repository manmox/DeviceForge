import { realpathSync } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectFileApplication,
  ProjectFileContent,
  ProjectFileEntry,
  ProjectFileList,
  ProjectFileMatch,
  ProjectFileSearch,
} from './contracts';

export type {
  ProjectFileContent,
  ProjectFileEntry,
  ProjectFileList,
  ProjectFileMatch,
  ProjectFileSearch,
} from './contracts';

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ENTRIES = 2_000;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_MATCHES = 500;

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function decodeUtf8(buffer: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

/** Read-only access to files contained by one configured project root. */
export class ProjectFileApplicationService implements ProjectFileApplication {
  private readonly realRoot: string;

  constructor(root: string) {
    this.realRoot = realpathSync(root);
  }

  async listFiles(options: {
    directory?: string;
    recursive?: boolean;
    limit?: number;
  } = {}): Promise<ProjectFileList> {
    const directory = options.directory ?? '.';
    const limit = boundedLimit(options.limit, 200, MAX_LIST_ENTRIES);
    const resolvedDirectory = await this.resolveInside(directory);
    const directoryStat = await stat(resolvedDirectory);
    if (!directoryStat.isDirectory()) throw new Error('指定路径不是目录');

    const entries: ProjectFileEntry[] = [];
    const pending = [{ absolute: resolvedDirectory, relative: this.relativePath(resolvedDirectory) }];
    const visited = new Set<string>();
    let truncated = false;

    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;
      const currentRealPath = await realpath(current.absolute);
      if (!isWithinRoot(this.realRoot, currentRealPath) || visited.has(currentRealPath)) continue;
      visited.add(currentRealPath);

      const children = await readdir(current.absolute, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (!child) continue;
        const absolute = path.join(current.absolute, child.name);
        const relative = path.posix.join(current.relative, child.name);
        if (child.isSymbolicLink()) {
          entries.push({ path: relative, type: 'symlink' });
        } else if (child.isDirectory()) {
          entries.push({ path: relative, type: 'directory' });
          if (options.recursive) pending.push({ absolute, relative });
        } else if (child.isFile()) {
          const details = await lstat(absolute);
          entries.push({ path: relative, type: 'file', size: details.size });
        }

        if (entries.length >= limit) {
          truncated = index < children.length - 1 || pending.length > 0;
          break;
        }
      }
      if (entries.length >= limit) break;
    }

    return {
      root: this.realRoot,
      entries,
      truncated,
    };
  }

  async searchFiles(options: {
    query: string;
    directory?: string;
    caseSensitive?: boolean;
    limit?: number;
  }): Promise<ProjectFileSearch> {
    if (!options.query) throw new Error('搜索关键词不能为空');
    const directory = options.directory ?? '.';
    const matchLimit = boundedLimit(options.limit, 100, MAX_SEARCH_MATCHES);
    const resolvedDirectory = await this.resolveInside(directory);
    const directoryStat = await stat(resolvedDirectory);
    if (!directoryStat.isDirectory()) throw new Error('指定路径不是目录');

    const matches: ProjectFileMatch[] = [];
    const pending = [{ absolute: resolvedDirectory, relative: this.relativePath(resolvedDirectory) }];
    const visited = new Set<string>();
    const needle = options.caseSensitive ? options.query : options.query.toLocaleLowerCase();
    let scannedFiles = 0;
    let truncated = false;

    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;
      const currentRealPath = await realpath(current.absolute);
      if (!isWithinRoot(this.realRoot, currentRealPath) || visited.has(currentRealPath)) continue;
      visited.add(currentRealPath);

      const children = await readdir(current.absolute, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (child.isSymbolicLink()) continue;
        const absolute = path.join(current.absolute, child.name);
        const relative = path.posix.join(current.relative, child.name);
        if (child.isDirectory()) {
          pending.push({ absolute, relative });
          continue;
        }
        if (!child.isFile()) continue;

        scannedFiles += 1;
        if (scannedFiles > MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }

        const fileStat = await stat(absolute);
        if (fileStat.size > MAX_READ_BYTES) continue;
        const contents = await this.readBytes(absolute);
        const text = decodeUtf8(contents);
        if (text === undefined) continue;

        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          const candidate = options.caseSensitive ? line : line.toLocaleLowerCase();
          if (!candidate.includes(needle)) continue;
          matches.push({
            path: relative,
            line: index + 1,
            preview: line.slice(0, 240),
          });
          if (matches.length >= matchLimit) {
            truncated = true;
            break;
          }
        }
        if (matches.length >= matchLimit) break;
      }
      if (truncated || matches.length >= matchLimit) break;
    }

    return { matches, scannedFiles: Math.min(scannedFiles, MAX_SEARCH_FILES), truncated };
  }

  async readFile(relativePath: string): Promise<ProjectFileContent> {
    const absolute = await this.resolveInside(relativePath);
    const details = await stat(absolute);
    if (!details.isFile()) throw new Error('指定路径不是文件');
    if (details.size > MAX_READ_BYTES) {
      throw new Error(`文件超过 ${MAX_READ_BYTES} 字节的读取上限`);
    }

    const bytes = await this.readBytes(absolute);
    const text = decodeUtf8(bytes);
    return {
      path: this.relativePath(absolute),
      encoding: text === undefined ? 'base64' : 'utf-8',
      content: text ?? bytes.toString('base64'),
      size: bytes.byteLength,
    };
  }

  private async resolveInside(relativePath: string): Promise<string> {
    if (!relativePath || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
      throw new Error('路径必须是项目根目录下的相对路径');
    }

    const candidate = path.resolve(this.realRoot, relativePath);
    if (!isWithinRoot(this.realRoot, candidate)) {
      throw new Error('路径超出项目根目录');
    }

    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      throw new Error(`项目路径不存在或不可读取: ${relativePath}`, { cause: error });
    }
    if (!isWithinRoot(this.realRoot, resolved)) {
      throw new Error('符号链接指向项目根目录之外');
    }
    return resolved;
  }

  private relativePath(absolute: string): string {
    const relative = path.relative(this.realRoot, absolute);
    return relative ? relative.split(path.sep).join(path.posix.sep) : '.';
  }

  private async readBytes(filePath: string): Promise<Buffer> {
    const file = await open(filePath, 'r');
    try {
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
}
