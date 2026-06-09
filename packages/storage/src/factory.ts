/**
 * createStore — 根据 env STORAGE_DRIVER 选实例
 *
 * STORAGE_DRIVER=fs (默认)
 *   STORAGE_FS_ROOT       必填，绝对路径
 *   STORAGE_PUBLIC_BASE_URL  可选，presignedGetUrl 使用
 *
 * STORAGE_DRIVER=s3 (v0.2+)
 *   STORAGE_S3_BUCKET / STORAGE_S3_REGION / STORAGE_S3_ENDPOINT /
 *   STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY
 */
import { FileSystemStore } from './fs-store';
import type { ObjectStore } from './types';

export function createStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const driver = (env.STORAGE_DRIVER ?? 'fs').toLowerCase();
  if (driver === 'fs') {
    const root = env.STORAGE_FS_ROOT;
    if (!root) throw new Error('STORAGE_FS_ROOT is required when STORAGE_DRIVER=fs');
    return new FileSystemStore({
      root,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    });
  }
  if (driver === 's3') {
    // v0.2+：上线接 S3 / R2 / MinIO 时实现并 import S3Store
    throw new Error('STORAGE_DRIVER=s3 not implemented in v0.1; use fs');
  }
  throw new Error(`unknown STORAGE_DRIVER: ${driver}`);
}
