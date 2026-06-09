/**
 * extractItemsFromPdf — L2 教材抽题流水线
 *
 * 在 L3 (`analyzeImageBatch`) + L1 friends (`rasterizePdf` / `cropFiguresToStorage`)
 * 之上做"不丢题"语义：
 *
 *   ┌── 1. rasterizePdf → 每页 PNG
 *   ├── 2. 按 pagesPerCall 切 group（默认 3 页一组）
 *   ├── 3. 每个 group 调 analyzeImageBatch，prompt 强制 LLM 自报：
 *   │       - _src_pages: number[]            （这道题出现在哪几页）
 *   │       - _truncated_before: boolean      （chunk 首页前还有内容 → 跨页）
 *   │       - _truncated_after:  boolean      （chunk 末页后还有内容 → 跨页）
 *   ├── 4. 收集所有 items；找到所有"边界对"[N, N+1]：
 *   │       chunk A 末题 _truncated_after=true 且 chunk B 首题 _truncated_before=true
 *   │       且 A.末页 + 1 == B.首页
 *   ├── 5. 对每个边界对调 analyzeImageBatch([page_N, page_N+1])，
 *   │       prompt 改为"只抽跨这两页的题"
 *   ├── 6. dedup：content 前 100 字 normalized hash + item_no；
 *   │       完整版本（_truncated_* 均 false）覆盖被切版本
 *   └── 7. cropFiguresToStorage → derived_asset 候选
 *
 * 与 L0 (`analyzeFile.pdf`) 的边界：
 *   - L0 不懂"题"，只 join 文本；L2 懂 schema，输出 structured items
 *   - L0 默认 pagesPerCall=1；L2 默认 pagesPerCall=3 + 边界重抽
 *   - L0 不沾 storage；L2 做 figure crop + derived_asset
 *
 * caller 责任：
 *   - 算 sourceSha256 传入（PDF 的 sha；derived_asset 都挂这下面）
 *   - 落 prisma（content_upload / derived_asset / staging.kp_items）
 *   - 调用前自己 validate pdfPath 可读
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z, type ZodTypeAny } from 'zod';
import { type ObjectStore } from '@hao/storage';

import { analyzeImageBatch } from './analyze-image-batch';
import { rasterizePdf, type RasterizedPage } from '../pdf/rasterize';
import {
  cropFiguresToStorage,
  type CropFiguresResult,
} from './crop-figures';
import type {
  ExtractedItem,
  ExtractedResource,
  Figure,
} from './analyze-images';

// ────────── 选项 / 返回 ──────────

export interface ExtractItemsFromPdfOptions {
  pdfPath: string;
  providerId: string;
  /** PDF 的 sha256；caller 自己算（避免 L2 帮你算了又跟你的 content_upload 路径对不上） */
  sourceSha256: string;
  store: ObjectStore;
  /** 每次 LLM 调用喂多少页；默认 3 */
  pagesPerCall?: number;
  /** 渲染 DPI；默认 150 */
  dpi?: number;
  firstPage?: number;
  lastPage?: number;
  /** 两次 LLM 调用之间睡秒数；默认 8 */
  delayBetweenRequestsSeconds?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  /** figure-crop derived_asset version；默认 'v1' */
  figureCropVersion?: string;
  /** 自定义 chunk 抽题 prompt（默认见 buildDefaultChunkPrompt） */
  chunkPromptBuilder?: (ctx: { pages: number[]; totalPages: number; chunkIndex: number; totalChunks: number }) => string;
  /** 自定义边界重抽 prompt（默认见 buildDefaultBoundaryPrompt） */
  boundaryPromptBuilder?: (ctx: { pageA: number; pageB: number }) => string;
  onProgress?: (e: ExtractItemsProgressEvent) => void;
}

export type ExtractItemsProgressEvent =
  | { type: 'rasterize_done'; pageCount: number; dpi: number }
  | { type: 'chunk_start'; chunkIndex: number; totalChunks: number; pages: number[] }
  | { type: 'chunk_done'; chunkIndex: number; pages: number[]; itemCount: number; truncatedCount: number; tokenUsage: { input: number; output: number } | null }
  | { type: 'chunk_error'; chunkIndex: number; pages: number[]; error: unknown }
  | { type: 'boundary_plan'; boundaries: Array<[number, number]> }
  | { type: 'boundary_done'; pages: [number, number]; addedItemCount: number }
  | { type: 'dedup_done'; before: number; after: number }
  | { type: 'crop_done'; figureCount: number; invalidCount: number };

export interface ExtractItemsFromPdfResult {
  pageCount: number;
  items: CropFiguresResult['items'];
  resources: CropFiguresResult['resources'];
  derivedAssets: CropFiguresResult['derivedAssets'];
  invalidFigures: CropFiguresResult['invalid'];
  totalTokenUsage: { input: number; output: number };
  /** 调试 / 审计用：每个 chunk 的抽取统计 */
  chunks: Array<{ pages: number[]; itemCount: number; truncatedCount: number; error?: string }>;
  /** 调试 / 审计用：实际重抽的边界对 */
  boundaryRefetches: Array<{ pages: [number, number]; addedItemCount: number }>;
  /** 调试 / 审计用：dedup 前后数量 */
  dedup: { before: number; after: number };
}

// ────────── 默认 prompt ──────────

function buildDefaultChunkPrompt(ctx: { pages: number[]; totalPages: number; chunkIndex: number; totalChunks: number }): string {
  const pagesText = ctx.pages.join(', ');
  return [
    `这是教材/试卷 PDF 第 ${ctx.chunkIndex}/${ctx.totalChunks} 个分片（原 PDF 第 ${pagesText} 页，共 ${ctx.totalPages} 页）。`,
    '请抽取这几页里出现的**试题**（item）和**知识点说明 / 解题方法 / 易错点 / 关键概念**（resource）。',
    '',
    '严格按以下 JSON Schema 输出（不要任何 markdown 包裹、不要解释、不要前后缀）：',
    '{',
    '  "items": [{',
    '    "content": "题干（含 [图N] 占位符）",',
    '    "item_type": "choice" | "fill_in",',
    '    "options": [{"label":"A","text":"..."}, ...],   // 填空题留空数组',
    '    "answer": "答案",',
    '    "solution_text": "解析（无则空串）",',
    '    "difficulty": 1-5,',
    '    "kp_hints": ["相关知识点名"],',
    '    "item_no": "题号（如 12 / 第三题）",            // 没有就 null',
    '    "figures": [{"figure_no":1,"alt":"...","bbox":[x1,y1,x2,y2]}],  // 归一化 [0..1] 左上原点',
    '    "_src_pages": [页号, ...],                       // 这题出现在哪几页（必填）',
    '    "_truncated_before": true|false,                 // 这题题干是不是从上一页延续过来的',
    '    "_truncated_after":  true|false                  // 这题是不是延续到了下一页（题干/选项/解析未完）',
    '  }],',
    '  "resources": [{',
    '    "kp_hint": "知识点名",',
    '    "resource_kind": "summary"|"method"|"pitfall"|"key_point",',
    '    "title": "...",',
    '    "content": "...",',
    '    "figures": [{...}],',
    '    "_src_pages": [页号, ...],',
    '    "_truncated_before": true|false,',
    '    "_truncated_after":  true|false',
    '  }]',
    '}',
    '',
    '重要：',
    `- 本分片只包含第 ${pagesText} 页；如果某题题干在第 ${ctx.pages[0]} 页前面就开始了（你看不到上文），_truncated_before=true。`,
    `- 如果某题在第 ${ctx.pages[ctx.pages.length - 1]} 页末尾还没结束（题干/选项/解析被截断），_truncated_after=true。`,
    '- _src_pages 必须是 1-based 的实际 PDF 页号，不是 chunk 内编号。',
    '- 没有图就不要伪造 figures。',
  ].join('\n');
}

function buildDefaultBoundaryPrompt(ctx: { pageA: number; pageB: number }): string {
  return [
    `下面是 PDF 的相邻两页：第 ${ctx.pageA} 页和第 ${ctx.pageB} 页。`,
    '之前按多页分片抽题时，检测到有题目跨这两页被切断了。',
    '请**只**抽出**横跨这两页**（题干起始在 A、结束在 B）的题目；',
    '完全在 A 内或完全在 B 内的题目**不要**重复抽出。',
    '',
    '按相同 JSON Schema 输出（含 _src_pages、_truncated_before/after，但跨页题的两个 _truncated_* 都应为 false 因为这次你两页都看到了）：',
    '{ "items": [...], "resources": [...] }',
    '',
    '没有跨页题就返回 { "items": [], "resources": [] }。',
  ].join('\n');
}

// ────────── schema ──────────

const FigureSchema = z.object({
  figure_no: z.number(),
  alt: z.string().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const ChunkItemSchema = z.object({
  content: z.string(),
  item_type: z.enum(['choice', 'fill_in']),
  options: z.array(z.object({ label: z.string(), text: z.string() })),
  answer: z.string(),
  solution_text: z.string(),
  difficulty: z.number(),
  kp_hints: z.array(z.string()),
  item_no: z.string().nullable().optional(),
  figures: z.array(FigureSchema).optional(),
  _src_pages: z.array(z.number()),
  _truncated_before: z.boolean(),
  _truncated_after: z.boolean(),
});

const ChunkResourceSchema = z.object({
  kp_hint: z.string(),
  resource_kind: z.enum(['summary', 'method', 'pitfall', 'key_point']),
  title: z.string(),
  content: z.string(),
  figures: z.array(FigureSchema).optional(),
  _src_pages: z.array(z.number()),
  _truncated_before: z.boolean(),
  _truncated_after: z.boolean(),
});

const ChunkExtractionSchema = z.object({
  items: z.array(ChunkItemSchema),
  resources: z.array(ChunkResourceSchema),
});

type ChunkItem = z.infer<typeof ChunkItemSchema>;
type ChunkResource = z.infer<typeof ChunkResourceSchema>;
type ChunkExtraction = z.infer<typeof ChunkExtractionSchema>;

// ────────── 内部工具 ──────────

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunkPages(pages: number[], pagesPerCall: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < pages.length; i += pagesPerCall) {
    groups.push(pages.slice(i, i + pagesPerCall));
  }
  return groups;
}

/** 按 normalized content 前 100 字 + item_no 做 dedup key */
function dedupKey(content: string, itemNo?: string | null): string {
  const norm = content.replace(/\s+/g, '').slice(0, 100);
  const h = createHash('sha1').update(norm).update('|').update(itemNo ?? '').digest('hex');
  return h;
}

/** 完整版本 vs 被切版本：完整的留下 */
function preferComplete<T extends { _truncated_before: boolean; _truncated_after: boolean }>(a: T, b: T): T {
  const aComplete = !a._truncated_before && !a._truncated_after;
  const bComplete = !b._truncated_before && !b._truncated_after;
  if (aComplete && !bComplete) return a;
  if (!aComplete && bComplete) return b;
  return a;  // 都完整或都被切：保留先出现的（chunk 顺序）
}

/** chunk item → 业务 ExtractedItem（去掉内部字段 + 填 _src_image / _src_page 兼容字段） */
function toExtractedItem(it: ChunkItem, imageNameByPage: Map<number, string>): ExtractedItem {
  const firstPage = it._src_pages[0];
  return {
    content: it.content,
    item_type: it.item_type,
    options: it.options,
    answer: it.answer,
    solution_text: it.solution_text,
    difficulty: it.difficulty,
    kp_hints: it.kp_hints,
    item_no: it.item_no ?? undefined,
    figures: it.figures as Figure[] | undefined,
    _src_image: firstPage !== undefined ? imageNameByPage.get(firstPage) ?? `page-${String(firstPage).padStart(3, '0')}` : 'unknown',
    _src_page: firstPage,
  };
}

function toExtractedResource(r: ChunkResource, imageNameByPage: Map<number, string>): ExtractedResource {
  const firstPage = r._src_pages[0];
  return {
    kp_hint: r.kp_hint,
    resource_kind: r.resource_kind,
    title: r.title,
    content: r.content,
    figures: r.figures as Figure[] | undefined,
    _src_image: firstPage !== undefined ? imageNameByPage.get(firstPage) ?? `page-${String(firstPage).padStart(3, '0')}` : 'unknown',
    _src_page: firstPage,
  };
}

// ────────── 主流程 ──────────

export async function extractItemsFromPdf(
  opts: ExtractItemsFromPdfOptions,
): Promise<ExtractItemsFromPdfResult> {
  const pagesPerCall = opts.pagesPerCall ?? 3;
  const dpi = opts.dpi ?? 150;
  const delayMs = (opts.delayBetweenRequestsSeconds ?? 8) * 1000;
  const figureCropVersion = opts.figureCropVersion ?? 'v1';
  const chunkPromptBuilder = opts.chunkPromptBuilder ?? buildDefaultChunkPrompt;
  const boundaryPromptBuilder = opts.boundaryPromptBuilder ?? buildDefaultBoundaryPrompt;
  const emit = opts.onProgress ?? (() => {});

  // 1) rasterize
  const renderedPages: RasterizedPage[] = await rasterizePdf(opts.pdfPath, {
    dpi,
    firstPage: opts.firstPage,
    lastPage: opts.lastPage,
  });
  emit({ type: 'rasterize_done', pageCount: renderedPages.length, dpi });

  const pageNumbers = renderedPages.map((p) => p.page);
  const pageNameOf = (p: number) => `page-${String(p).padStart(3, '0')}`;
  const imageNameByPage = new Map<number, string>();
  const imagesByName: Record<string, Buffer> = {};
  for (const rp of renderedPages) {
    const name = pageNameOf(rp.page);
    imageNameByPage.set(rp.page, name);
    imagesByName[name] = rp.png;
  }
  const groups = chunkPages(pageNumbers, pagesPerCall);

  // 2) 逐 chunk 抽题
  const chunkStats: ExtractItemsFromPdfResult['chunks'] = [];
  const allRawItems: ChunkItem[] = [];
  const allRawResources: ChunkResource[] = [];
  let tokIn = 0;
  let tokOut = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const groupPages = groups[gi]!;
    emit({ type: 'chunk_start', chunkIndex: gi + 1, totalChunks: groups.length, pages: groupPages });

    const images = groupPages.map((p) => ({
      bytes: imagesByName[pageNameOf(p)]!,
      format: 'png' as const,
      name: pageNameOf(p),
    }));

    try {
      const r = await analyzeImageBatch<ChunkExtraction>({
        providerId: opts.providerId,
        images,
        prompt: chunkPromptBuilder({
          pages: groupPages,
          totalPages: renderedPages.length,
          chunkIndex: gi + 1,
          totalChunks: groups.length,
        }),
        schema: ChunkExtractionSchema as unknown as ZodTypeAny,
        maxOutputTokens: opts.maxOutputTokens,
        maxRetries: opts.maxRetries,
      });
      const parsed = (r.data ?? { items: [], resources: [] }) as ChunkExtraction;
      allRawItems.push(...parsed.items);
      allRawResources.push(...parsed.resources);
      const truncatedCount = parsed.items.filter((i) => i._truncated_before || i._truncated_after).length;
      chunkStats.push({ pages: groupPages, itemCount: parsed.items.length, truncatedCount });
      if (r.tokenUsage) {
        tokIn += r.tokenUsage.input;
        tokOut += r.tokenUsage.output;
      }
      emit({
        type: 'chunk_done',
        chunkIndex: gi + 1,
        pages: groupPages,
        itemCount: parsed.items.length,
        truncatedCount,
        tokenUsage: r.tokenUsage,
      });
    } catch (err) {
      chunkStats.push({ pages: groupPages, itemCount: 0, truncatedCount: 0, error: String(err).slice(0, 500) });
      emit({ type: 'chunk_error', chunkIndex: gi + 1, pages: groupPages, error: err });
    }

    if (gi < groups.length - 1 && delayMs > 0) await SLEEP(delayMs);
  }

  // 3) 计算边界对：chunk 末尾 _truncated_after + 下一 chunk 首部 _truncated_before
  //    用页对 (lower, lower+1) 唯一化（避免对同一边界查两次）
  const boundarySet = new Set<string>();
  for (const it of [...allRawItems, ...allRawResources]) {
    if (it._truncated_after) {
      const lastPage = it._src_pages[it._src_pages.length - 1];
      if (typeof lastPage === 'number' && pageNumbers.includes(lastPage + 1)) {
        boundarySet.add(`${lastPage},${lastPage + 1}`);
      }
    }
    if (it._truncated_before) {
      const firstPage = it._src_pages[0];
      if (typeof firstPage === 'number' && pageNumbers.includes(firstPage - 1)) {
        boundarySet.add(`${firstPage - 1},${firstPage}`);
      }
    }
  }
  const boundaries: Array<[number, number]> = Array.from(boundarySet)
    .map((k) => k.split(',').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0]);
  emit({ type: 'boundary_plan', boundaries });

  // 4) 逐个边界重抽
  const boundaryRefetches: ExtractItemsFromPdfResult['boundaryRefetches'] = [];
  for (let bi = 0; bi < boundaries.length; bi++) {
    const [pa, pb] = boundaries[bi]!;
    if (delayMs > 0) await SLEEP(delayMs);
    try {
      const r = await analyzeImageBatch<ChunkExtraction>({
        providerId: opts.providerId,
        images: [
          { bytes: imagesByName[pageNameOf(pa)]!, format: 'png', name: pageNameOf(pa) },
          { bytes: imagesByName[pageNameOf(pb)]!, format: 'png', name: pageNameOf(pb) },
        ],
        prompt: boundaryPromptBuilder({ pageA: pa, pageB: pb }),
        schema: ChunkExtractionSchema as unknown as ZodTypeAny,
        maxOutputTokens: opts.maxOutputTokens,
        maxRetries: opts.maxRetries,
      });
      const parsed = (r.data ?? { items: [], resources: [] }) as ChunkExtraction;
      allRawItems.push(...parsed.items);
      allRawResources.push(...parsed.resources);
      if (r.tokenUsage) {
        tokIn += r.tokenUsage.input;
        tokOut += r.tokenUsage.output;
      }
      boundaryRefetches.push({ pages: [pa, pb], addedItemCount: parsed.items.length });
      emit({ type: 'boundary_done', pages: [pa, pb], addedItemCount: parsed.items.length });
    } catch (err) {
      // 重抽失败不致命：原 chunk 里的被切版本仍然在 allRawItems 里
      boundaryRefetches.push({ pages: [pa, pb], addedItemCount: 0 });
      emit({ type: 'boundary_done', pages: [pa, pb], addedItemCount: 0 });
    }
  }

  // 5) dedup：完整版本优先
  const itemMap = new Map<string, ChunkItem>();
  for (const it of allRawItems) {
    const k = dedupKey(it.content, it.item_no);
    const prev = itemMap.get(k);
    itemMap.set(k, prev ? preferComplete(prev, it) : it);
  }
  const resourceMap = new Map<string, ChunkResource>();
  for (const r of allRawResources) {
    const k = dedupKey(r.content, r.title);
    const prev = resourceMap.get(k);
    resourceMap.set(k, prev ? preferComplete(prev, r) : r);
  }
  emit({ type: 'dedup_done', before: allRawItems.length, after: itemMap.size });

  // 6) 转 ExtractedItem 形态 + cropFigures
  const dedupedItems = Array.from(itemMap.values()).map((it) => toExtractedItem(it, imageNameByPage));
  const dedupedResources = Array.from(resourceMap.values()).map((r) => toExtractedResource(r, imageNameByPage));

  const cropped = await cropFiguresToStorage({
    items: dedupedItems,
    resources: dedupedResources,
    imagesByName,
    sourceSha256: opts.sourceSha256,
    store: opts.store,
    version: figureCropVersion,
  });
  emit({ type: 'crop_done', figureCount: cropped.derivedAssets.length, invalidCount: cropped.invalid.length });

  return {
    pageCount: renderedPages.length,
    items: cropped.items,
    resources: cropped.resources,
    derivedAssets: cropped.derivedAssets,
    invalidFigures: cropped.invalid,
    totalTokenUsage: { input: tokIn, output: tokOut },
    chunks: chunkStats,
    boundaryRefetches,
    dedup: { before: allRawItems.length, after: itemMap.size },
  };
}
