/**
 * ObjectStore 接口契约 — 详见 docs/File_Storage_v0.1.md §3
 *
 * 实现必须：
 *   - put 幂等（同 key 覆盖、不抛 already-exists）
 *   - 不存在的 key：get 抛 NotFoundError，exists 返回 false，delete 静默成功
 *   - sha256 校验失败抛 ChecksumMismatchError（caller 用 expectedSha256 兜底）
 */

export interface PutOptions {
  /** 写入对象的 Content-Type；s3 模式落到对象元数据，fs 模式忽略 */
  contentType?: string;
  /**
   * 写前校验：实现先计算 body 的 sha256，与传入值不一致则抛 ChecksumMismatchError，
   * 不写。caller 拿到的 PutResult.sha256 总是真实算出的值。
   */
  expectedSha256?: string;
}

export interface PutResult {
  /** 实际写入的 key（与入参一致） */
  key: string;
  /** body.length */
  size: number;
  /** 写入前实际计算的 sha256（小写 hex 64 字符） */
  sha256: string;
}

export interface ListResult {
  keys: string[];
  /** 分页 cursor；undefined 表示已到末尾 */
  nextCursor?: string;
}

export interface ObjectStore {
  /** 写对象；幂等（覆盖） */
  put(key: string, body: Buffer, opts?: PutOptions): Promise<PutResult>;

  /** 读对象；不存在抛 NotFoundError */
  get(key: string): Promise<Buffer>;

  /** 探在不在；不抛 */
  exists(key: string): Promise<boolean>;

  /** 删；不存在不抛 */
  delete(key: string): Promise<void>;

  /** 按前缀列；分页 cursor 由实现自定义，caller 透传即可 */
  list(prefix: string, opts?: { cursor?: string; limit?: number }): Promise<ListResult>;

  /**
   * 给前端 / 学生端的直接可 GET 的 URL，TTL 内有效。
   * - fs 实现：返回 ${publicBaseUrl}/storage/${key} 形式的本地路由（caller 在 Next.js 加 /storage/[...key] handler 映射）
   * - s3 实现：返回 SigV4 presigned GET URL
   */
  presignedGetUrl(key: string, ttlSec?: number): Promise<string>;
}

export class NotFoundError extends Error {
  readonly code = 'STORAGE_NOT_FOUND';
  constructor(public readonly key: string) {
    super(`storage key not found: ${key}`);
    this.name = 'NotFoundError';
  }
}

export class ChecksumMismatchError extends Error {
  readonly code = 'STORAGE_CHECKSUM_MISMATCH';
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`sha256 mismatch: expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}
