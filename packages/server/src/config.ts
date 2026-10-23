import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serverRoot, '../..');
const dataDir = process.env.DEVICEFORGE_DATA_DIR ?? path.join(repoRoot, 'data');

export const paths = {
  repoRoot,
  dataDir,
  devicesFile: path.join(dataDir, 'devices.json'),
  dictionariesFile: path.join(dataDir, 'dictionaries.json'),
  builtinDictionariesDir: path.join(repoRoot, 'dictionaries'),
  presetsDir: path.join(repoRoot, 'presets'),
  webDist: path.join(repoRoot, 'packages/web/dist'),
};

// 控制面没有认证/TLS，默认只绑定回环地址就是安全边界；绑定 0.0.0.0
// 会把设备控制暴露到网络。
export const control = {
  host: process.env.DEVICEFORGE_HOST ?? '127.0.0.1',
  port: Number(process.env.DEVICEFORGE_PORT ?? 7321),
};
