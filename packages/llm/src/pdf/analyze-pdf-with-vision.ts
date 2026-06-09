/**
 * analyzePdfWithVision — PDF → 抽题端到端公共层
 *
 * 串起来的三块：
 *   1. rasterizePdf  (pdftoppm)           PDF → 每页 PNG
 *   2. analyzeImages (callLLM)            每页 PNG → items + resources + figures.bbox
 *   3. cropFiguresToStorage (sharp+store) figures.bbox → 裁切落 ObjectStore
 *
 * 同时：
 *   - 计算源 PDF 的 sha256（CAS key，对应 content_upload.sha256）
 *   - 可选把每页 PNG 也作为 rasterize-v1 派生资产落 storage（默认开，便于重跑跳过）
 *   - 汇总所有 derived_asset 候选，caller 决定是 prisma.upsert 还是别的
 *
 * 不做（caller 责任，避免本包绑死 prisma 写路径）：
 *   - 写 content_upload 行
 *   - 写 derived_asset 行
 *   - 写 llm_parse_job / staging
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type ObjectStore, StoragePaths } from '@hao/storage';
import { rasterizePdf } from './rasterize';
import type {
  AnalyzeImagesPromptCtx,
  AnalyzeImagesProgressEvent,
  AnalyzedImage,
} from '../vision/analyze-images';
import { analyzeImagesToStorage } from '../vision/analyze-images-to-storage';
import type { CropFiguresResult } from '../vision/crop-figures';

export interface AnalyzePdfWithVisionOptions {
  pdfPath: string;
  providerId: string;
  /** ObjectStore 实例（caller 用 createStore() 获取） */
  store: ObjectStore;
  /** 与 analyzeImages 同形 prompt builder */
  promptBuilder: (ctx: AnalyzeImagesPromptCtx) => string;
  /** 渲染 DPI；默认 150 */
  dpi?: number;
  /** 两次 LLM 调用之间睡秒数；默认 8 */
  delayBetweenRequestsSeconds?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  /** 是否把每页 PNG 也作为 rasterize-v1 派生资产持久化；默认 true */
  persistRasterizedPages?: boolean;
  rasterizeVersion?: string;
  figureCropVersion?: string;
  /** 仅渲指定页范围（含端点） */
  firstPage?: number;
  lastPage?: number;
  onProgress?: (e: AnalyzePdfWithVisionEvent) => void;
}

export type AnalyzePdfWithVisionEvent =
  | { type: 'sha256_done'; sha256: string; bytes: number }
  | { type: 'rasterize_done'; pageCount: number; dpi: number }
  | { type: 'rasterize_persisted'; pageCount: number }
  | AnalyzeImagesProgressEvent
  | { type: 'crop_done'; figureCount: number; invalidCount: number };

export interface AnalyzePdfWithVisionResult {
  sourceSha256: string;
  bytes: number;
  pageCount: number;
  items: CropFiguresResult['items'];
  resources: CropFiguresResult['resources'];
  perPage: AnalyzedImage[];
  derivedAssets: Array<{
    source_sha256: string;
    processor: 'rasterize' | 'figure-crop';
    version: string;
    asset_key: string;
    storage_path: string;
    size_bytes: number;
    metadata: Record<string, unknown>;
  }>;
  invalidFigures: CropFiguresResult['invalid'];
  totalTokenUsage: { input: number; output: number };
}

export async function analyzePdfWithVision(
  opts: AnalyzePdfWithVisionOptions,
): Promise<AnalyzePdfWithVisionResult> {
  const dpi = opts.dpi ?? 150;
  const rasterizeVersion = opts.rasterizeVersion ?? 'v1';
  const figureCropVersion = opts.figureCropVersion ?? 'v1';

  // 1) sha256
  const pdfBytes = await readFile(opts.pdfPath);
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');
  opts.onProgress?.({ type: 'sha256_done', sha256, bytes: pdfBytes.length });

  // 2) 渲染
  const pages = await rasterizePdf(opts.pdfPath, {
    dpi,
    firstPage: opts.firstPage,
    lastPage: opts.lastPage,
  });
  opts.onProgress?.({ type: 'rasterize_done', pageCount: pages.length, dpi });

  // 命名约定：page-001 / page-002 ...（asset_key 用 .png 后缀；name 不带后缀，便于在 LLM 端识别）
  const pageNameOf = (p: number) => `page-${String(p).padStart(3, '0')}`;

  // 3) 可选持久化每页 PNG（rasterize-v1）
  const derivedAssets: AnalyzePdfWithVisionResult['derivedAssets'] = [];
  if (opts.persistRasterizedPages !== false) {
    for (const p of pages) {
      const assetKey = `${pageNameOf(p.page)}.png`;
      const storagePath = StoragePaths.derived(sha256, 'rasterize', rasterizeVersion, assetKey);
      const r = await opts.store.put(storagePath, p.png, { contentType: 'image/png' });
      derivedAssets.push({
        source_sha256: sha256,
        processor: 'rasterize',
        version: rasterizeVersion,
        asset_key: assetKey,
        storage_path: storagePath,
        size_bytes: r.size,
        metadata: { processor: 'rasterize', page: p.page, dpi: p.dpi },
      });
    }
    opts.onProgress?.({ type: 'rasterize_persisted', pageCount: pages.length });
  }

  // 4) analyzeImages + crop figures + token 汇总：交给共用的 analyzeImagesToStorage。
  //    name 与 cropFigures 的 imagesByName key 对齐由 analyzeImagesToStorage 内部做。
  const visionResult = await analyzeImagesToStorage({
    providerId: opts.providerId,
    images: pages.map((p) => ({ name: pageNameOf(p.page), png: p.png, page: p.page })),
    sourceSha256: sha256,
    store: opts.store,
    promptBuilder: opts.promptBuilder,
    delayBetweenRequestsSeconds: opts.delayBetweenRequestsSeconds ?? 8,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: opts.maxRetries,
    figureCropVersion,
    onProgress: opts.onProgress,
  });
  derivedAssets.push(...visionResult.derivedAssets);

  return {
    sourceSha256: sha256,
    bytes: pdfBytes.length,
    pageCount: pages.length,
    items: visionResult.items,
    resources: visionResult.resources,
    perPage: visionResult.perImage,
    derivedAssets,
    invalidFigures: visionResult.invalidFigures,
    totalTokenUsage: visionResult.totalTokenUsage,
  };
}
