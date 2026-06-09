/**
 * @deprecated bedrock_converse 路径在 Webex proxy 上 429 触发率过高（必修教材
 * 60s sleep/请求才能跑完，~25-30 分钟 wall-clock）。已切到 lib/kp-pipeline-vision.ts
 * （pdftoppm + Gemini vision），同等任务 ~5 分钟。
 *
 * 本文件保留作回滚保底；新业务不要再调 runKpAnalysis。
 *
 * 详见 main commit a1f4865（packages/llm 软弃用决策）。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { subject } from '@hao/db';
/**
 * KP 解析流水线 v2 — 在 admin 这一层重写 analyzePdf 的循环，加两个核心能力：
 *
 *   1. **每片 chunk 落盘缓存（resume-aware）**：每完成一个 PDF 切片就回调
 *      `onChunkPersist`，caller 立刻把 chunk text 写到 llm_parse_job.raw_response
 *      .chunksCache[`${start}-${end}`]。失败重试时 caller 把同 upload_id 已有的
 *      chunksCache 全部聚合传进 `cache` 参数 → 命中即复用，跳过 LLM。
 *
 *   2. **手工合并替代 LLM 终审**：chunk 阶段已经按 v3 颗粒度规范吐 KP JSON
 *      数组，整本 KP 在 admin 用 TS 去重 + chapter_no 归并即可。砍掉终审有
 *      硬实证：webex-claude-opus-4.7-converse 实际把 max_tokens 卡在 ~4096
 *      token，整本必修一 200+ KP 的 JSON 必然截 → "Unterminated string in
 *      JSON at position 4355" 一来一回炸掉整轮（25-30 min wall-clock）。
 *      去 LLM 终审后，输出长度问题不再是单点失败源；同义词合并的 recall 略降，
 *      v0.1 MVP 阶段可接受，后续如要恢复 LLM 终审建议改成"分批提交去重列表"
 *      的滚动合并模式（避开 4k 输出上限）。
 *
 * 边界：
 *   - 不动 packages/llm（worktree 规则），只复用其 export 的零件：
 *     buildPageRanges / extractPdfChunk / getPdfPageCount / callLLM / extractJsonBlock
 *   - 不写 DB（保持 lib 纯净）；caller 通过 onProgress / onChunkPersist 落 DB
 *   - chunk 阶段任意失败立即 throw，但已落盘的 chunk 不丢（caller 决定是否标 job=failed）
 */
import {
  buildPageRanges,
  callLLM,
  extractJsonBlock,
  extractPdfChunk,
  getPdfPageCount,
} from '@hao/llm';
import type { KnowledgePointBatch } from '@hao/shared/schemas';
import { KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { buildKpChunkPrompt } from './prompts';

export type TokenUsage = { input: number; output: number } | null;

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  if (!a && !b) return null;
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
  };
}

/**
 * 单 chunk 的完整结果。`reused=true` 时是从 cache 回放，未真正发 LLM。
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
  /** 该片解析出的 items 数量；chunk JSON 解析失败为 null */
  itemCount: number | null;
  capturedAt: string;
  /** 命中 cache 时，原始来源 jobId；否则当前 jobId（caller 注入） */
  sourceJobId: string | null;
}

/** 跨 job 累积的缓存；key = `${start}-${end}` */
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
      /** true → 即将从 cache 复用，跳过 LLM 调用 */
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
  /** 已有缓存；命中即跳过 LLM。caller 应聚合同 upload_id 下所有 jobs 的 chunksCache */
  cache?: KpAnalysisCache;
  /** 每完成一片（含 reused）就回调；caller 把它落到 llm_parse_job.raw_response.chunksCache */
  onChunkPersist?: (outcome: KpChunkOutcome) => Promise<void> | void;
  onProgress?: (ev: KpProgressEvent) => void;
  chunkPages?: number;
  delayBetweenRequestsSeconds?: number;
  maxChunkTokens?: number;
  maxRetries?: number;
  /** 写入 outcome.sourceJobId 的当前 job id（用于审计 chunk 出处） */
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
  /** chunk 阶段最后一次实发 LLM 的 body（caller 仍需 redactAuthHeaders 后入库） */
  representativeRequestPayload: object | null;
  totalTokenUsage: TokenUsage;
  /** 总 wall-clock（含 sleep；reused chunk 计 0） */
  totalLatencyMs: number;
}

const DEFAULT_CHUNK_PAGES = 15;
const DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS = 60;
// 单 chunk 输出 KP JSON：v3 颗粒度下 15 页通常 5-15 条 KP × ~80 字 = 1.5k token，
// 4000 给中文长 brief 留余量；同时仍低于 webex 实测 ~4096 输出上限的边界。
const DEFAULT_MAX_CHUNK_TOKENS = 4000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LooseKp {
  name?: unknown;
  chapter_no?: unknown;
  brief?: unknown;
}

/**
 * 从 chunk text 抽 items 数（用于 cache 回写时记 itemCount）；不合法 JSON 返回 null。
 */
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
 * 手工合并 — chunk text 里的 items 全部解析后按 normalized name 去重。
 *  - name: trim + 去全部空白 + 小写 → key
 *  - 命中已存在 key：brief 取更长；chapter_no 优先取已存在的（先到优先 ≈ 最早 chunk）
 *  - name 长度不在 [2,50]、subject 字段缺失 → 视为 invalid 丢
 */
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
        // brief 取更长；chapter_no 缺失就补
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

/**
 * 主入口：分片 → 每片 callLLM 或读 cache → 手工合并 → schema 校验 → 返回结果。
 * 任意 chunk 永久失败抛错；已 onChunkPersist 写盘的 chunk 不会丢，caller 可在
 * 下次重试时通过 cache 复用。
 */
export async function runKpAnalysis(opts: KpAnalysisOptions): Promise<KpAnalysisResult> {
  const chunkPages = opts.chunkPages ?? DEFAULT_CHUNK_PAGES;
  const delaySeconds = opts.delayBetweenRequestsSeconds ?? DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS;
  const maxChunkTokens = opts.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const onProgress = opts.onProgress ?? (() => {});
  const cache = opts.cache?.byRange ?? {};

  const wallStart = Date.now();
  let pageCount: number;
  let ranges: Array<{ start: number; end: number }>;
  try {
    pageCount = await getPdfPageCount(opts.pdfPath);
    ranges = buildPageRanges(pageCount, chunkPages);
  } catch (err) {
    onProgress({ type: 'error', stage: 'plan', error: err });
    throw err;
  }
  onProgress({ type: 'plan', pageCount, ranges });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hao-admin-pdf-chunks-'));
  const chunks: KpChunkOutcome[] = [];
  let lastRequestPayload: object | null = null;
  let totalTokens: TokenUsage = null;

  try {
    for (const [i, range] of ranges.entries()) {
      const chunkIndex = i + 1;
      const rangeKey = `${range.start}-${range.end}`;
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
        // 复用：保留原 sourceJobId / capturedAt / itemCount，重置 chunkIndex/totalChunks
        // 因为本轮的总片数 / 当前 idx 与缓存写入那轮可能不同（chunkPages 不变前提下其实一致）
        outcome = {
          ...cachedHit,
          chunkIndex,
          totalChunks: ranges.length,
          reused: true,
          // 复用片不计入本轮 wall-clock
          latencyMs: 0,
        };
      } else {
        const chunkFileName = `chunk-${String(chunkIndex).padStart(3, '0')}-pages-${range.start}-${range.end}.pdf`;
        const chunkPath = path.join(tmpDir, chunkFileName);
        try {
          await extractPdfChunk({
            pdfPath: opts.pdfPath,
            chunkPath,
            startPage: range.start,
            endPage: range.end,
          });
          const base64 = (await readFile(chunkPath)).toString('base64');

          const t0 = Date.now();
          const result = await callLLM<string>({
            providerId: opts.providerId,
            prompt: buildKpChunkPrompt(opts.subject, {
              chunkIndex,
              totalChunks: ranges.length,
              startPage: range.start,
              endPage: range.end,
            }),
            attachments: [
              {
                kind: 'pdf',
                format: 'pdf',
                name: `pdf-chunk-${String(chunkIndex).padStart(3, '0')}-pages-${range.start}-${range.end}`,
                base64,
              },
            ],
            maxOutputTokens: maxChunkTokens,
            maxRetries,
          });

          if (!result.rawText.trim()) {
            throw new Error(
              `Chunk ${chunkIndex} (pages ${range.start}-${range.end}) returned empty text from LLM`,
            );
          }

          outcome = {
            chunkIndex,
            totalChunks: ranges.length,
            startPage: range.start,
            endPage: range.end,
            text: result.rawText,
            tokenUsage: result.tokenUsage,
            latencyMs: Date.now() - t0,
            retries: result.retries,
            reused: false,
            itemCount: countChunkItems(result.rawText),
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
          // 落盘失败不阻断解析（progress patch 是 best-effort），但要把它打到日志
          console.warn(
            `[kp-pipeline] onChunkPersist fail for chunk ${chunkIndex} (${rangeKey}):`,
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

      // 仅在"实发 LLM 且后面还有 chunk"时 sleep（reused 不计入 rate-limit 配额）；
      // 终审已砍掉，最后一片之后无需再 sleep。
      const moreNonReusedAhead = ranges.slice(i + 1).some((r) => !cache[`${r.start}-${r.end}`]);
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
      chunkPages,
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
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
