/**
 * analyzeImagesToStorage — 图片 batch → 抽题 + figure 裁切落 storage 的中间层
 *
 * 在 analyzeImages（纯抽题）与 cropFiguresToStorage（纯裁切）之上再封一层，
 * 把"调 LLM → 拿 bbox → sharp 裁切 → 落 storage → 汇总 derived_asset"这段
 * 公共流程抽出来。
 *
 * 两条入口都复用本函数：
 *   - analyzePdfWithVision：PDF → pdftoppm 渲页后，把页面 PNG 作为 images 传入；
 *                          sourceSha256 = 源 PDF 的 sha（所有 figure-crop 都挂在
 *                          PDF 这一个 source 下）。
 *   - 用户直接上传 image：caller 自己算 sha 传入；若是 N 张独立图各算各的 sha，
 *                       就循环调 N 次（每次 images.length=1）。
 *
 * 不做（caller 责任）：
 *   - 不算 sha256：必须由 caller 显式传入（PDF 是 PDF 的 sha，image 是 image 的 sha）
 *   - 不持久化原图：rasterize-v1 / upload-v1 这种"原图入库"由 caller 自己决定
 *   - 不写 derived_asset 行：只产出候选记录
 */
import {
  analyzeImages,
  type AnalyzeImagesInputImage,
  type AnalyzeImagesPromptCtx,
  type AnalyzeImagesProgressEvent,
  type AnalyzedImage,
} from './analyze-images';
import {
  cropFiguresToStorage,
  type CropFiguresResult,
} from './crop-figures';
import type { ObjectStore } from '@hao/storage';

export interface AnalyzeImagesToStorageOptions {
  providerId: string;
  /** 待解析图片 batch；name 必须唯一（cropFigures 用作 imagesByName 的 key） */
  images: AnalyzeImagesInputImage[];
  /** 上游源的 sha256；所有 figure-crop derived_asset 都挂在这一个 source 下 */
  sourceSha256: string;
  /** ObjectStore 实例（caller 用 createStore() 获取） */
  store: ObjectStore;
  /** 与 analyzeImages 同形 prompt builder */
  promptBuilder: (ctx: AnalyzeImagesPromptCtx) => string;
  /** 两次 LLM 调用之间睡秒数；默认 8（与 analyzePdfWithVision 同步） */
  delayBetweenRequestsSeconds?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  /** figure-crop derived_asset 的 version；默认 'v1' */
  figureCropVersion?: string;
  onProgress?: (e: AnalyzeImagesToStorageEvent) => void;
}

export type AnalyzeImagesToStorageEvent =
  | AnalyzeImagesProgressEvent
  | { type: 'crop_done'; figureCount: number; invalidCount: number };

export interface AnalyzeImagesToStorageResult {
  items: CropFiguresResult['items'];
  resources: CropFiguresResult['resources'];
  perImage: AnalyzedImage[];
  /** 仅 figure-crop 候选；rasterize-v1 / upload-v1 这类原图持久化由 caller 自己加 */
  derivedAssets: Array<{
    source_sha256: string;
    processor: 'figure-crop';
    version: string;
    asset_key: string;
    storage_path: string;
    size_bytes: number;
    metadata: Record<string, unknown>;
  }>;
  invalidFigures: CropFiguresResult['invalid'];
  totalTokenUsage: { input: number; output: number };
}

export async function analyzeImagesToStorage(
  opts: AnalyzeImagesToStorageOptions,
): Promise<AnalyzeImagesToStorageResult> {
  const figureCropVersion = opts.figureCropVersion ?? 'v1';

  // 1) analyzeImages：每张图独立调一次 vision LLM → items + resources + figures.bbox
  const analyzed = await analyzeImages({
    providerId: opts.providerId,
    images: opts.images,
    promptBuilder: opts.promptBuilder,
    delayBetweenRequestsSeconds: opts.delayBetweenRequestsSeconds ?? 8,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: opts.maxRetries,
    onProgress: opts.onProgress,
  });

  // 2) imagesByName 直接由入参 images 派生（cropFigures 按 name 索引取字节）
  const imagesByName: Record<string, Buffer> = {};
  for (const img of opts.images) imagesByName[img.name] = img.png;

  // 3) cropFiguresToStorage：bbox → sharp 裁切 → store.put → 出 derived_asset 候选
  const cropped = await cropFiguresToStorage({
    items: analyzed.items,
    resources: analyzed.resources,
    imagesByName,
    sourceSha256: opts.sourceSha256,
    store: opts.store,
    version: figureCropVersion,
  });
  opts.onProgress?.({
    type: 'crop_done',
    figureCount: cropped.derivedAssets.length,
    invalidCount: cropped.invalid.length,
  });

  // 4) token 汇总
  const totalTokenUsage = analyzed.perImage.reduce(
    (acc, p) => ({
      input: acc.input + (p.tokenUsage?.input ?? 0),
      output: acc.output + (p.tokenUsage?.output ?? 0),
    }),
    { input: 0, output: 0 },
  );

  return {
    items: cropped.items,
    resources: cropped.resources,
    perImage: analyzed.perImage,
    derivedAssets: cropped.derivedAssets,
    invalidFigures: cropped.invalid,
    totalTokenUsage,
  };
}
