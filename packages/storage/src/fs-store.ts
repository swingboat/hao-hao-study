/**
 * FileSystemStore — 本地文件系统实现（v0.1 默认）
 *
 * 把 key 视作 root 下的相对路径，写时按需 mkdir -p。
 * presignedGetUrl 返回 ${publicBaseUrl}/storage/${key}，caller 在 Next.js 加路由把
 * 这个前缀映射回本地文件读取（dev 用；线上切 S3 自动失效）。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ChecksumMismatchError,
  type ListResult,
  NotFoundError,
  type ObjectStore,
  type PutOptions,
  type PutResult,
} from './types';

export interface FileSystemStoreOptions {
  /** Storage 根目录（绝对路径）。例如 /Users/huyin/www/hao-hao-study */
  root: string;
  /** presignedGetUrl 使用的对外 base，例如 http://localhost:3001（admin dev） */
  publicBaseUrl?: string;
}

export class FileSystemStore implements ObjectStore {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(opts: FileSystemStoreOptions) {
    if (!opts.root || !path.isAbsolute(opts.root)) {
      throw new Error(`FileSystemStore.root must be an absolute path, got: ${opts.root}`);
    }
    this.root = opts.root;
    this.publicBaseUrl = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
  }

  async put(key: string, body: Buffer, opts?: PutOptions): Promise<PutResult> {
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (opts?.expectedSha256 && opts.expectedSha256 !== sha256) {
      throw new ChecksumMismatchError(opts.expectedSha256, sha256);
    }
    const abs = this.toAbs(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
    return { key, size: body.length, sha256 };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.toAbs(key));
    } catch (e) {
      if (isENOENT(e)) throw new NotFoundError(key);
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const s = await stat(this.toAbs(key));
      return s.isFile();
    } catch (e) {
      if (isENOENT(e)) return false;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.toAbs(key), { force: true });
    } catch (e) {
      if (isENOENT(e)) return;
      throw e;
    }
  }

  /**
   * 简化实现：仅做递归 list，按字典序返回 prefix 命中的所有 key（不分页）。
   * cursor/limit 透传但暂不切片（v0.1 数据量小够用；切 S3 时换成真分页）。
   */
  async list(prefix: string, _opts?: { cursor?: string; limit?: number }): Promise<ListResult> {
    const baseAbs = this.toAbs(prefix);
    const baseExists = await this.statSafe(baseAbs);

    // prefix 可能是"目录前缀"也可能是"文件前缀"。先按目录走，找不到再按"父目录 + filter"走
    let dirAbs: string;
    let filter: (name: string) => boolean;
    if (baseExists?.isDirectory()) {
      dirAbs = baseAbs;
      filter = () => true;
    } else {
      dirAbs = path.dirname(baseAbs);
      const basename = path.basename(baseAbs);
      filter = (name) => name.startsWith(basename);
    }
    const keys: string[] = [];
    await this.walk(dirAbs, filter, keys);
    keys.sort();
    return { keys };
  }

  async presignedGetUrl(key: string, _ttlSec?: number): Promise<string> {
    // fs 模式：返回 ${publicBaseUrl}/storage/${key}，由 Next.js 路由处理
    // 注意：v0.1 没鉴权 / 没 TTL，仅 dev 用；ttlSec 暂时忽略
    const safeKey = key.split('/').map(encodeURIComponent).join('/');
    return this.publicBaseUrl ? `${this.publicBaseUrl}/storage/${safeKey}` : `/storage/${safeKey}`;
  }

  // ─────────────────────────────────────────────────────────────────

  private toAbs(key: string): string {
    if (key.startsWith('/') || key.includes('..')) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    return path.join(this.root, key);
  }

  private async statSafe(abs: string) {
    try {
      return await stat(abs);
    } catch (e) {
      if (isENOENT(e)) return null;
      throw e;
    }
  }

  private async walk(dirAbs: string, filter: (name: string) => boolean, out: string[]) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (e) {
      if (isENOENT(e)) return;
      throw e;
    }
    for (const ent of entries) {
      const abs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        await this.walk(abs, () => true, out);
      } else if (ent.isFile() && filter(ent.name)) {
        out.push(path.relative(this.root, abs).split(path.sep).join('/'));
      }
    }
  }
}

function isENOENT(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT';
}
