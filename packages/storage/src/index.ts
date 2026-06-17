/**
 * @hao/storage — 文件存储抽象层（docs/File_Storage_v0.1.md）
 *
 * 业务永远只用 ObjectStore 接口 + StoragePaths helper，看不到底层是 fs / s3 / r2。
 * v0.1 默认 FileSystemStore（仓库外 STORAGE_FS_ROOT），上线切 S3 只改 env。
 *
 * 约定：
 *   - key 永远是相对路径（不以 / 开头），例如 "uploads/sha256/ab/abcd....pdf"
 *   - 写入 fs 时按 key 创建多级目录；S3 不需要
 *   - presignedGetUrl(key) 在 fs 模式返回 ${PUBLIC_BASE_URL}/storage/${key}，
 *     在 s3 模式返回真签名 URL；业务方代码不变
 */
export {
  type ObjectStore,
  type PutOptions,
  type PutResult,
  type ListResult,
  NotFoundError,
  ChecksumMismatchError,
} from './types';
export { StoragePaths, sha256OfBuffer, extOf } from './paths';
export { FileSystemStore } from './fs-store';
export {
  FIGURE_CROP_PROCESSOR,
  FIGURE_CROP_VERSION,
  type FigureCropAssetRecord,
  type FigureCropMetadata,
  type QuestionFigure,
  buildQuestionFigureAssetKey,
  buildQuestionFigureCropRecord,
  createQuestionFigureCropAssets,
  cropPngByPercentBbox,
  renderPdfPageToPng,
} from './figure-crop';
export { createStore } from './factory';

export const STORAGE_VERSION = '0.1.0';
