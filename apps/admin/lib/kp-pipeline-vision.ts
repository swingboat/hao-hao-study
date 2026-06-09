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
  /** chunk 之间 sleep 秒数；默认 0（vision + 4 路并发实测不撞 429） */
  delayBetweenRequestsSeconds?: number;
  maxChunkTokens?: number;
  maxRetries?: number;
  /** 并发 worker 数；默认 4。设 1 即退化为串行。 */
  concurrency?: number;
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

const DEFAULT_PAGES_PER_CALL = 2;
const DEFAULT_DPI = 150;
// 实测 94 片 vision 串行跑 0 retry / 0 429（对应 Webex Gemini 3.1 Pro），
// 8s sleep 是从 converse 时代继承的过度保守值。改 0 + concurrency 一起调度。
const DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS = 0;
// webex-gemini-3.1-pro 在 Webex proxy 上实测输出 cap ~2000 token（seed.ts 已据此
// 标 max_output_tokens=2000）。pagesPerCall=2 时单片 KP 数 ≤ ~12，对应输出 ~1500 token，
// 安全地避开 cap。本字段是给 callLLM 的"期望上限"，真上限以 provider 的 max_output_tokens 为准。
const DEFAULT_MAX_CHUNK_TOKENS = 2000;
const DEFAULT_MAX_RETRIES = 2;
// 4 路并发：实测 vision 单片 ~19s LLM；94 片串行 1824s → 4 路 ~460s。Webex Gemini 路径
// 4 路并发实测不触 429；提到 8 路时偶发 429 由 callLLM 的 Retry-After 退避兜底。
const DEFAULT_CONCURRENCY = 4;

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

/**
 * chapter_no 归一：把 LLM 输出统一成「数字 + 点」格式（6 / 6.1 / 6.1.1）。
 *  - 「第六章」→ "6"；「第十二章」→ "12"
 *  - "§6.1" / "§6"  → "6.1" / "6"
 *  - "6.2 平面向量的运算" → "6.2"（取首段数字串）
 *  - 整段无法识别 → null
 *
 * v2 prompt 已要求 LLM 直接输出该格式；此函数兜底处理 v1 旧 cache 数据 + 偶发不服从。
 */
const CHINESE_NUM: Record<string, string> = {
  零: '0',
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};
/** 解析「十、十二、二十、二十一、三十」等汉字基数词到整数；上界 99 够用（章号场景）。 */
function chineseNumToInt(cn: string): number | null {
  if (!cn) return null;
  if (cn === '十') return 10;
  const idx = cn.indexOf('十');
  if (idx === -1) {
    // 纯个位（一/二/.../九/零）
    if (cn.length === 1 && CHINESE_NUM[cn]) return Number(CHINESE_NUM[cn]);
    return null;
  }
  // 含「十」：[tens]十[ones]?，tens 缺省=1，ones 缺省=0
  const tensStr = cn.slice(0, idx);
  const onesStr = cn.slice(idx + 1);
  const tensRaw = tensStr === '' ? '1' : CHINESE_NUM[tensStr];
  const onesRaw = onesStr === '' ? '0' : CHINESE_NUM[onesStr];
  if (!tensRaw || !onesRaw || tensRaw === '10' || onesRaw === '10') return null;
  return Number(tensRaw) * 10 + Number(onesRaw);
}

export function normalizeChapterNo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // 「第X章」/「第XX章」：先把汉字数字段抓出来转阿拉伯
  const cnMatch = s.match(/^第([零一二三四五六七八九十百千]+)章/);
  if (cnMatch) {
    const n = chineseNumToInt(cnMatch[1] ?? '');
    if (n !== null) s = String(n) + s.slice(cnMatch[0].length);
    else return null;
  }

  // 取首段「数字(.数字)*」
  const m = s.match(/(\d+(?:\.\d+)*)/);
  return m?.[1] ?? null;
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
          ? normalizeChapterNo(raw.chapter_no)
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
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
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

  const pageByNum = new Map<number, (typeof pages)[number]>();
  for (const p of pages) pageByNum.set(p.page, p);

  // chunks 预分配，按 index 写入 → 即使并发完成顺序乱，最终数组仍按 chunkIndex 升序，
  // 后续 mergeChunkItems 行为与串行版完全一致（"先到优先"=低 index 先存)。
  const chunks: Array<KpChunkOutcome | null> = new Array(ranges.length).fill(null);
  let lastRequestPayload: object | null = null;
  let totalTokens: TokenUsage = null;

  // ── 并发 worker 池 ─────────────────────────────────────
  // 任一 worker 抛错 → 标 abort，其他 worker 跑完手头那片就退出（避免半死状态）。
  // 第一个错原样上抛；其后的错吞掉避免淹没真正的 root cause。
  let nextIdx = 0;
  let firstError: unknown = null;
  let aborted = false;

  const runOne = async (i: number): Promise<void> => {
    const range = ranges[i];
    if (!range) return; // 不会发生：i 由 nextIdx 守门 < ranges.length；写出来给 TS 收编
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
    }

    chunks[i] = outcome;
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

    if (delaySeconds > 0 && !outcome.reused) {
      onProgress({ type: 'sleep', seconds: delaySeconds, reason: 'between_requests' });
      await sleep(delaySeconds * 1000);
    }
  };

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      try {
        await runOne(i);
      } catch (err) {
        if (!aborted) {
          firstError = err;
          aborted = true;
          onProgress({ type: 'error', stage: 'chunk', chunkIndex: i + 1, error: err });
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, () => worker()));
  if (firstError) throw firstError;

  // 走到这说明所有 chunk 都成功，chunks 数组无 null。
  const finalChunks = chunks as KpChunkOutcome[];

  // ── 手工合并 ──────────────────────────────────────────
  onProgress({ type: 'merge_start' });
  let merged: ReturnType<typeof mergeChunkItems>;
  try {
    merged = mergeChunkItems(finalChunks);
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
    chunks: finalChunks,
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
