import type { DeviceConfig } from '@deviceforge/core';
import { deviceInfoHint } from './device-info';

export type ConfigSectionId =
  | 'basic'
  | 'deviceInfo'
  | 'transport'
  | 'framing'
  | 'codec'
  | 'state'
  | 'rules';

export type ConfigSection = {
  id: ConfigSectionId;
  label: string;
  description: string;
  paths: string[];
};

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: 'basic',
    label: '基本信息',
    description: '设备标识、显示名称和启动行为。',
    paths: ['', 'id', 'name', 'description', 'autoStart'],
  },
  {
    id: 'deviceInfo',
    label: '设备信息',
    description: '厂商、型号、序列号和版本等硬件标识，仅用于展示和记录。',
    paths: ['deviceInfo'],
  },
  {
    id: 'transport',
    label: '传输',
    description: '设备监听的地址和端口。',
    paths: ['transport'],
  },
  {
    id: 'framing',
    label: '分帧',
    description: '只影响入站字节流的分帧方式。',
    paths: ['framing'],
  },
  {
    id: 'codec',
    label: '编解码',
    description: '字段顺序、常量、长度和校验。',
    paths: ['codec'],
  },
  {
    id: 'state',
    label: '初始状态',
    description: '设备启动时的状态变量。',
    paths: ['state'],
  },
  {
    id: 'rules',
    label: '规则',
    description: '触发、匹配、状态更新和发送。',
    paths: ['rules'],
  },
];

export const CONFIG_SECTION_IDS: ConfigSectionId[] = CONFIG_SECTIONS.map(
  (section) => section.id,
);

export function configTabId(idBase: string, id: ConfigSectionId): string {
  return `${idBase}-tab-${id}`;
}

export function configPanelId(idBase: string, id: ConfigSectionId): string {
  return `${idBase}-panel-${id}`;
}

function pathMatches(issuePath: string, prefix: string): boolean {
  if (issuePath === prefix) return true;
  return prefix !== '' && issuePath.startsWith(`${prefix}.`);
}

export function sectionForIssuePath(path: string): ConfigSectionId {
  for (const section of CONFIG_SECTIONS) {
    if (section.paths.some((prefix) => pathMatches(path, prefix))) {
      return section.id;
    }
  }
  return 'basic';
}

export function firstIssueSection(
  issues: readonly { path: string; message?: string }[],
): ConfigSectionId | null {
  const first = issues[0];
  return first ? sectionForIssuePath(first.path) : null;
}

export function nextSectionId(
  current: ConfigSectionId,
  direction: 'next' | 'previous' | 'first' | 'last',
): ConfigSectionId {
  if (direction === 'first') return CONFIG_SECTION_IDS[0]!;
  if (direction === 'last') return CONFIG_SECTION_IDS[CONFIG_SECTION_IDS.length - 1]!;
  const index = CONFIG_SECTION_IDS.indexOf(current);
  const offset = direction === 'next' ? 1 : -1;
  const nextIndex =
    (index + offset + CONFIG_SECTION_IDS.length) % CONFIG_SECTION_IDS.length;
  return CONFIG_SECTION_IDS[nextIndex]!;
}

export function sectionHint(config: DeviceConfig, id: ConfigSectionId): string {
  switch (id) {
    case 'basic':
      return config.id;
    case 'deviceInfo':
      return deviceInfoHint(config.deviceInfo);
    case 'transport':
      return `${config.transport.host}:${config.transport.port}`;
    case 'framing':
      switch (config.framing.type) {
        case 'raw':
          return '原始字节';
        case 'delimiter':
          return `分隔符 ${config.framing.delimiter.toUpperCase()}`;
        case 'length-prefix':
          return '长度字段';
        case 'fixed':
          return `固定 ${config.framing.length} 字节`;
      }
      return '';
    case 'codec':
      if (config.codec.type === 'raw') return `raw · ${config.codec.display}`;
      return `fields · ${config.codec.fields.length} 字段`;
    case 'state':
      return `${Object.keys(config.state).length} 个变量`;
    case 'rules':
      return `${config.rules.length} 条规则`;
  }
}

/** Extracts the item index from issue paths such as `rules.2.match`. */
export function issueItemIndex(path: string, prefix: string): number | null {
  if (!path.startsWith(`${prefix}.`)) return null;
  const segment = path.slice(prefix.length + 1).split('.')[0];
  if (!segment || !/^\d+$/.test(segment)) return null;
  return Number(segment);
}
