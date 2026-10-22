import type { DeviceConfig } from '@deviceforge/core';
import { describe, expect, it } from 'vitest';
import {
  firstIssueSection,
  issueItemIndex,
  nextSectionId,
  sectionForIssuePath,
  sectionHint,
} from '../config-sections';

const config: DeviceConfig = {
  id: 'sensor',
  name: '传感器',
  deviceInfo: { serialNumber: 'SN-0001', model: 'TH-100' },
  transport: { type: 'tcp-server', host: '127.0.0.1', port: 19001 },
  framing: {
    type: 'length-prefix',
    lengthField: { offset: 2, size: 2, endian: 'be', adjust: 0 },
    maxFrameLength: 4096,
  },
  codec: {
    type: 'fields',
    fields: [
      { name: 'magic', type: 'bytes', length: 2, const: 'AA55' },
      { name: 'cmd', type: 'u8' },
    ],
    checksum: { algo: 'crc16-modbus', verify: true },
  },
  state: { temp: 25.5, humidity: 60 },
  rules: [],
  autoStart: false,
};

describe('sectionForIssuePath', () => {
  it('matches exact and nested issue paths', () => {
    expect(sectionForIssuePath('deviceInfo')).toBe('deviceInfo');
    expect(sectionForIssuePath('deviceInfo.serialNumber')).toBe('deviceInfo');
    expect(sectionForIssuePath('transport.port')).toBe('transport');
    expect(sectionForIssuePath('transport')).toBe('transport');
    expect(sectionForIssuePath('codec.fields.0.name')).toBe('codec');
    expect(sectionForIssuePath('rules.0.match')).toBe('rules');
    expect(sectionForIssuePath('autoStart')).toBe('basic');
    expect(sectionForIssuePath('')).toBe('basic');
  });

  it('falls back to basic for unknown paths', () => {
    expect(sectionForIssuePath('unknown.path')).toBe('basic');
  });
});

describe('firstIssueSection', () => {
  it('returns null when there are no issues', () => {
    expect(firstIssueSection([])).toBeNull();
  });

  it('returns the section of the first issue', () => {
    expect(
      firstIssueSection([
        { path: 'codec.fields.0.length', message: 'bad' },
        { path: 'transport.port', message: 'bad' },
      ]),
    ).toBe('codec');
    expect(
      firstIssueSection([{ path: 'deviceInfo.serialNumber', message: 'bad' }]),
    ).toBe('deviceInfo');
  });
});

describe('nextSectionId', () => {
  it('wraps in both directions and supports first/last', () => {
    expect(nextSectionId('basic', 'previous')).toBe('rules');
    expect(nextSectionId('rules', 'next')).toBe('basic');
    expect(nextSectionId('codec', 'next')).toBe('state');
    expect(nextSectionId('codec', 'first')).toBe('basic');
    expect(nextSectionId('codec', 'last')).toBe('rules');
    expect(nextSectionId('basic', 'next')).toBe('deviceInfo');
    expect(nextSectionId('deviceInfo', 'next')).toBe('transport');
    expect(nextSectionId('transport', 'previous')).toBe('deviceInfo');
  });
});

describe('issueItemIndex', () => {
  it('extracts an index only from the requested list', () => {
    expect(issueItemIndex('codec.fields.2.length', 'codec.fields')).toBe(2);
    expect(issueItemIndex('rules.0.send.1.fields', 'rules')).toBe(0);
    expect(issueItemIndex('rules.0.send', 'codec.fields')).toBeNull();
    expect(issueItemIndex('codec.fields.length', 'codec.fields')).toBeNull();
  });
});

describe('sectionHint', () => {
  it('summarizes the current config per section', () => {
    expect(sectionHint(config, 'deviceInfo')).toBe('S/N SN-0001');
    expect(sectionHint(config, 'transport')).toBe('127.0.0.1:19001');
    expect(sectionHint(config, 'framing')).toBe('长度字段');
    expect(sectionHint(config, 'codec')).toBe('fields · 2 字段');
    expect(sectionHint(config, 'state')).toBe('2 个变量');
    expect(sectionHint(config, 'rules')).toBe('0 条规则');
  });

  it('summarizes text and hex delimiters readably', () => {
    const textFraming = {
      type: 'delimiter',
      delimiterFormat: 'text',
      delimiter: '|',
      includeDelimiter: false,
    } as const;
    expect(
      sectionHint({ ...config, framing: textFraming }, 'framing'),
    ).toBe('分隔符 「|」');

    const crlfFraming = {
      ...textFraming,
      delimiter: '\r\n',
    } as const;
    expect(
      sectionHint({ ...config, framing: crlfFraming }, 'framing'),
    ).toBe('分隔符 「\\r\\n」');

    const emptyFraming = {
      ...textFraming,
      delimiter: '',
    } as const;
    expect(
      sectionHint({ ...config, framing: emptyFraming }, 'framing'),
    ).toBe('分隔符 「(空)」');

    const hexFraming = {
      type: 'delimiter',
      delimiterFormat: 'hex',
      delimiter: '0d0a',
      includeDelimiter: false,
    } as const;
    expect(
      sectionHint({ ...config, framing: hexFraming }, 'framing'),
    ).toBe('分隔符 0D0A');
  });

  it('shows an empty hint when deviceInfo is absent', () => {
    expect(sectionHint({ ...config, deviceInfo: undefined }, 'deviceInfo')).toBe(
      '未填写',
    );
  });
});
