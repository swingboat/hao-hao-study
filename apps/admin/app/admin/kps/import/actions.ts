/**
 * F4.3 上传页 server actions（v3：异步 background 解析 + chunk 缓存复用）。
 *
 * 流程：
 *   1. uploadAndParseAction：multipart → 落本地 → 写 content_upload + 预创建 llm_parse_job(queued)
 *      → 把 runParse 用 void 抛进事件循环（不 await）→ 立刻 redirect 到 staging 页
 *   2. runParse 后台跑 admin/lib/kp-pipeline.ts::runKpAnalysis；onProgress 把每个事件
 *      patch 到 llm_parse_job.raw_response.progress；onChunkPersist 把已完成 chunk text
 *      写到 raw_response.chunksCache[`${start}-${end}`]
 *   3. staging 页轮询 getJobProgressAction 看 status / progress；succeeded/failed 后 router.refresh()
 *   4. 重试（reparseUploadAction）时：从同 upload_id 下所有 jobs 聚合 chunksCache → 命中即跳过 LLM
 *
 * 为什么 background：整本教材 25-30 分钟，server action 同步 await 会让浏览器 fetch
 * 长时间挂起（任何反代/网关超时都会中断）。改成「上传完立刻 redirect → 真实进度落 DB → 客户端轮询」
 * 之后：用户秒进 staging 页，能实时看到当前 chunk N/total、token 累计、最近事件；中途关页面也不会
 * 中断后台跑（Node 事件循环把 Promise 跑完），重新打开还能看到结果。
 *
 * 部署注意：
 *   - 本方案依赖 Node 长进程（dev / 自建 Next server / Docker），serverless（Vercel Lambda
 *     单请求生命周期）会在 redirect 返回时 freeze 后台 Promise，必须改用真正的 worker queue。
 *
 * 解析路径分三支（按 provider.protocol + capabilities 选）：
 *   - openai_chat + capabilities.vision=true → kp-pipeline-vision（pdftoppm + Gemini vision，**首选**）
 *   - bedrock_converse                       → kp-pipeline（PDF 分片 + Converse 原生 PDF）@deprecated
 *   - 其他                                   → 老路径（pdf-parse 抽纯文本 → 单次 callLLM）；A/B 兜底
 *
 * provider 选择优先级：vision > converse > 老路径。converse 路径在 Webex proxy 上 429
 * 触发率过高（必修教材 ~25-30 分钟 wall-clock），已软弃用，仅保留作回滚保底。
 */
'use server';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@hao/db';
import { callLLM, redactAuthHeaders } from '@hao/llm';
import { type KnowledgePointBatch, KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { StoragePaths, createStore, extOf, sha256OfBuffer } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
// ⚠️ 不要在顶层 import lib/pdf-extract —— 它链上 pdf-parse → pdfjs-dist，
// pdfjs-dist 在 Next server-action runtime（action-browser）加载时会调
// Object.defineProperty 到一个不存在的全局上，整个 actions 模块加载就崩
// （TypeError: Object.defineProperty called on non-object）。
// 老纯文本路径才需要它，按需 dynamic import 进 runParse 的 else 分支即可。
import {
  type KpAnalysisCache,
  type KpChunkOutcome,
  type KpProgressEvent,
  type TokenUsage,
  addTokenUsage,
  countChunkItems,
  runKpAnalysis,
} from '../../../../lib/kp-pipeline';
import { runKpAnalysisVision } from '../../../../lib/kp-pipeline-vision';
import {
  KP_CONVERSE_PROMPT_VERSION,
  KP_PROMPT_VERSION,
  KP_VISION_PROMPT_VERSION,
  buildKpPrompt,
} from '../../../../lib/prompts';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB，整本教材 PDF 上限。kp-pipeline 按 15 页/片自动切给 LLM
const ACCEPTED_PDF_MIME = ['application/pdf'];

/**
 * 进度快照写到 llm_parse_job.raw_response.progress，shape 见 ProgressSnapshot。
 * job 进 succeeded 时整个 raw_response 会被覆盖为 {final, chunks, pageCount, chunksCache,...}（progress 顺带消失）。
 * 失败时保留 progress + chunksCache + 在 error_message 写原因，方便 UI 显示「在第几片挂的」+ 下次重试复用。
 */
export interface ProgressSnapshot {
  phase: 'planning' | 'chunking' | 'sleeping' | 'merging' | 'done' | 'failed';
  startedAt: string; // ISO
  lastEventAt: string; // ISO
  pageCount?: number;
  chunkPages?: number;
  totalChunks?: number;
  chunksDone: number;
  /** 跨 job 复用的 chunk 数（cache 命中） */
  chunksReused?: number;
  /**
   * 永久失败的 chunk 数（callLLM 自带重试耗尽后仍 throw）。fail-soft 行为：pipeline 不停，
   * 这些片不写 cache → 用户点重新解析会自动补抽。0 表示全部成功或正在跑。
   */
  chunksFailed?: number;
  /** 当前正在跑的 chunk（chunking 阶段有值；sleep/merge/done 阶段为 null） */
  currentChunk?: { index: number; startPage: number; endPage: number; startedAt: string } | null;
  /** 已累计 token（不含当前 in-flight 这一片；reused 片不计入） */
  tokenUsageSoFar: TokenUsage;
  /** 最近一次事件类型，调试用 */
  lastEvent: string;
  /** 累计 chunk 延迟均值，给 UI 算 ETA */
  avgChunkLatencyMs?: number | null;
}

/**
 * patchProgress / persistChunkToCache 都是 read-modify-write 同一行 raw_response。
 * onProgress 回调里 fire-and-forget 跑多个并发 async patch，会互相抹掉字段
 *   （症状：plan 写的 totalChunks 被后到的 chunk_done patch 抹成 undefined）
 * 用 per-job FIFO 链把所有写入串起来。Map 在进程内单例，dev / prod Node 长进程都成立；
 * job 进终态后 entry 也只多占几字节，不主动清理（job 数量 ≪ 内存预算）。
 */
const jobWriteQueues = new Map<string, Promise<void>>();
function enqueueJobWrite(jobId: string, work: () => Promise<void>): Promise<void> {
  const prev = jobWriteQueues.get(jobId) ?? Promise.resolve();
  const next = prev.then(work, work); // 失败时也继续后续 work，不中断队列
  jobWriteQueues.set(jobId, next);
  return next;
}

async function patchProgress(jobId: string, patch: Partial<ProgressSnapshot>): Promise<void> {
  return enqueueJobWrite(jobId, async () => {
    // 先 fetch 再 merge —— raw_response 是 Json，无法直接 path-update。
    // 同时保留 chunksCache（chunk 持久化数据），不让 progress patch 覆盖它。
    const cur = await prisma.llm_parse_job.findUnique({
      where: { id: jobId },
      select: { raw_response: true },
    });
    const rawCur =
      (cur?.raw_response as {
        progress?: ProgressSnapshot;
        chunksCache?: KpAnalysisCache['byRange'];
      } | null) ?? {};
    const prev = rawCur.progress ?? {
      phase: 'planning' as const,
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      chunksDone: 0,
      tokenUsageSoFar: null,
      lastEvent: 'init',
    };
    const merged: ProgressSnapshot = { ...prev, ...patch, lastEventAt: new Date().toISOString() };
    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        raw_response: {
          progress: merged,
          ...(rawCur.chunksCache ? { chunksCache: rawCur.chunksCache } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * 把 chunk outcome 写到 raw_response.chunksCache[`${start}-${end}`]，与 progress 共存。
 * 同样走 jobWriteQueues 串行化，避免和 patchProgress 互相抹字段；
 * 失败仅 console.warn —— 缓存丢了大不了下次重试再跑一遍这片。
 *
 * keyPrefix 用于隔离 converse / vision 两条路径的缓存（vision 传 `vision/`，converse 传 ''）。
 */
async function persistChunkToCache(
  jobId: string,
  outcome: KpChunkOutcome,
  keyPrefix: string,
): Promise<void> {
  return enqueueJobWrite(jobId, async () => {
    const cur = await prisma.llm_parse_job.findUnique({
      where: { id: jobId },
      select: { raw_response: true },
    });
    const rawCur =
      (cur?.raw_response as {
        progress?: ProgressSnapshot;
        chunksCache?: KpAnalysisCache['byRange'];
      } | null) ?? {};
    const cache = { ...(rawCur.chunksCache ?? {}) };
    cache[`${keyPrefix}${outcome.startPage}-${outcome.endPage}`] = outcome;
    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        raw_response: {
          ...(rawCur.progress ? { progress: rawCur.progress } : {}),
          chunksCache: cache,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * 从同一 upload_id 下所有 jobs 聚合 chunksCache，给本轮 runParse 用作 resume 池。
 *   - 优先源：之前 job 的 raw_response.chunksCache（v3 格式，包含完整 outcome）
 *   - 次优先：v2 succeeded job 的 raw_response.chunks 数组（v2 格式；缺 capturedAt 等字段，转一下补齐）
 * 同 (start,end) 多源命中时，**先到的优先**（外层迭代按 created_at desc，遇见已 set 的 key 跳过 →
 * 更新的 cache 其实是更可信的；但旧片缓存也不会因此被丢弃，因为新 job 的 chunksCache 本身已经
 * 把它复用过的片继承了下来）。这里用 created_at asc 让"老 job 的片先入坑、新 job 覆盖"更直观。
 */
async function loadCacheForUpload(uploadId: string): Promise<KpAnalysisCache> {
  const jobs = await prisma.llm_parse_job.findMany({
    where: { upload_id: uploadId, task_kind: 'knowledge_point' },
    orderBy: { created_at: 'asc' },
    select: { id: true, raw_response: true, status: true },
  });
  const byRange: KpAnalysisCache['byRange'] = {};

  for (const j of jobs) {
    const raw = j.raw_response as {
      chunksCache?: Record<string, KpChunkOutcome>;
      // v2 succeeded shape：raw_response = { final, chunks: AnalyzedChunk[], pageCount, chunkPages }
      chunks?: Array<{
        chunkIndex?: number;
        startPage?: number;
        endPage?: number;
        text?: string;
        tokenUsage?: TokenUsage;
        latencyMs?: number;
        retries?: number;
      }>;
    } | null;

    // v3 chunksCache（最权威）
    if (raw?.chunksCache) {
      for (const [k, v] of Object.entries(raw.chunksCache)) {
        if (!v || typeof v !== 'object' || typeof v.text !== 'string' || v.text.length === 0)
          continue;
        // 跳过不可解析片：itemCount=null 表示当时 chunk text 不是合法 `{items:[...]}` JSON
        // （多见于触发 max_output_tokens 上限被截断）。复用这种 cache 等于永久卡死那一片，
        // 永远修不好。重发 LLM 才有机会拿到完整输出。
        if (v.itemCount === null || v.itemCount === undefined) continue;
        byRange[k] = v;
      }
    }
    // v2 succeeded chunks 兜底（只在 chunksCache 没覆盖到的 range 用）
    if (raw?.chunks && Array.isArray(raw.chunks)) {
      for (const c of raw.chunks) {
        if (
          typeof c.startPage !== 'number' ||
          typeof c.endPage !== 'number' ||
          typeof c.text !== 'string' ||
          !c.text
        )
          continue;
        const k = `${c.startPage}-${c.endPage}`;
        if (byRange[k]) continue;
        const itemCount = countChunkItems(c.text);
        if (itemCount === null) continue; // 同上：不可解析 chunk 不入 cache
        byRange[k] = {
          chunkIndex: typeof c.chunkIndex === 'number' ? c.chunkIndex : 0,
          totalChunks: 0, // unknown，runKpAnalysis 里会被本轮 totalChunks 覆盖
          startPage: c.startPage,
          endPage: c.endPage,
          text: c.text,
          tokenUsage: c.tokenUsage ?? null,
          latencyMs: typeof c.latencyMs === 'number' ? c.latencyMs : 0,
          retries: typeof c.retries === 'number' ? c.retries : 0,
          reused: false,
          itemCount,
          capturedAt: new Date(0).toISOString(), // 旧 job 没记时间；标 epoch
          sourceJobId: j.id,
        };
      }
    }
  }
  return { byRange };
}

/**
 * 真正干活：拿 job + upload + provider → 走 analyzePdf 或老纯文本路径 → 写 staging。
 * 调用方负责预创建 jobId（status='queued'），本函数把它推进到 running / succeeded / failed。
 * 不抛错（所有失败都吞进 status='failed'），便于在 background 里 fire-and-forget。
 */
async function runParse(
  jobId: string,
  uploadId: string,
  providerId: string,
  subjectId: string,
): Promise<void> {
  const store = createStore();
  let tmpPath: string | null = null;
  try {
    const upload = await prisma.content_upload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new Error('content_upload 不存在');

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new Error(`subject ${subjectId} 不存在`);

    const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error(`llm_provider ${providerId} 不存在`);
    if (!provider.enabled) throw new Error(`llm_provider ${providerId} 已禁用`);

    const useConverse = provider.protocol === 'bedrock_converse';
    // capabilities 形如 { text, vision, pdf, structured_output }；vision=true 走视觉路径。
    const capabilities = (provider.capabilities ?? {}) as { vision?: boolean };
    const useVision = provider.protocol === 'openai_chat' && capabilities.vision === true;
    // 优先级：vision > converse > 老路径
    const useChunkedPipeline = useVision || useConverse;

    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        status: 'running',
        raw_response: {
          progress: {
            phase: 'planning',
            startedAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            chunksDone: 0,
            tokenUsageSoFar: null,
            lastEvent: 'started',
          } satisfies ProgressSnapshot,
        } as Prisma.InputJsonValue,
      },
    });

    let items: KnowledgePointBatch['items'];
    let requestPayload: object;
    let rawResponse: object;
    let parsedOutput: object;
    let tokenUsage: TokenUsage;
    let latencyMs: number;
    let warning: string | null = null;
    // chapter_no → chapter_title。仅 vision 管线（v3+）会填，其他路径留空 Map。
    // 在写 staging.llm_payload 时按 KP 的 chapter_no 查这张表，给 KP 注入 chapter_title。
    let chapterTitles: Map<string, string> = new Map();

    if (useChunkedPipeline) {
      // ── 分片 + chunk 缓存 + 手工合并 ────────────────────────
      // vision (kp-pipeline-vision) 与 converse (kp-pipeline) 的 KpChunkOutcome / 事件名 / cache 形状完全一致；
      // 只是 cache key 不同（vision 带 `vision/` 前缀），所以二者共享同一份 cache 池也不会误命中对方。
      //
      // pdftoppm / converse 适配器都吃本地路径 → 把 storage 里的 PDF 拷到 OS tmp。
      // 用完在 finally 里 rm 掉；tmpPath 提到 runParse 顶部 let 是为了 finally 能看到。
      const pdfBuf = await store.get(upload.file_uri);
      const tmpDir = path.join(tmpdir(), 'hao-admin-kp-parse');
      await mkdir(tmpDir, { recursive: true });
      tmpPath = path.join(tmpDir, `${jobId}.pdf`);
      await writeFile(tmpPath, pdfBuf);
      const pdfPath = tmpPath;

      const cache = await loadCacheForUpload(uploadId);
      const cachedRangeCount = Object.keys(cache.byRange).length;
      if (cachedRangeCount > 0) {
        await patchProgress(jobId, {
          chunksReused: 0, // 实际复用次数等到 chunk_done(reused=true) 才累计
          lastEvent: `cache hit: ${cachedRangeCount} range(s) available for reuse`,
        });
      }

      let chunksDone = 0;
      let chunksReused = 0;
      let acc: TokenUsage = null;
      const chunkLatencies: number[] = [];

      const runner = useVision ? runKpAnalysisVision : runKpAnalysis;
      const result = await runner({
        jobId,
        providerId,
        pdfPath,
        subject,
        cache,
        onChunkPersist: (outcome) =>
          persistChunkToCache(jobId, outcome, useVision ? 'vision/' : ''),
        onProgress: (ev: KpProgressEvent) => {
          console.info(`[kp-pipeline job=${jobId}]`, ev.type, JSON.stringify(ev));
          // onProgress 同步签名，DB patch fire-and-forget
          void (async () => {
            try {
              switch (ev.type) {
                case 'plan':
                  await patchProgress(jobId, {
                    phase: 'chunking',
                    pageCount: ev.pageCount,
                    totalChunks: ev.ranges.length,
                    chunkPages: ev.ranges[0]
                      ? ev.ranges[0].end - ev.ranges[0].start + 1
                      : undefined,
                    lastEvent: `plan: ${ev.pageCount} pages / ${ev.ranges.length} chunks`,
                  });
                  break;
                case 'chunk_start':
                  await patchProgress(jobId, {
                    phase: 'chunking',
                    currentChunk: {
                      index: ev.chunkIndex,
                      startPage: ev.startPage,
                      endPage: ev.endPage,
                      startedAt: new Date().toISOString(),
                    },
                    lastEvent: ev.reused
                      ? `chunk #${ev.chunkIndex} reuse from cache (pages ${ev.startPage}-${ev.endPage})`
                      : `chunk #${ev.chunkIndex} start (pages ${ev.startPage}-${ev.endPage})`,
                  });
                  break;
                case 'chunk_done':
                  chunksDone += 1;
                  if (ev.reused) {
                    chunksReused += 1;
                  } else {
                    acc = addTokenUsage(acc, ev.tokenUsage);
                    chunkLatencies.push(ev.latencyMs);
                  }
                  await patchProgress(jobId, {
                    phase: 'chunking',
                    currentChunk: null,
                    chunksDone,
                    chunksReused,
                    tokenUsageSoFar: acc,
                    avgChunkLatencyMs: chunkLatencies.length
                      ? chunkLatencies.reduce((s, x) => s + x, 0) / chunkLatencies.length
                      : null,
                    lastEvent: ev.reused
                      ? `chunk #${ev.chunkIndex} reused (${ev.itemCount ?? '?'} items)`
                      : `chunk #${ev.chunkIndex} done in ${(ev.latencyMs / 1000).toFixed(1)}s (${ev.itemCount ?? '?'} items)`,
                  });
                  break;
                case 'sleep':
                  await patchProgress(jobId, {
                    phase: 'sleeping',
                    lastEvent: `sleep ${ev.seconds}s (${ev.reason})`,
                  });
                  break;
                case 'merge_start':
                  await patchProgress(jobId, {
                    phase: 'merging',
                    currentChunk: null,
                    lastEvent: 'merging chunks (TS dedup, no LLM)',
                  });
                  break;
                case 'chunk_failed': {
                  // Fail-soft：单片永久失败不停 pipeline；这里只累计计数，UI 通过 warning 看到。
                  const cur = await prisma.llm_parse_job.findUnique({
                    where: { id: jobId },
                    select: { raw_response: true },
                  });
                  const prevFailed =
                    (cur?.raw_response as { progress?: ProgressSnapshot } | null)?.progress
                      ?.chunksFailed ?? 0;
                  await patchProgress(jobId, {
                    chunksFailed: prevFailed + 1,
                    lastEvent: `chunk #${ev.chunkIndex} permanently failed (pages ${ev.startPage}-${ev.endPage}): ${ev.reason.slice(0, 120)}`,
                  });
                  break;
                }
                case 'merge_done':
                  await patchProgress(jobId, {
                    phase: 'done',
                    tokenUsageSoFar: acc,
                    chunksFailed: ev.chunksFailed,
                    lastEvent: `merge done: ${ev.itemCount} items (-${ev.droppedDuplicates} dup, -${ev.droppedInvalid} invalid${ev.chunksUnparseable > 0 ? `, ${ev.chunksUnparseable} chunks unparseable` : ''}${ev.chunksFailed > 0 ? `, ${ev.chunksFailed} chunks failed` : ''})`,
                  });
                  break;
                case 'error':
                  await patchProgress(jobId, {
                    phase: 'failed',
                    lastEvent: `error at ${ev.stage}${ev.chunkIndex ? ` chunk #${ev.chunkIndex}` : ''}`,
                  });
                  break;
              }
            } catch (patchErr) {
              console.warn(`[kp-pipeline job=${jobId}] progress patch fail:`, patchErr);
            }
          })();
        },
      });
      latencyMs = result.totalLatencyMs;
      items = result.items;
      chapterTitles = result.chapterTitles;

      tokenUsage = result.totalTokenUsage;
      requestPayload = result.representativeRequestPayload
        ? redactAuthHeaders(result.representativeRequestPayload)
        : {};

      // raw_response 同时保留 chunksCache（cache 池）+ 完整 chunks 数组（v2 兼容查询）
      // vision 路径用 `vision/${start}-${end}` 前缀；converse 路径用 `${start}-${end}`。
      // 二者隔离避免跨路径误命中（key 不同 → 旧 converse 缓存对新 vision job 不可见，反之亦然）。
      const cacheKeyPrefix = useVision ? 'vision/' : '';
      const cacheForStore: KpAnalysisCache['byRange'] = {};
      for (const c of result.chunks) {
        cacheForStore[`${cacheKeyPrefix}${c.startPage}-${c.endPage}`] = c;
      }
      rawResponse = {
        merge: result.merge,
        // 持久化每片失败的具体 reason，方便排查（之前 merge.chunksFailed 只有计数，
        // reason 只在 dev.log 里能 grep 到，prod 一旦丢日志就盲了）
        chunkFailures: result.chunkFailures,
        chunks: result.chunks.map((c) => ({
          chunkIndex: c.chunkIndex,
          startPage: c.startPage,
          endPage: c.endPage,
          text: c.text,
          tokenUsage: c.tokenUsage,
          latencyMs: c.latencyMs,
          retries: c.retries,
          reused: c.reused,
          itemCount: c.itemCount,
          sourceJobId: c.sourceJobId,
        })),
        pageCount: result.pageCount,
        chunkPages: result.chunkPages,
        chunksCache: cacheForStore,
      };
      parsedOutput = { items };
      // merge 阶段产出 warning：chunk 解析失败 / HTTP 永久失败时上抛给 staging 页。
      // 两类 chunk 都没入库，但 cache 行为不同：
      //   - chunksUnparseable：text 已写 cache 但 itemCount=null，loadCacheForUpload 会跳过
      //   - chunksFailed：runOne throw 时还没走到 onChunkPersist，根本没进 cache
      // 不论哪种，下一次 reparse 都会自动重抽 → 用户重点击就能补全。
      const missing = result.merge.chunksUnparseable + result.merge.chunksFailed;
      if (missing > 0) {
        const parts: string[] = [];
        if (result.merge.chunksUnparseable > 0)
          parts.push(`${result.merge.chunksUnparseable} 片 JSON 不可解析`);
        if (result.merge.chunksFailed > 0)
          parts.push(`${result.merge.chunksFailed} 片 HTTP/网络永久失败`);
        warning = `${missing} 片 chunk 未入库（${parts.join('；')}）；点"重新解析"会自动补抽这些片，已成功的片走 cache 秒级复用`;
      }
    } else {
      // ── 老纯文本路径 ────────────────────────────────────────
      await patchProgress(jobId, { phase: 'chunking', lastEvent: 'pdf-parse → callLLM (text)' });
      // 这里 dynamic import：避开 pdfjs-dist 在 server-action 模块顶层加载崩溃的问题
      const { extractPdfText } = await import('../../../../lib/pdf-extract');
      const pdfBuf = await store.get(upload.file_uri);
      const { text: pdfText, numPages, truncated } = await extractPdfText(pdfBuf);
      if (!pdfText.trim()) {
        throw new Error(`PDF 解析后为空（${numPages} 页），疑似扫描件，需要 OCR`);
      }
      const prompt = buildKpPrompt(subject, pdfText);
      const result = await callLLM<KnowledgePointBatch>({
        providerId,
        prompt,
        schema: KnowledgePointBatchSchema,
      });
      items = result.data.items;
      requestPayload = redactAuthHeaders(result.requestPayload);
      rawResponse = { rawText: result.rawText };
      parsedOutput = { items };
      tokenUsage = result.tokenUsage;
      latencyMs = result.latencyMs;
      warning = truncated ? 'PDF 文本超 80k 字，仅取前段抽取' : null;
    }

    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: items.map((kp) => ({
          parse_job_id: jobId,
          upload_id: uploadId,
          entity_kind: 'knowledge_point' as const,
          // chapter_title 从 merge 阶段算出的 (chapter_no → title) 表查；
          // 没匹配（LLM 没识别出标题 / 该 KP 无 chapter_no）就 null。
          // 字段名不带 `_` 前缀（与 _subject_id 区分）—— 它是 LLM 实际产物的延伸，
          // 不是 admin 注入的元数据；UI 直接 SELECT llm_payload->>'chapter_title' 即可。
          llm_payload: {
            ...kp,
            chapter_title: kp.chapter_no ? (chapterTitles.get(kp.chapter_no) ?? null) : null,
            _subject_id: subjectId,
          } as Prisma.InputJsonValue,
        })),
      }),
      prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          request_payload: requestPayload as Prisma.InputJsonValue,
          raw_response: rawResponse as Prisma.InputJsonValue,
          parsed_output: parsedOutput as Prisma.InputJsonValue,
          token_usage: (tokenUsage
            ? {
                input: tokenUsage.input,
                output: tokenUsage.output,
                total: tokenUsage.input + tokenUsage.output,
              }
            : Prisma.JsonNull) as Prisma.InputJsonValue,
          latency_ms: latencyMs,
          finished_at: new Date(),
          error_message: warning,
        },
      }),
      prisma.content_upload.update({
        where: { id: uploadId },
        data: { status: 'parsed' },
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[runParse job=${jobId}] FAILED:`, msg);
    try {
      // 失败时保留已有 progress（让 UI 显示「卡在第几片」）+ chunksCache（下次重试可复用）
      const cur = await prisma.llm_parse_job.findUnique({
        where: { id: jobId },
        select: { raw_response: true },
      });
      const rawCur =
        (cur?.raw_response as {
          progress?: ProgressSnapshot;
          chunksCache?: KpAnalysisCache['byRange'];
        } | null) ?? {};
      const prev = rawCur.progress;
      await prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error_message: msg.slice(0, 500),
          finished_at: new Date(),
          raw_response: {
            progress: prev
              ? {
                  ...prev,
                  phase: 'failed',
                  lastEvent: msg.slice(0, 200),
                  lastEventAt: new Date().toISOString(),
                }
              : {
                  phase: 'failed',
                  startedAt: new Date().toISOString(),
                  lastEventAt: new Date().toISOString(),
                  chunksDone: 0,
                  tokenUsageSoFar: null,
                  lastEvent: msg.slice(0, 200),
                },
            // 关键：保留 chunksCache，下次重试时 loadCacheForUpload 能跨 job 复用已完成片段
            ...(rawCur.chunksCache ? { chunksCache: rawCur.chunksCache } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (patchErr) {
      console.error(`[runParse job=${jobId}] failed-patch error:`, patchErr);
    }
  } finally {
    if (tmpPath) {
      await rm(tmpPath, { force: true }).catch(() => {});
    }
  }
}

/** 选 prompt_version 与解析路径一致：vision > converse > 老路径。 */
function pickPromptVersion(provider: { protocol: string; capabilities: unknown }): string {
  const caps = (provider.capabilities ?? {}) as { vision?: boolean };
  if (provider.protocol === 'openai_chat' && caps.vision === true) return KP_VISION_PROMPT_VERSION;
  if (provider.protocol === 'bedrock_converse') return KP_CONVERSE_PROMPT_VERSION;
  return KP_PROMPT_VERSION;
}

export interface UploadFormState {
  error: string | null;
}

/**
 * F4.3 入口：multipart → 上传 → 预创建 job(queued) → 后台跑解析 → 立刻 redirect 到 staging 页。
 */
export async function uploadAndParseAction(
  _prev: UploadFormState,
  formData: FormData,
): Promise<UploadFormState> {
  console.info('[uploadAndParseAction] entry', {
    has_file: formData.get('file') instanceof File,
    file_name: formData.get('file') instanceof File ? (formData.get('file') as File).name : null,
    file_size: formData.get('file') instanceof File ? (formData.get('file') as File).size : null,
    subject_id: formData.get('subject_id'),
    provider_id: formData.get('provider_id'),
  });
  const session = await requireAdmin();

  const file = formData.get('file');
  const subjectId = String(formData.get('subject_id') ?? '');
  const providerId = String(formData.get('provider_id') ?? '');

  if (!(file instanceof File) || file.size === 0) {
    return { error: '请选择 PDF 文件' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: `文件超过 500MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` };
  }
  if (!ACCEPTED_PDF_MIME.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
    return { error: '仅支持 PDF 文件' };
  }
  if (!subjectId) return { error: '请选择学科' };
  if (!providerId) return { error: '请选择 LLM Provider' };

  // 提前校验 provider（解析路径选择依赖它，失败时立刻报，不要让用户等到 staging 页才发现）
  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled)
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  const promptVersion = pickPromptVersion(provider);

  // 1) 上传到 ObjectStore（CAS：按 sha256 寻址，同份 PDF 多次上传只存一份）
  const store = createStore();
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = sha256OfBuffer(buf);
  const ext = extOf(file.name);
  const key = StoragePaths.upload(sha256, ext);
  await store.put(key, buf, {
    contentType: file.type || 'application/pdf',
    expectedSha256: sha256,
  });

  // 2) 写 content_upload + 预创建 job(queued)
  const upload = await prisma.content_upload.create({
    data: {
      uploader_id: session.sub,
      file_uri: key,
      file_type: 'textbook',
      purpose: 'knowledge_point',
      original_name: file.name,
      size_bytes: buf.byteLength,
      sha256,
    },
  });
  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: upload.id,
      task_kind: 'knowledge_point',
      provider_id: providerId,
      prompt_version: promptVersion,
      status: 'queued',
    },
  });

  // 3) 后台跑解析（不 await；Node 事件循环把 Promise 跑完）
  void runParse(job.id, upload.id, providerId, subjectId);

  // 4) 立刻 redirect 到 staging 页（poller 会接管显示进度）
  redirect(`/admin/kps/import/${upload.id}`);
}

/**
 * 把同 upload_id 下「形如 zombie 的」running/queued job 标 failed。
 * Node 长进程模型下，runParse 一旦丢失（dev server restart / OOM kill / 容器轮转），
 * job 就会永久卡在 running，poller 一直读到 stale snapshot。新一轮 reparse 启动前
 * 先把这些清理掉，UI 会进入失败态而非假装"还在 sleep"。
 *
 * 不区分"真活着但卡住"vs"进程死了"——同 upload 不允许并发解析（chunksCache 写竞争），
 * 用户主动点重新解析就是表态"放弃旧的"，全标 failed 是最直白的语义。
 */
async function reapZombieJobs(uploadId: string): Promise<number> {
  const result = await prisma.llm_parse_job.updateMany({
    where: {
      upload_id: uploadId,
      status: { in: ['running', 'queued'] },
    },
    data: {
      status: 'failed',
      error_message: '被新一轮重新解析接管（旧任务可能已因 server 重启等原因中断）',
      finished_at: new Date(),
    },
  });
  if (result.count > 0) {
    console.info(`[reapZombieJobs] upload=${uploadId} reaped=${result.count} job(s)`);
  }
  return result.count;
}

export interface ReparseFormState {
  error: string | null;
}

/** 重新解析（用同一文件，可换 provider）— 复用 runParse，同样 fire-and-forget */
export async function reparseUploadAction(
  _prev: ReparseFormState,
  formData: FormData,
): Promise<ReparseFormState> {
  await requireAdmin();
  const uploadId = String(formData.get('upload_id') ?? '');
  const providerId = String(formData.get('provider_id') ?? '');
  const subjectId = String(formData.get('subject_id') ?? '');
  if (!uploadId || !providerId || !subjectId) return { error: '参数不全' };

  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled)
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  const promptVersion = pickPromptVersion(provider);

  // 收割 zombie：旧 running/queued job 标 failed，避免和新 job 并发写 chunksCache
  await reapZombieJobs(uploadId);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'knowledge_point',
      provider_id: providerId,
      prompt_version: promptVersion,
      status: 'queued',
    },
  });

  void runParse(job.id, uploadId, providerId, subjectId);
  redirect(`/admin/kps/import/${uploadId}`);
}
