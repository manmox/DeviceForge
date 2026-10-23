import type {
  DeviceConfig,
  DeviceStatus,
  RecordedTrafficEvent,
  RecordingSession,
  GlobalDictionaryDefinition,
} from '@deviceforge/core';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ApplicationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      statusCode: number;
      error: string;
      issues?: ValidationIssue[];
      message?: string;
    };

export interface DevicePreset {
  file: string;
  id: string;
  name: string;
  description: string;
  yaml: string;
  config: DeviceConfig;
}

export interface PresetApplication {
  list(): DevicePreset[];
}

export interface RecordingApplication {
  list(deviceId: string): RecordingSession[];
  start(deviceId: string): RecordingSession;
  stop(deviceId: string, recordingId: string): RecordingSession | undefined;
  readEvents(
    deviceId: string,
    recordingId: string,
    offset: number,
    limit: number,
  ): Promise<{ events: RecordedTrafficEvent[]; total: number } | undefined>;
  delete(deviceId: string, recordingId: string): boolean;
}

export interface DeviceConfigurationApplication {
  validateDocument(raw: unknown): ApplicationResult<DeviceConfig>;
  validateYaml(yaml: string): ApplicationResult<DeviceConfig>;
  createFromYaml(yaml: string): ApplicationResult<DeviceSummary>;
  updateFromYaml(id: string, yaml: string): ApplicationResult<DeviceSummary>;
  create(raw: unknown): ApplicationResult<DeviceSummary>;
  update(id: string, raw: unknown): ApplicationResult<DeviceSummary>;
}

export interface ProjectFileEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
}

export interface ProjectFileList {
  root: string;
  entries: ProjectFileEntry[];
  truncated: boolean;
}

export interface ProjectFileMatch {
  path: string;
  line: number;
  preview: string;
}

export interface ProjectFileSearch {
  matches: ProjectFileMatch[];
  scannedFiles: number;
  truncated: boolean;
}

export interface ProjectFileContent {
  path: string;
  encoding: 'utf-8' | 'base64';
  content: string;
  size: number;
}

export interface ProjectFileApplication {
  listFiles(options?: {
    directory?: string;
    recursive?: boolean;
    limit?: number;
  }): Promise<ProjectFileList>;
  searchFiles(options: {
    query: string;
    directory?: string;
    caseSensitive?: boolean;
    limit?: number;
  }): Promise<ProjectFileSearch>;
  readFile(relativePath: string): Promise<ProjectFileContent>;
}

export interface DeviceSummary {
  config: DeviceConfig;
  status: DeviceStatus;
}

export interface DeviceConfigurationRuntime {
  get(id: string): DeviceSummary | undefined;
  hasStoredId(id: string): boolean;
  hasInvalidRecord(id: string): boolean;
  find(id: string): { isActive: boolean } | undefined;
  create(config: DeviceConfig): DeviceSummary;
  update(id: string, config: DeviceConfig): DeviceSummary;
}

export interface DictionaryRepository {
  has(id: string): boolean;
  list(): GlobalDictionaryDefinition[];
  importDefinitions(
    definitions: Iterable<GlobalDictionaryDefinition>,
  ): GlobalDictionaryDefinition[];
}
