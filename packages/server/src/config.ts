import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serverRoot, '../..');
const dataDir = process.env.DEVICEFORGE_DATA_DIR ?? path.join(repoRoot, 'data');

export const paths = {
  repoRoot,
  dataDir,
  devicesFile: path.join(dataDir, 'devices.json'),
  presetsDir: path.join(repoRoot, 'presets'),
  webDist: path.join(repoRoot, 'packages/web/dist'),
};

export const control = {
  host: process.env.DEVICEFORGE_HOST ?? '127.0.0.1',
  port: Number(process.env.DEVICEFORGE_PORT ?? 7321),
};
