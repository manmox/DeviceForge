import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ProjectFileCapabilities } from '../capabilities';
import { errorResult, successResult } from './result';

const FileEntrySchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'directory', 'symlink']),
  size: z.number().optional(),
});
const ListOutputSchema = z.object({
  root: z.string(),
  entries: z.array(FileEntrySchema),
  truncated: z.boolean(),
});
const SearchOutputSchema = z.object({
  matches: z.array(z.object({ path: z.string(), line: z.number(), preview: z.string() })),
  scannedFiles: z.number(),
  truncated: z.boolean(),
});
const ReadOutputSchema = z.object({
  path: z.string(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
  size: z.number(),
});

export function registerProjectTools(server: McpServer, capabilities: ProjectFileCapabilities): void {
  server.registerTool(
    'project_list_files',
    {
      description: '列出 DeviceForge 仓库根目录下的文件和目录。path 使用相对路径；结果最多返回 limit 条。',
      inputSchema: z.object({
        path: z.string().default('.'),
        recursive: z.boolean().default(false),
        limit: z.number().int().min(1).max(2000).default(200),
      }),
      outputSchema: ListOutputSchema,
    },
    async ({ path, recursive, limit }) => {
      try {
        const output = await capabilities.listFiles({
          directory: path,
          recursive,
          limit,
        });
        return successResult(output, `列出 ${output.entries.length} 项${output.truncated ? '，结果已截断' : ''}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'project_search_files',
    {
      description: '在仓库内 UTF-8 文本文件中按字面内容搜索。默认忽略大小写，最多扫描 2000 个文件。',
      inputSchema: z.object({
        query: z.string().min(1),
        directory: z.string().default('.'),
        caseSensitive: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      outputSchema: SearchOutputSchema,
    },
    async (input) => {
      try {
        const output = await capabilities.searchFiles(input);
        return successResult(output, `找到 ${output.matches.length} 处，扫描 ${output.scannedFiles} 个文件${output.truncated ? '，结果已截断' : ''}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'project_read_file',
    {
      description: '读取仓库根目录内的文件，范围包括 Git 忽略的本地数据，内容可能含明文凭据。UTF-8 文件返回文本，其他文件返回 Base64。',
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: ReadOutputSchema,
    },
    async ({ path }) => {
      try {
        const output = await capabilities.readFile(path);
        return successResult(
          output,
          `读取 ${output.path}（${output.size} 字节，${output.encoding}）\n${output.content}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
