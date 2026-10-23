import type { CallToolResult } from '@modelcontextprotocol/server';

export function successResult<T extends object>(
  output: T,
  summary?: string,
): CallToolResult {
  const structuredContent = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
  return {
    content: [{
      type: 'text',
      text: summary ?? JSON.stringify(output),
    }],
    structuredContent,
  };
}

export function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function applicationErrorResult(result: {
  error: string;
  issues?: Array<{ path: string; message: string }>;
  message?: string;
}): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: result.error,
        ...(result.issues ? { issues: result.issues } : {}),
        ...(result.message ? { message: result.message } : {}),
      }),
    }],
    isError: true,
  };
}
