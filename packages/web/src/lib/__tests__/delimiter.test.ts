import { describe, expect, it } from 'vitest';
import {
  delimiterTextBytes,
  delimiterTextToHex,
  escapeDelimiterText,
  formatHexBytes,
  hexToDelimiterText,
  parseDelimiterText,
  TEXT_DELIMITER_PRESETS,
} from '../delimiter';

describe('parseDelimiterText', () => {
  it('parses supported escape sequences', () => {
    expect(parseDelimiterText(String.raw`\r\n`)).toEqual({
      ok: true,
      text: '\r\n',
    });
    expect(parseDelimiterText(String.raw`\t\0\\`)).toEqual({
      ok: true,
      text: '\t\0\\',
    });
    expect(parseDelimiterText(String.raw`\x0D\x0a`)).toEqual({
      ok: true,
      text: '\r\n',
    });
    expect(parseDelimiterText(String.raw`\x7C`)).toEqual({
      ok: true,
      text: '|',
    });
  });

  it('consumes exactly two hex digits after \\x', () => {
    expect(parseDelimiterText(String.raw`\x0D0A`)).toEqual({
      ok: true,
      text: '\r0A',
    });
  });

  it('keeps literal text, spaces and Unicode', () => {
    expect(parseDelimiterText('|')).toEqual({ ok: true, text: '|' });
    expect(parseDelimiterText(' ')).toEqual({ ok: true, text: ' ' });
    expect(parseDelimiterText('帧😀')).toEqual({ ok: true, text: '帧😀' });
    expect(parseDelimiterText('')).toEqual({ ok: true, text: '' });
  });

  it('rejects incomplete and unknown escapes', () => {
    expect(parseDelimiterText('\\')).toMatchObject({ ok: false });
    expect(parseDelimiterText(String.raw`\q`)).toMatchObject({ ok: false });
    expect(parseDelimiterText(String.raw`\x`)).toMatchObject({ ok: false });
    expect(parseDelimiterText(String.raw`\xG1`)).toMatchObject({ ok: false });
    expect(parseDelimiterText(String.raw`\x0`)).toMatchObject({ ok: false });
  });

  it('round-trips through escapeDelimiterText', () => {
    const values = [
      '|',
      '\r\n',
      '\n',
      '\t',
      '\0',
      '\\',
      String.raw`\r`,
      '帧😀',
      '\x01',
      '\x7f',
      '\x85',
      'a b',
    ];
    for (const value of values) {
      expect(parseDelimiterText(escapeDelimiterText(value))).toEqual({
        ok: true,
        text: value,
      });
    }
  });
});

describe('escapeDelimiterText', () => {
  it('uses named escapes for common controls and hex for other controls', () => {
    expect(escapeDelimiterText('\r\n\t\0\\')).toBe(String.raw`\r\n\t\0\\`);
    expect(escapeDelimiterText('\x01')).toBe(String.raw`\x01`);
    expect(escapeDelimiterText('\x7f')).toBe(String.raw`\x7F`);
    expect(escapeDelimiterText('\x85')).toBe(String.raw`\x85`);
    expect(escapeDelimiterText('| 帧😀')).toBe('| 帧😀');
  });
});

describe('delimiterTextBytes', () => {
  it('encodes text as UTF-8', () => {
    expect(Array.from(delimiterTextBytes('|'))).toEqual([0x7c]);
    expect(Array.from(delimiterTextBytes('\r\n'))).toEqual([0x0d, 0x0a]);
    expect(Array.from(delimiterTextBytes('帧'))).toEqual([0xe5, 0xb8, 0xa7]);
    expect(Array.from(delimiterTextBytes(String.fromCharCode(0x80)))).toEqual([
      0xc2, 0x80,
    ]);
  });
});

describe('delimiterTextToHex', () => {
  it('converts UTF-8 bytes to uppercase hex', () => {
    expect(delimiterTextToHex('|')).toBe('7C');
    expect(delimiterTextToHex('\r\n')).toBe('0D0A');
    expect(delimiterTextToHex('帧')).toBe('E5B8A7');
    expect(delimiterTextToHex('0D0A')).toBe('30443041');
    expect(delimiterTextToHex(String.fromCharCode(0x80))).toBe('C280');
    expect(delimiterTextToHex('')).toBe('');
  });
});

describe('hexToDelimiterText', () => {
  it('strictly decodes valid UTF-8', () => {
    expect(hexToDelimiterText('7C')).toEqual({ ok: true, text: '|' });
    expect(hexToDelimiterText('0D 0A')).toEqual({ ok: true, text: '\r\n' });
    expect(hexToDelimiterText('e5b8a7')).toEqual({ ok: true, text: '帧' });
    expect(hexToDelimiterText('')).toEqual({ ok: true, text: '' });
  });

  it('rejects invalid hex and invalid UTF-8 separately', () => {
    expect(hexToDelimiterText('0')).toEqual({
      ok: false,
      reason: 'invalid-hex',
    });
    expect(hexToDelimiterText('ZZ')).toEqual({
      ok: false,
      reason: 'invalid-hex',
    });
    expect(hexToDelimiterText('FF')).toEqual({
      ok: false,
      reason: 'invalid-utf8',
    });
    expect(hexToDelimiterText('C3')).toEqual({
      ok: false,
      reason: 'invalid-utf8',
    });
  });

  it('preserves a leading UTF-8 BOM', () => {
    const decoded = hexToDelimiterText('EFBBBF');
    expect(decoded).toEqual({ ok: true, text: '﻿' });
    if (!decoded.ok) return;
    expect(delimiterTextToHex(decoded.text)).toBe('EFBBBF');
  });
});

describe('formatHexBytes', () => {
  it('formats bytes as spaced uppercase hex', () => {
    expect(formatHexBytes([0x0d, 0x0a])).toBe('0D 0A');
    expect(formatHexBytes(Uint8Array.from([0x7c]))).toBe('7C');
    expect(formatHexBytes([])).toBe('');
  });
});

describe('TEXT_DELIMITER_PRESETS', () => {
  it('contains the common delimiters', () => {
    expect(TEXT_DELIMITER_PRESETS.map((preset) => preset.label)).toEqual([
      'CRLF',
      'LF',
      'TAB',
      '|',
      '*',
      ',',
      ';',
    ]);
    expect(TEXT_DELIMITER_PRESETS.find((preset) => preset.label === 'CRLF')?.text).toBe(
      '\r\n',
    );
  });
});
