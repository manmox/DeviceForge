import { hexToBytes } from './format';

export type ParsedDelimiterText =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type DecodedHexDelimiter =
  | { ok: true; text: string }
  | { ok: false; reason: 'invalid-hex' | 'invalid-utf8' };

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

export function parseDelimiterText(input: string): ParsedDelimiterText {
  let result = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character !== '\\') {
      result += character;
      continue;
    }

    if (index + 1 >= input.length) {
      return { ok: false, error: '转义不完整：末尾的 \\ 后缺少字符' };
    }

    const escaped = input[index + 1]!;
    switch (escaped) {
      case 'r':
        result += '\r';
        index += 1;
        break;
      case 'n':
        result += '\n';
        index += 1;
        break;
      case 't':
        result += '\t';
        index += 1;
        break;
      case '0':
        result += '\0';
        index += 1;
        break;
      case '\\':
        result += '\\';
        index += 1;
        break;
      case 'x': {
        // \xNN 表示 Unicode 码位，不是原始字节：\x80 会变成 U+0080，
        // 再按 UTF-8 编码为 C2 80。escapeDelimiterText 是其逆操作。
        const hex = input.slice(index + 2, index + 4);
        if (hex.length < 2) {
          return { ok: false, error: '\\x 后需要两位十六进制字符' };
        }
        if (!HEX_PAIR.test(hex)) {
          return {
            ok: false,
            error: `不支持的转义 \\x${hex}；\\x 后需要两位十六进制字符`,
          };
        }
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 3;
        break;
      }
      default:
        return {
          ok: false,
          error: `不支持的转义 \\${escaped}；支持 \\r、\\n、\\t、\\0、\\\\、\\xNN`,
        };
    }
  }
  return { ok: true, text: result };
}

/** 转义控制字符，保证文本输入框单行显示；满足 parse(escape(x)) === x。 */
export function escapeDelimiterText(text: string): string {
  let result = '';
  for (const character of text) {
    switch (character) {
      case '\r':
        result += '\\r';
        break;
      case '\n':
        result += '\\n';
        break;
      case '\t':
        result += '\\t';
        break;
      case '\0':
        result += '\\0';
        break;
      case '\\':
        result += '\\\\';
        break;
      default: {
        const code = character.codePointAt(0) ?? 0;
        if (
          code <= 0x1f ||
          code === 0x7f ||
          (code >= 0x80 && code <= 0x9f)
        ) {
          result += `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`;
        } else {
          result += character;
        }
      }
    }
  }
  return result;
}

export function delimiterTextBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function formatHexBytes(bytes: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    parts.push((bytes[index] ?? 0).toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(' ');
}

export function delimiterTextToHex(text: string): string {
  return formatHexBytes(delimiterTextBytes(text)).replace(/\s+/g, '');
}

/**
 * 无损地把 HEX 解码为文本。fatal 会拒绝非法 UTF-8，而不是替换成 U+FFFD；
 * ignoreBOM 保留开头 BOM，保证重新编码后字节一致。reason 用于区分 UI 的
 * “清空”与“阻止切换”行为。
 */
export function hexToDelimiterText(hex: string): DecodedHexDelimiter {
  const normalized = hex.replace(/\s+/g, '');
  if (normalized.length === 0) return { ok: true, text: '' };
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
    return { ok: false, reason: 'invalid-hex' };
  }

  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(Uint8Array.from(hexToBytes(normalized)));
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'invalid-utf8' };
  }
}

export const TEXT_DELIMITER_PRESETS = [
  { label: 'CRLF', text: '\r\n' },
  { label: 'LF', text: '\n' },
  { label: 'TAB', text: '\t' },
  { label: '|', text: '|' },
  { label: '*', text: '*' },
  { label: ',', text: ',' },
  { label: ';', text: ';' },
] as const;
