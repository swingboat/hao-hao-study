/**
 * F4.3 — 本地文件上传暂存（v0.1 MVP）。
 *
 * 严格按 PRD F3.1 应当落到对象存储（R2），但 v0.1 R2 凭据可能未配；
 * 且当前 OpenAI 适配器（packages/llm）只收字符串 prompt，文件实际上是
 * 在调用 LLM 前由 admin 这边读出来的，并不会让 LLM 自己去 fetch URL。
 * 因此本地 FS 暂存对 v0.1 完全够用：
 *
 *   - 路径：apps/admin/.run/uploads/<uuid>.<ext>
 *   - file_uri 字段写 file://<abs path>
 *   - .run/ 已在 .gitignore 中
 *
 * 后续切 R2：把 saveUpload / readUpload 内部换成 R2 SDK 即可，
 * 调用方接口（ArrayBuffer / 字节）不变。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UPLOADS_DIR = path.resolve(process.cwd(), '.run/uploads');

export interface SavedUpload {
  fileUri: string; // file://<abs path>
  absPath: string;
  sizeBytes: number;
}

/**
 * 将上传文件落本地。返回的 fileUri 写入 content_upload.file_uri；
 * absPath 仅供 server action 当前调用链立刻读取（不要泄露到客户端）。
 */
export async function saveUpload(
  file: File,
  ext: string = path.extname(file.name) || '.bin',
): Promise<SavedUpload> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const id = randomUUID();
  const absPath = path.join(UPLOADS_DIR, `${id}${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(absPath, buf);
  return {
    fileUri: `file://${absPath}`,
    absPath,
    sizeBytes: buf.byteLength,
  };
}

/** 从 file:// URI 读字节（仅本地路径，禁止跟随其他 scheme）。 */
export async function readUpload(fileUri: string): Promise<Buffer> {
  if (!fileUri.startsWith('file://')) {
    throw new Error(`unsupported file_uri scheme: ${fileUri}`);
  }
  const abs = fileUri.slice('file://'.length);
  // 防越权：必须在 UPLOADS_DIR 之下
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error(`file_uri outside uploads dir: ${fileUri}`);
  }
  return readFile(resolved);
}
