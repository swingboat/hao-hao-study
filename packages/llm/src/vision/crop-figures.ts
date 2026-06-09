/**
 * 按 bbox 裁切 items / resources 上的 figure，落 storage + derived_asset。
 *
 * 输入：analyzeImages 的结果 + 源 PNG 字典 + ObjectStore + 上游 PDF/image 的 sha256
 * 输出：富化后的 items/resources（figures[].url 填充为 presigned URL，可直接给前端）+
 *       derived_asset upsert 记录列表（caller 决定是落 Prisma 还是别的）
 *
 * 裁切实现：sharp（已经是 next.js 的 transitive dep）。
 * Storage key：StoragePaths.derived(sourceSha, 'figure-crop', 'v1', '{itemId}-fig-{N}.png')。
 */
import sharp from 'sharp';
import {
  StoragePaths,
  type ObjectStore,
  type PutResult,
} from '@hao/storage';
import type { ExtractedItem, ExtractedResource, Figure } from './analyze-images';

export interface CropFiguresOptions {
  /** items + resources 来自 analyzeImages */
  items: ExtractedItem[];
  resources: ExtractedResource[];
  /** image name → PNG 字节；通常是 analyzeImages 输入的同一份 */
  imagesByName: Record<string, Buffer>;
  /** 上游源（PDF 或 image）的 sha256；决定 derived/{sha}/figure-crop-v1/... 路径 */
  sourceSha256: string;
  /** ObjectStore 实例（由 caller 通过 createStore() 得到） */
  store: ObjectStore;
  /** 处理器版本；默认 'v1' */
  version?: string;
}

export interface CroppedFigure extends Figure {
  /** Storage key（StoragePaths.derived 拼出的） */
  storage_key: string;
  /** 通过 store.presignedGetUrl() 取的可访问 URL */
  url: string;
  /** 派生元数据；建议入 derived_asset.metadata */
  derived_metadata: {
    processor: 'figure-crop';
    src_image: string;
    src_page?: number;
    bbox: [number, number, number, number];
    alt: string;
  };
}

export interface CropFiguresResult {
  /** 富化后的 items：含图题的 figures[i] 升级为 CroppedFigure（带 url） */
  items: Array<Omit<ExtractedItem, 'figures'> & { figures?: CroppedFigure[] }>;
  resources: Array<Omit<ExtractedResource, 'figures'> & { figures?: CroppedFigure[] }>;
  /** 写入 derived_asset 的候选记录；caller 自己决定是 prisma.upsert 还是别的 */
  derivedAssets: Array<{
    source_sha256: string;
    processor: 'figure-crop';
    version: string;
    asset_key: string;
    storage_path: string;
    size_bytes: number;
    metadata: CroppedFigure['derived_metadata'];
  }>;
  /** bbox 越界 / 裁切失败的图；caller 决定是日志还是丢回 staging */
  invalid: Array<{ owner: 'item' | 'resource'; ownerIndex: number; figureNo: number; reason: string }>;
}

export async function cropFiguresToStorage(opts: CropFiguresOptions): Promise<CropFiguresResult> {
  const version = opts.version ?? 'v1';
  const derivedAssets: CropFiguresResult['derivedAssets'] = [];
  const invalid: CropFiguresResult['invalid'] = [];

  // 复用 sharp metadata（同一张 image 多次裁切只读一次尺寸）
  const dimCache = new Map<string, { width: number; height: number }>();

  async function processOne(
    owner: 'item' | 'resource',
    ownerIndex: number,
    srcImage: string,
    srcPage: number | undefined,
    fig: Figure,
    ownerIdHint: string,
  ): Promise<CroppedFigure | null> {
    const png = opts.imagesByName[srcImage];
    if (!png) {
      invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: `no image buffer for ${srcImage}` });
      return null;
    }

    let dim = dimCache.get(srcImage);
    if (!dim) {
      const meta = await sharp(png).metadata();
      if (!meta.width || !meta.height) {
        invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: 'sharp could not read width/height' });
        return null;
      }
      dim = { width: meta.width, height: meta.height };
      dimCache.set(srcImage, dim);
    }

    const [x1, y1, x2, y2] = fig.bbox;
    if (
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(x2) ||
      !Number.isFinite(y2) ||
      x2 <= x1 ||
      y2 <= y1 ||
      x1 < 0 ||
      y1 < 0 ||
      x2 > 1.001 ||
      y2 > 1.001
    ) {
      invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: `invalid bbox ${JSON.stringify(fig.bbox)}` });
      return null;
    }
    const left = Math.max(0, Math.round(x1 * dim.width));
    const top = Math.max(0, Math.round(y1 * dim.height));
    const width = Math.min(dim.width - left, Math.round((x2 - x1) * dim.width));
    const height = Math.min(dim.height - top, Math.round((y2 - y1) * dim.height));
    if (width <= 0 || height <= 0) {
      invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: 'computed extract area is empty' });
      return null;
    }

    let cropped: Buffer;
    try {
      cropped = await sharp(png).extract({ left, top, width, height }).png().toBuffer();
    } catch (e) {
      invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: `sharp extract failed: ${String(e).slice(0, 200)}` });
      return null;
    }

    const assetKey = `${ownerIdHint}-fig-${fig.figure_no}.png`;
    const storagePath = StoragePaths.derived(opts.sourceSha256, 'figure-crop', version, assetKey);
    let putResult: PutResult;
    try {
      putResult = await opts.store.put(storagePath, cropped, { contentType: 'image/png' });
    } catch (e) {
      invalid.push({ owner, ownerIndex, figureNo: fig.figure_no, reason: `storage.put failed: ${String(e).slice(0, 200)}` });
      return null;
    }

    const meta = {
      processor: 'figure-crop' as const,
      src_image: srcImage,
      src_page: srcPage,
      bbox: fig.bbox,
      alt: fig.alt ?? '',
    };

    derivedAssets.push({
      source_sha256: opts.sourceSha256,
      processor: 'figure-crop',
      version,
      asset_key: assetKey,
      storage_path: storagePath,
      size_bytes: putResult.size,
      metadata: meta,
    });

    return {
      ...fig,
      storage_key: storagePath,
      url: await opts.store.presignedGetUrl(storagePath),
      derived_metadata: meta,
    };
  }

  const itemsOut: CropFiguresResult['items'] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i]!;
    const ownerIdHint = sanitizeIdHint(`item-${i + 1}-${it.item_no ?? ''}`);
    if (!it.figures || it.figures.length === 0) {
      itemsOut.push({ ...it, figures: undefined });
      continue;
    }
    const cropped: CroppedFigure[] = [];
    for (const fig of it.figures) {
      const c = await processOne('item', i, it._src_image, it._src_page, fig, ownerIdHint);
      if (c) cropped.push(c);
    }
    itemsOut.push({ ...it, figures: cropped });
  }

  const resourcesOut: CropFiguresResult['resources'] = [];
  for (let i = 0; i < opts.resources.length; i++) {
    const r = opts.resources[i]!;
    const ownerIdHint = sanitizeIdHint(`resource-${i + 1}`);
    if (!r.figures || r.figures.length === 0) {
      resourcesOut.push({ ...r, figures: undefined });
      continue;
    }
    const cropped: CroppedFigure[] = [];
    for (const fig of r.figures) {
      const c = await processOne('resource', i, r._src_image, r._src_page, fig, ownerIdHint);
      if (c) cropped.push(c);
    }
    resourcesOut.push({ ...r, figures: cropped });
  }

  return { items: itemsOut, resources: resourcesOut, derivedAssets, invalid };
}

/** asset_key 仅允许 [a-zA-Z0-9._-]；中文 / 空格 / 标点 → 下划线 */
function sanitizeIdHint(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}
