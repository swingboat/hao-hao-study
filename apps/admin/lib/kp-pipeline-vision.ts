/**
 * KP 解析流水线 v3 — vision 路径（pdftoppm → Gemini vision）。
 *
 * 与 kp-pipeline.ts（converse 路径，已 @deprecated）镜像同形：
 *   - 同样 resume cache（chunksCache by `${start}-${end}`，但 vision 路径 key
 *     带 `vision/` 前缀，避免读到旧 converse 缓存误命中）
 *   - 同样 onChunkPersist / onProgress / KpProgressEvent 事件名 → actions.ts 的
 *     switch 完全不用改
 *   - 同样 TS 手工合并（mergeChunkItems 行为复用，因为 vision 在 1M context 下
 *     不再撞 4096 输出上限，但保留手工合并：(a) 行为稳定，(b) 不消耗额外 LLM 调用做终审）
 *
 * 与 kp-pipeline.ts 的差异：
 *   - rasterizePdf 替换 extractPdfChunk（PDF → PNG 每页一张）
 *   - analyzeImageBatch 替换 callLLM(pdf attachment)（多 image_url content part）
 *   - chunkPages 默认 3（而非 15）：vision 单次喂 3 张 ≈ 1800 input + 4000 output，
 *     安全；缓解跨页 KP 表述被切
 *   - delayBetweenRequestsSeconds 默认 8（而非 60）：vision provider（webex-gemini-3.1-pro）
 *     实测 8s sleep 即可，不撞 429
 *
 * 弃用根因（converse）：Webex proxy 上 429 触发率过高，60s sleep/请求才能跑完
 * 必修教材，~25-30 分钟 wall-clock；vision 路径同等任务 ~5 分钟。
 *
 * 边界：
 *   - 不动 packages/llm（worktree 规则），只复用其 export：rasterizePdf / analyzeImageBatch / extractJsonBlock
 *   - 不写 DB（保持 lib 纯净）；caller 通过 onProgress / onChunkPersist 落 DB
 *   - chunk 阶段任意失败立即 throw，但已落盘的 chunk 不丢
 */
import type { subject } from '@hao/db';
import { analyzeImageBatch, extractJsonBlock, rasterizePdf } from '@hao/llm';
import type { KnowledgePointBatch } from '@hao/shared/schemas';
import { KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { buildKpVisionChunkPrompt } from './prompts';

export type TokenUsage = { input: number; output: number } | null;

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  if (!a && !b) return null;
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
  };
}

/**
 * 单 chunk 的完整结果。shape 与 kp-pipeline.ts 的 KpChunkOutcome 完全一致 —
 * 复用 actions.ts 的 ProgressSnapshot / KpAnalysisCache 类型而无需平行声明。
 * `reused=true` 时是从 cache 回放，未真正发 LLM。
 */
export interface KpChunkOutcome {
  chunkIndex: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
  /** chunk LLM 原始文本（应该是 `{ "items": [...] }` JSON）；reused 来自 cache */
  text: string;
  tokenUsage: TokenUsage;
  latencyMs: number;
  retries: number;
  reused: boolean;
  itemCount: number | null;
  capturedAt: string;
  sourceJobId: string | null;
}

/** 跨 job 累积的缓存；key = `vision/${start}-${end}`（带前缀，与 converse cache 隔离） */
export interface KpAnalysisCache {
  byRange: Record<string, KpChunkOutcome>;
}

export type KpProgressEvent =
  | { type: 'plan'; pageCount: number; ranges: Array<{ start: number; end: number }> }
  | {
      type: 'chunk_start';
      chunkIndex: number;
      totalChunks: number;
      startPage: number;
      endPage: number;
      reused: boolean;
    }
  | {
      type: 'chunk_done';
      chunkIndex: number;
      totalChunks: number;
      startPage: number;
      endPage: number;
      latencyMs: number;
      tokenUsage: TokenUsage;
      retries: number;
      reused: boolean;
      itemCount: number | null;
    }
  | { type: 'sleep'; seconds: number; reason: 'between_requests' }
  | { type: 'merge_start' }
  | {
      type: 'merge_done';
      itemCount: number;
      droppedDuplicates: number;
      droppedInvalid: number;
      chunksUnparseable: number;
    }
  | { type: 'error'; stage: 'plan' | 'chunk' | 'merge'; chunkIndex?: number; error: unknown };

export interface KpAnalysisOptions {
  providerId: string;
  pdfPath: string;
  subject: subject;
  cache?: KpAnalysisCache;
  onChunkPersist?: (outcome: KpChunkOutcome) => Promise<void> | void;
  onProgress?: (ev: KpProgressEvent) => void;
  /** 每片喂 LLM 的页数，默认 3 */
  pagesPerCall?: number;
  /** pdftoppm 渲染 DPI，默认 150 */
  dpi?: number;
  /** chunk 之间 sleep 秒数；默认 8（vision 路径实测不撞 429） */
  delayBetweenRequestsSeconds?: number;
  maxChunkTokens?: number;
  maxRetries?: number;
  jobId: string;
}

export interface KpAnalysisResult {
  pageCount: number;
  chunkPages: number;
  chunks: KpChunkOutcome[];
  items: KnowledgePointBatch['items'];
  merge: {
    rawCount: number;
    droppedDuplicates: number;
    droppedInvalid: number;
    chunksUnparseable: number;
  };
  representativeRequestPayload: object | null;
  totalTokenUsage: TokenUsage;
  totalLatencyMs: number;
}

const DEFAULT_PAGES_PER_CALL = 3;
const DEFAULT_DPI = 150;
const DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS = 8;
const DEFAULT_MAX_CHUNK_TOKENS = 4000;
const DEFAULT_MAX_RETRIES = 2;

/** cache key 前缀；防止读到旧 converse 跑出来的 chunksCache 误命中。 */
const VISION_CACHE_PREFIX = 'vision/';
function visionRangeKey(start: number, end: number): string {
  return `${VISION_CACHE_PREFIX}${start}-${end}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LooseKp {
  name?: unknown;
  chapter_no?: unknown;
  brief?: unknown;
}

export function countChunkItems(text: string): number | null {
  try {
    const obj = extractJsonBlock(text) as { items?: unknown };
    if (Array.isArray(obj?.items)) return obj.items.length;
    return null;
  } catch {
    return null;
  }
}

/** 与 kp-pipeline.ts::mergeChunkItems 行为一致；vision 输出 shape 完全相同。 */
function mergeChunkItems(chunks: KpChunkOutcome[]): {
  items: KnowledgePointBatch['items'];
  droppedDuplicates: number;
  droppedInvalid: number;
  chunksUnparseable: number;
  rawCount: number;
} {
  const seen = new Map<string, { name: string; chapter_no: string | null; brief: string }>();
  let droppedDuplicates = 0;
  let droppedInvalid = 0;
  let chunksUnparseable = 0;
  let rawCount = 0;

  for (const c of chunks) {
    let parsed: { items?: unknown } | null = null;
    try {
      parsed = extractJsonBlock(c.text) as { items?: unknown };
    } catch {
      chunksUnparseable += 1;
      continue;
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      chunksUnparseable += 1;
      continue;
    }

    for (const raw of parsed.items as LooseKp[]) {
      rawCount += 1;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (name.length < 2 || name.length > 50) {
        droppedInvalid += 1;
        continue;
      }
      const chapter_no =
        typeof raw.chapter_no === 'string' && raw.chapter_no.trim() !== ''
          ? raw.chapter_no.trim()
          : null;
      const brief = typeof raw.brief === 'string' ? raw.brief.trim() : '';

      const key = name.replace(/\s+/g, '').toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { name, chapter_no, brief });
      } else {
        droppedDuplicates += 1;
        if (brief.length > existing.brief.length) existing.brief = brief;
        if (!existing.chapter_no && chapter_no) existing.chapter_no = chapter_no;
      }
    }
  }

  return {
    items: [...seen.values()].map((kp) => ({
      name: kp.name,
      chapter_no: kp.chapter_no,
      brief: kp.brief,
    })),
    droppedDuplicates,
    droppedInvalid,
    chunksUnparseable,
    rawCount,
  };
}

/** 把 1..pageCount 按 pagesPerCall 切成连续区间。 */
function buildVisionRanges(
  pageCount: number,
  pagesPerCall: number,
): Array<{ start: number; end: number }> {
  if (pageCount <= 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 1; start <= pageCount; start += pagesPerCall) {
    const end = Math.min(start + pagesPerCall - 1, pageCount);
    ranges.push({ start, end });
  }
  return ranges;
}

/**
 * 主入口：rasterize → 按 pagesPerCall 切 → 每组 analyzeImageBatch 或读 cache →
 * 手工合并 → schema 校验。任意 chunk 永久失败抛错。
 */
export async function runKpAnalysisVision(opts: KpAnalysisOptions): Promise<KpAnalysisResult> {
  const pagesPerCall = opts.pagesPerCall ?? DEFAULT_PAGES_PER_CALL;
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const delaySeconds = opts.delayBetweenRequestsSeconds ?? DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS;
  const maxChunkTokens = opts.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const onProgress = opts.onProgress ?? (() => {});
  const cache = opts.cache?.byRange ?? {};

  const wallStart = Date.now();

  // 一次性渲染整本 —— 简单可控；如果将来要懒渲，按 chunk 边界 firstPage/lastPage 调
  // rasterizePdf 即可。整本 ~200 页 @ 150 DPI 在 macOS 上 < 30s + 几百 MB 内存峰值。
  let pages: Awaited<ReturnType<typeof rasterizePdf>>;
  let ranges: Array<{ start: number; end: number }>;
  try {
    pages = await rasterizePdf(opts.pdfPath, { dpi });
    ranges = buildVisionRanges(pages.length, pagesPerCall);
  } catch (err) {
    onProgress({ type: 'error', stage: 'plan', error: err });
    throw err;
  }
  const pageCount = pages.length;
  onProgress({ type: 'plan', pageCount, ranges });

  // pages 按 page 排序后是 1-based 连续，按下标 page-1 即可取。
  const pageByNum = new Map<number, (typeof pages)[number]>();
  for (const p of pages) pageByNum.set(p.page, p);

  const chunks: KpChunkOutcome[] = [];
  let lastRequestPayload: object | null = null;
  let totalTokens: TokenUsage = null;

  for (const [i, range] of ranges.entries()) {
    const chunkIndex = i + 1;
    const rangeKey = visionRangeKey(range.start, range.end);
    const cachedHit = cache[rangeKey];

    onProgress({
      type: 'chunk_start',
      chunkIndex,
      totalChunks: ranges.length,
      startPage: range.start,
      endPage: range.end,
      reused: !!cachedHit,
    });

    let outcome: KpChunkOutcome;

    if (cachedHit) {
      outcome = {
        ...cachedHit,
        chunkIndex,
        totalChunks: ranges.length,
        reused: true,
        latencyMs: 0,
      };
    } else {
      try {
        const images: Parameters<typeof analyzeImageBatch>[0]['images'] = [];
        for (let p = range.start; p <= range.end; p += 1) {
          const pg = pageByNum.get(p);
          if (!pg) throw new Error(`rasterize 缺第 ${p} 页（共 ${pageCount} 页）`);
          images.push({
            bytes: pg.png,
            format: 'png',
            name: `page-${String(p).padStart(3, '0')}`,
          });
        }

        const result = await analyzeImageBatch({
          providerId: opts.providerId,
          images,
          prompt: buildKpVisionChunkPrompt(opts.subject, {
            chunkIndex,
            totalChunks: ranges.length,
            startPage: range.start,
            endPage: range.end,
            pageImageCount: images.length,
          }),
          maxOutputTokens: maxChunkTokens,
          maxRetries,
        });

        if (!result.text.trim()) {
          throw new Error(
            `Chunk ${chunkIndex} (pages ${range.start}-${range.end}) returned empty text from LLM`,
          );
        }

        outcome = {
          chunkIndex,
          totalChunks: ranges.length,
          startPage: range.start,
          endPage: range.end,
          text: result.text,
          tokenUsage: result.tokenUsage,
          latencyMs: result.latencyMs,
          retries: result.retries,
          reused: false,
          itemCount: countChunkItems(result.text),
          capturedAt: new Date().toISOString(),
          sourceJobId: opts.jobId,
        };
        lastRequestPayload = result.requestPayload;
      } catch (err) {
        onProgress({ type: 'error', stage: 'chunk', chunkIndex, error: err });
        throw err;
      }
    }

    chunks.push(outcome);
    if (!outcome.reused) {
      totalTokens = addTokenUsage(totalTokens, outcome.tokenUsage);
      try {
        await opts.onChunkPersist?.(outcome);
      } catch (persistErr) {
        console.warn(
          `[kp-pipeline-vision] onChunkPersist fail for chunk ${chunkIndex} (${rangeKey}):`,
          persistErr,
        );
      }
    }

    onProgress({
      type: 'chunk_done',
      chunkIndex,
      totalChunks: ranges.length,
      startPage: range.start,
      endPage: range.end,
      latencyMs: outcome.latencyMs,
      tokenUsage: outcome.tokenUsage,
      retries: outcome.retries,
      reused: outcome.reused,
      itemCount: outcome.itemCount,
    });

    const moreNonReusedAhead = ranges
      .slice(i + 1)
      .some((r) => !cache[visionRangeKey(r.start, r.end)]);
    if (delaySeconds > 0 && !outcome.reused && moreNonReusedAhead) {
      onProgress({ type: 'sleep', seconds: delaySeconds, reason: 'between_requests' });
      await sleep(delaySeconds * 1000);
    }
  }

  // ── 手工合并 ──────────────────────────────────────────
  onProgress({ type: 'merge_start' });
  let merged: ReturnType<typeof mergeChunkItems>;
  try {
    merged = mergeChunkItems(chunks);
  } catch (err) {
    onProgress({ type: 'error', stage: 'merge', error: err });
    throw err;
  }

  const safe = KnowledgePointBatchSchema.safeParse({ items: merged.items });
  if (!safe.success) {
    const issues = JSON.stringify(safe.error.issues).slice(0, 400);
    const err = new Error(`合并后的 items 不符合 KnowledgePointBatchSchema: ${issues}`);
    onProgress({ type: 'error', stage: 'merge', error: err });
    throw err;
  }

  onProgress({
    type: 'merge_done',
    itemCount: safe.data.items.length,
    droppedDuplicates: merged.droppedDuplicates,
    droppedInvalid: merged.droppedInvalid,
    chunksUnparseable: merged.chunksUnparseable,
  });

  return {
    pageCount,
    chunkPages: pagesPerCall,
    chunks,
    items: safe.data.items,
    merge: {
      rawCount: merged.rawCount,
      droppedDuplicates: merged.droppedDuplicates,
      droppedInvalid: merged.droppedInvalid,
      chunksUnparseable: merged.chunksUnparseable,
    },
    representativeRequestPayload: lastRequestPayload,
    totalTokenUsage: totalTokens,
    totalLatencyMs: Date.now() - wallStart,
  };
}
