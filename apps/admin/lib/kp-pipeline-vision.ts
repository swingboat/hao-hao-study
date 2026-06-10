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
import { LLMHttpError, LLMSchemaError, analyzeImageBatch, extractJsonBlock, rasterizePdf } from '@hao/llm';
import type { KnowledgePointBatch } from '@hao/shared/schemas';
import { KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { z } from 'zod';
import { buildKpVisionChunkPrompt } from './prompts';

/**
 * 跨模块安全的错误类型识别。
 *
 * 为什么不用 `err instanceof LLMHttpError`：Next.js dev HMR 会把 @hao/llm 编译成
 * 多份独立模块（callLLM 内部 throw 的实例 vs 本文件 import 的 class 不是同一份），
 * 导致 instanceof 误返 false → split fallback 被跳过 → HTTP 500 chunk 直接失败而不
 * 重试。LLMHttpError / LLMSchemaError 都在构造里设了 `override readonly name`，按
 * 名字识别更稳。生产 build 不存在重复模块也能命中。
 *
 * 实测：job 0ec05f32 chunk 18 (pages 35-36) 撞到本 bug — 三次 500 后 callLLM 抛
 * LLMHttpError，但 `err instanceof LLMHttpError` 返 false，被当成不可恢复错误，
 * 没走 split fallback。
 */
function isLLMHttpError(err: unknown): err is LLMHttpError {
  return err instanceof Error && err.name === 'LLMHttpError';
}
function isLLMSchemaError(err: unknown): err is LLMSchemaError {
  return err instanceof Error && err.name === 'LLMSchemaError';
}

/**
 * Chunk 级 schema —— 喂给 analyzeImageBatch / callLLM 触发"JSON 解析失败 → 重试"路径。
 *
 * 不复用 packages/shared 的 KnowledgePointParsedSchema：
 *   1. 上层 KnowledgePointBatchSchema 强制 `items.min(1)`，但 vision 管线里教材
 *      封面/目录/空白页/整页插图等返回 `{ "items": [] }` 是合法的，套 min(1) 会让
 *      callLLM 把这些正常空响应当成 schema 不通过去无谓重试 N 次。
 *   2. 我们要在 chunk 级新增 `chapter_title`（vision-v3）—— 这字段不入 knowledge_point
 *      正式表，只挂 staging.llm_payload 给 UI 显示用，所以放在 admin worktree 这边定义。
 *
 * 真正想拦的是 Webex Gemini 偶发的"流截断 → JSON 残缺"（实测 13%）和章节标题缺失：schema
 * 触发 extractJsonBlock 抛错 → callLLM 自动重试，命中率 1-13%^3 ≈ 99.8%；callLLM 实在
 * 跑满 maxRetries 才抛 LLMSchemaError，runOne 捕获后整片 chunk 失败 —— 不会把残缺文本
 * 写进 cache（cache 持久化在 runOne 后段，永远在 callLLM throw 之后才执行）。
 */
const ChunkKpItemSchema = z.object({
  name: z.string().min(2).max(50),
  chapter_no: z.string().max(20).nullable().optional(),
  /** 章节文字标题（不含编号本身），如 "平面向量及其应用"；读不到就 null */
  chapter_title: z.string().max(80).nullable().optional(),
  brief: z.string().max(200).optional(),
});
const ChunkKpItemsSchema = z.object({
  items: z.array(ChunkKpItemSchema).max(500),
});

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
  | {
      /**
       * 单片永久失败（schema retry / HTTP 500 / 网络错误等都耗尽 callLLM 自带 maxRetries 后）。
       * pipeline 会**继续跑**剩余 chunk —— 这是 fail-soft，不是终态；
       * 终态由 `merge_done`/`error{stage:'plan'|'merge'}` 表达。
       * UI 把它作为可恢复 warning（"N 片永久失败，点重新解析会自动补"）展示。
       */
      type: 'chunk_failed';
      chunkIndex: number;
      totalChunks: number;
      startPage: number;
      endPage: number;
      reason: string;
    }
  | { type: 'merge_start' }
  | {
      type: 'merge_done';
      itemCount: number;
      droppedDuplicates: number;
      droppedInvalid: number;
      chunksUnparseable: number;
      chunksFailed: number;
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
    /**
     * 永久失败的 chunk 数（callLLM 自带重试耗尽后仍 throw 的）。
     * 不进 cache，下次 reparse 会自动重抽。详见 `chunkFailures`。
     */
    chunksFailed: number;
  };
  /**
   * 失败 chunk 详情。`reason` 是错误 message 摘要，给 UI 展示用。
   * 长度 = `merge.chunksFailed`。空数组表示全部成功。
   */
  chunkFailures: Array<{
    chunkIndex: number;
    startPage: number;
    endPage: number;
    reason: string;
  }>;
  /**
   * vision-v3：chapter_no → chapter_title 映射（merge 时跨分片择优出来的）。
   * caller（actions.ts）应把对应 title 写到每条 staging 的 llm_payload.chapter_title，
   * 这样 admin/kps 列表页能把"第 6 章"显示成"第 6 章 平面向量及其应用"。
   * 缺少 title 的 chapter（LLM 全分片都没识别出标题）不在此 map 内；UI 兜底到光数字。
   */
  chapterTitles: Map<string, string>;
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
// 8 路并发：实测 4 路对 94 片 ~460s wall-clock，长尾 12 片重试拖到 ~50min；
// 提到 8 路理论减半 ~230s，Webex Gemini 路径 4 路时 0 个 429，8 路撞 429 由
// callLLM 的 Retry-After 退避兜底。再大（16 路）proxy 队列会显著退化，先停在 8。
const DEFAULT_CONCURRENCY = 8;

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
  /** vision-v3 新增；merge 时按 chapter_no 聚合最高频值，不进 KP 主体 */
  chapter_title?: unknown;
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

/**
 * 与 kp-pipeline.ts::mergeChunkItems 行为一致；vision 输出 shape 完全相同。
 *
 * v3 新增：跨 chunk 收集 chapter_no → chapter_title 的最高频映射。同一 chapter_no
 * 在不同 chunk 里 LLM 可能给出略有差异的标题（如 "平面向量" vs "平面向量及其应用"）；
 * 取出现次数最多的；并列时取首次见到的（隐式按 chunk 顺序）。
 */
function mergeChunkItems(chunks: KpChunkOutcome[]): {
  items: KnowledgePointBatch['items'];
  droppedDuplicates: number;
  droppedInvalid: number;
  chunksUnparseable: number;
  rawCount: number;
  /** chapter_no → chapter_title（多分片择优 / 缺失为 null） */
  chapterTitles: Map<string, string>;
} {
  const seen = new Map<string, { name: string; chapter_no: string | null; brief: string }>();
  // chapter_no → 标题计数器；title=null 不计数（缺失片不影响有数据片的择优）
  const titleCounts = new Map<string, Map<string, number>>();
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

      // chapter_title 计数：仅当 chapter_no 与 title 都给且非空时累加
      const chapter_title =
        typeof raw.chapter_title === 'string' && raw.chapter_title.trim() !== ''
          ? raw.chapter_title.trim()
          : null;
      if (chapter_no && chapter_title) {
        let counts = titleCounts.get(chapter_no);
        if (!counts) {
          counts = new Map();
          titleCounts.set(chapter_no, counts);
        }
        counts.set(chapter_title, (counts.get(chapter_title) ?? 0) + 1);
      }

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

  // 把 titleCounts 化简成 chapter_no → 最高频 title（并列取首个见到的，
  // Map 迭代顺序就是插入顺序，正好匹配 chunk 顺序）
  const chapterTitles = new Map<string, string>();
  for (const [chap, counts] of titleCounts) {
    let bestTitle: string | undefined;
    let bestCount = -1;
    for (const [t, n] of counts) {
      if (n > bestCount) {
        bestCount = n;
        bestTitle = t;
      }
    }
    if (bestTitle) chapterTitles.set(chap, bestTitle);
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
    chapterTitles,
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
 * 手工合并 → schema 校验。
 *
 * Fail-soft 语义（v3）：
 *   - **plan / merge** 阶段失败 = 整 job 失败（rasterize 不出来或合并 schema 不通过都没救）
 *   - **chunk** 阶段失败 = 单片失败但 pipeline 继续跑剩余 chunk；该片不写 cache → 下次
 *     reparse 会自动重抽。result.chunkFailures 列出失败片，UI 当 warning 展示。
 *   - 仅当**所有 chunk 都失败**才整 job throw（一般是 provider 完全挂了）
 *
 * 之前是"任一 chunk 失败立即 throw" → Webex Gemini 偶发 500 会让一片拖垮全本 141 片任务。
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
  // 单片错误 fail-soft：记进 chunkFailures，不写 cache，pipeline 继续跑余下 chunk。
  // 这样 Webex Gemini 偶发 500（实测每跑全本 141 片就有 1-2 片中招）不会一票否决整个 job。
  let nextIdx = 0;
  const chunkFailures: Array<{
    chunkIndex: number;
    startPage: number;
    endPage: number;
    reason: string;
  }> = [];

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

      // 整片调一次；如果是 schema 失败（大概率是 Webex Gemini 输出 cap ~2000 token
      // 撞到上限被截断 → JSON 不完整），且 range>1 页，回退到"每页单独抽"逐页跑，
      // 把各页 items 合并成一个合成 text 顶替整片。
      // 单页输出量 ≤ ~1500 token，几乎不会再撞 cap。
      let result: Awaited<ReturnType<typeof analyzeImageBatch>>;
      let synthesizedFromSplit = false;
      let totalRetries = 0;
      try {
        result = await analyzeImageBatch({
          providerId: opts.providerId,
          images,
          prompt: buildKpVisionChunkPrompt(opts.subject, {
            chunkIndex,
            totalChunks: ranges.length,
            startPage: range.start,
            endPage: range.end,
            pageImageCount: images.length,
          }),
          // schema 触发 callLLM 内部"JSON 残缺 → 自动重试 + 严格 JSON 提示"路径。
          // 修复 Webex Gemini SSE 流截断（实测 13% chunk text 中途被切，结果是
          // {"items":[{...}, {"name":"...", "chapter_no":"6.2 ← 半截字符串导致整片
          // 不可解析、KP 全部丢失）；之前 analyzeImageBatch 没传 schema，callLLM 收到
          // 200 OK 就当成功 →    不重试 → 残缺文本进 cache → 全本约 14% KP 永久丢失。
          schema: ChunkKpItemsSchema,
          maxOutputTokens: maxChunkTokens,
          // 首调 fail-fast：实测重试 1-2 次还是 fail 的多半是稳定问题（输出 cap 撞顶 /
          // 双页 prompt 触 5xx），同输入再试一遍只是浪费 30-60s。直接 throw → 走下面
          // 拆页 fallback，命中率明显高（split 后单页 prompt 小、输出量更小）。每片省
          // 60-90s × 受影响 chunk 数（~20%）就是 wall-clock 净收益。
          // SSE 流截断这种瞬时问题让末段重试一轮兜底（pipeline 末尾的串行 retry pass）。
          maxRetries: 0,
        });
      } catch (err) {
        const isRecoverable = isLLMSchemaError(err) || isLLMHttpError(err);
        if (!isRecoverable || images.length <= 1) throw err;

        // 拆页兜底：逐页跑一遍，items 合并 → 合成 chunk text。
        // 触发场景：
        //   - LLMSchemaError：Webex Gemini 输出 cap ~2000 token 撞顶 → JSON 截断
        //   - LLMHttpError：Webex proxy 偶发 5xx（双页 prompt 大、proxy 负载敏感）
        // 单页跑时输出量 ≤ ~1500 token 且 prompt 更短，两种错误命中率都明显降。
        //
        // 单页失败不连累其它页：单 page 自己 try/catch 把 reason 记下，successful
        // 子页的 items 仍然合入合成 text。原行为是一页 fail 整片丢，太脆。
        console.warn(
          `[kp-pipeline-vision] chunk ${chunkIndex} (pages ${range.start}-${range.end}) ${isLLMSchemaError(err) ? 'schema' : 'http'} fail, splitting into ${images.length} per-page calls`,
        );
        const subResults: Array<Awaited<ReturnType<typeof analyzeImageBatch>>> = [];
        const subFailures: Array<{ page: number; reason: string }> = [];
        for (let pi = 0; pi < images.length; pi += 1) {
          const img = images[pi]!;
          const page = range.start + pi;
          try {
            const r = await analyzeImageBatch({
              providerId: opts.providerId,
              images: [img],
              prompt: buildKpVisionChunkPrompt(opts.subject, {
                chunkIndex,
                totalChunks: ranges.length,
                startPage: page,
                endPage: page,
                pageImageCount: 1,
              }),
              schema: ChunkKpItemsSchema,
              maxOutputTokens: maxChunkTokens,
              maxRetries,
            });
            subResults.push(r);
          } catch (subErr) {
            const reason = subErr instanceof Error ? subErr.message : String(subErr);
            subFailures.push({ page, reason });
            console.warn(
              `[kp-pipeline-vision] chunk ${chunkIndex} sub-page ${page} also failed: ${reason.slice(0, 200)}`,
            );
          }
        }

        // 全员阵亡 → 没救，把第一个失败原因抛出去，进 chunkFailures
        if (subResults.length === 0) {
          const firstReason = subFailures[0]?.reason ?? '<unknown>';
          throw new Error(`split fallback 全部失败: ${firstReason}`);
        }

        // 合成 text：解析每个子结果的 items 数组拼起来再 stringify
        const mergedItems: unknown[] = [];
        for (const r of subResults) {
          try {
            const obj = extractJsonBlock(r.text) as { items?: unknown };
            if (Array.isArray(obj.items)) mergedItems.push(...obj.items);
          } catch {
            /* 解析不出来就跳过；其它页的 KP 不受影响 */
          }
        }
        const combinedText = JSON.stringify({ items: mergedItems });
        const totalIn = subResults.reduce((s, r) => s + (r.tokenUsage?.input ?? 0), 0);
        const totalOut = subResults.reduce((s, r) => s + (r.tokenUsage?.output ?? 0), 0);
        const totalLatency = subResults.reduce((s, r) => s + r.latencyMs, 0);
        totalRetries = subResults.reduce((s, r) => s + r.retries, 0);
        if (subFailures.length > 0) {
          console.warn(
            `[kp-pipeline-vision] chunk ${chunkIndex} partial recovery: ${subResults.length}/${images.length} pages OK, ${subFailures.length} dropped (${mergedItems.length} items merged)`,
          );
        }
        result = {
          text: combinedText,
          tokenUsage: totalIn || totalOut ? { input: totalIn, output: totalOut } : null,
          latencyMs: totalLatency,
          retries: totalRetries,
          requestPayload: subResults[0]?.requestPayload ?? {},
          // analyzeImageBatch 返回里有 data 字段；合成 chunk 不再做 schema 校验，data 留空对象
          data: undefined as unknown as never,
        } as Awaited<ReturnType<typeof analyzeImageBatch>>;
        synthesizedFromSplit = true;
      }

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
        retries: synthesizedFromSplit ? totalRetries : result.retries,
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
    while (true) {
      const i = nextIdx++;
      if (i >= ranges.length) return;
      const range = ranges[i];
      if (!range) return; // TS narrow，不会发生
      try {
        await runOne(i);
      } catch (err) {
        // Fail-soft：单片错误不停整个 pipeline。runOne 在出错前不会走到 onChunkPersist，
        // 所以失败片不会写 cache —— 下次 reparse 自动重抽。
        const reason = err instanceof Error ? err.message : String(err);
        chunkFailures.push({
          chunkIndex: i + 1,
          startPage: range.start,
          endPage: range.end,
          reason,
        });
        onProgress({
          type: 'chunk_failed',
          chunkIndex: i + 1,
          totalChunks: ranges.length,
          startPage: range.start,
          endPage: range.end,
          reason,
        });
        // 同 worker 继续抓下一片，不 return
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, () => worker()));

  // ── 末段重试 ────────────────────────────────────────────
  // Webex Gemini 偶发 500 / proxy 抖动多是瞬时的；并发风暴结束后再试一遍命中率明显升。
  // 串行单线程跑、且每次失败前先 sleep 2s 让 proxy 恢复，比加大 maxRetries 更经济
  // （maxRetries 是每次调用内部连发，对持续 500 没救）。仍失败的 chunk 保留在 chunkFailures，
  // UI 还是会显示 warning，用户点重新解析仍是兜底。
  if (chunkFailures.length > 0 && chunkFailures.length < ranges.length) {
    const toRetry = chunkFailures.splice(0); // 清空原数组，重试后只回填仍失败的
    for (const failure of toRetry) {
      const i = failure.chunkIndex - 1;
      const range = ranges[i];
      if (!range) {
        chunkFailures.push(failure);
        continue;
      }
      await sleep(2000);
      try {
        // runOne 内部已发 chunk_start/chunk_done；这里不再重复
        await runOne(i);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        chunkFailures.push({
          chunkIndex: failure.chunkIndex,
          startPage: range.start,
          endPage: range.end,
          reason,
        });
        onProgress({
          type: 'chunk_failed',
          chunkIndex: failure.chunkIndex,
          totalChunks: ranges.length,
          startPage: range.start,
          endPage: range.end,
          reason,
        });
      }
    }
  }

  // 全军覆没才整 job 失败 —— 一般只在 provider 完全挂了或 prompt 触发安全审查时出现。
  if (chunkFailures.length === ranges.length && ranges.length > 0) {
    const firstReason = chunkFailures[0]?.reason ?? '<unknown>';
    throw new Error(`所有 ${ranges.length} 片 chunk 均失败（首个原因：${firstReason}）`);
  }

  // 失败的 chunk 在 chunks[i] 留下 null 槽位，过滤掉再交给 merge。
  const finalChunks = chunks.filter((c): c is KpChunkOutcome => c !== null);

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
    chunksFailed: chunkFailures.length,
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
      chunksFailed: chunkFailures.length,
    },
    chunkFailures,
    chapterTitles: merged.chapterTitles,
    representativeRequestPayload: lastRequestPayload,
    totalTokenUsage: totalTokens,
    totalLatencyMs: Date.now() - wallStart,
  };
}
