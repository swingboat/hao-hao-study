/**
 * F4.3 上传页 server actions：教材 PDF → vision 分片解析 → staging 审核。
 *
 * 流程：
 *   1. uploadAndParseAction：multipart → ObjectStore CAS 落盘 → 写 content_upload
 *      + 预创建 llm_parse_job(queued) → void runParse() 后台执行 → 立刻 redirect 到 staging 页。
 *   2. runParse 只走 admin/lib/kp-pipeline-vision.ts::runKpAnalysisVision；
 *      onProgress 写 llm_parse_job.raw_response.progress，onChunkPersist 写 chunksCache。
 *   3. staging 页轮询 getJobProgressAction；succeeded/failed 后 router.refresh()。
 *   4. reparseUploadAction 聚合同 upload_id 的 vision chunksCache，命中 chunk 直接复用。
 *
 * 本入口只接受 openai_chat + capabilities.vision=true 的 provider。
 */
'use server';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@hao/db';
import { redactAuthHeaders } from '@hao/llm';
import { StoragePaths, createStore, extOf, sha256OfBuffer } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import {
  type KpAnalysisCache,
  type KpChunkOutcome,
  type KpProgressEvent,
  type TokenUsage,
  addTokenUsage,
  runKpAnalysisVision,
} from '../../../../lib/kp-pipeline-vision';
import { KP_VISION_PROMPT_VERSION } from '../../../../lib/prompts';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB，整本教材 PDF 上限。
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
   * 永久失败的 chunk 数（LLM 调用重试耗尽后仍 throw）。fail-soft 行为：pipeline 不停，
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
 * 把 chunk outcome 写到 raw_response.chunksCache[`vision/${start}-${end}`]，与 progress 共存。
 * 同样走 jobWriteQueues 串行化，避免和 patchProgress 互相抹字段；
 * 失败仅 console.warn —— 缓存丢了大不了下次重试再跑一遍这片。
 */
const VISION_CACHE_PREFIX = 'vision/';

async function persistChunkToCache(jobId: string, outcome: KpChunkOutcome): Promise<void> {
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
    cache[`${VISION_CACHE_PREFIX}${outcome.startPage}-${outcome.endPage}`] = outcome;
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
 * 从同一 upload_id 下所有 jobs 聚合 vision chunksCache，给本轮 runParse 用作 resume 池。
 * 同 (start,end) 多源命中时，created_at asc 让新 job 的缓存覆盖旧 job。
 */
async function loadCacheForUpload(uploadId: string): Promise<KpAnalysisCache> {
  const jobs = await prisma.llm_parse_job.findMany({
    where: { upload_id: uploadId, task_kind: 'knowledge_point' },
    orderBy: { created_at: 'asc' },
    select: { raw_response: true },
  });
  const byRange: KpAnalysisCache['byRange'] = {};

  for (const j of jobs) {
    const raw = j.raw_response as {
      chunksCache?: Record<string, KpChunkOutcome>;
    } | null;

    if (raw?.chunksCache) {
      for (const [k, v] of Object.entries(raw.chunksCache)) {
        if (!k.startsWith(VISION_CACHE_PREFIX)) continue;
        if (!v || typeof v !== 'object' || typeof v.text !== 'string' || v.text.length === 0)
          continue;
        // 跳过不可解析片：itemCount=null 表示当时 chunk text 不是合法 `{items:[...]}` JSON
        // （多见于触发 max_output_tokens 上限被截断）。复用这种 cache 等于永久卡死那一片，
        // 永远修不好。重发 LLM 才有机会拿到完整输出。
        if (v.itemCount === null || v.itemCount === undefined) continue;
        byRange[k] = v;
      }
    }
  }
  return { byRange };
}

/**
 * 真正干活：拿 job + upload + vision provider → 写 staging。
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

    const capabilities = (provider.capabilities ?? {}) as { vision?: boolean };
    if (provider.protocol !== 'openai_chat' || capabilities.vision !== true) {
      throw new Error(
        `KP 解析只支持 openai_chat + capabilities.vision=true 的 provider；当前 ${provider.id} protocol=${provider.protocol}`,
      );
    }

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

    const result = await runKpAnalysisVision({
      jobId,
      providerId,
      pdfPath,
      subject,
      cache,
      onChunkPersist: (outcome) => persistChunkToCache(jobId, outcome),
      onProgress: (ev: KpProgressEvent) => {
        console.info(`[kp-pipeline-vision job=${jobId}]`, ev.type, JSON.stringify(ev));
        // onProgress 同步签名，DB patch fire-and-forget
        void (async () => {
          try {
            switch (ev.type) {
              case 'plan':
                await patchProgress(jobId, {
                  phase: 'chunking',
                  pageCount: ev.pageCount,
                  totalChunks: ev.ranges.length,
                  chunkPages: ev.ranges[0] ? ev.ranges[0].end - ev.ranges[0].start + 1 : undefined,
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
            console.warn(`[kp-pipeline-vision job=${jobId}] progress patch fail:`, patchErr);
          }
        })();
      },
    });

    const items = result.items;
    const chapterTitles = result.chapterTitles;
    const tokenUsage = result.totalTokenUsage;
    const latencyMs = result.totalLatencyMs;
    const requestPayload = result.representativeRequestPayload
      ? redactAuthHeaders(result.representativeRequestPayload)
      : {};
    let warning: string | null = null;

    const cacheForStore: KpAnalysisCache['byRange'] = {};
    for (const c of result.chunks) {
      cacheForStore[`${VISION_CACHE_PREFIX}${c.startPage}-${c.endPage}`] = c;
    }
    const rawResponse = {
      merge: result.merge,
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
    const parsedOutput = { items };

    const missing = result.merge.chunksUnparseable + result.merge.chunksFailed;
    if (missing > 0) {
      const parts: string[] = [];
      if (result.merge.chunksUnparseable > 0)
        parts.push(`${result.merge.chunksUnparseable} 片 JSON 不可解析`);
      if (result.merge.chunksFailed > 0)
        parts.push(`${result.merge.chunksFailed} 片 HTTP/网络永久失败`);
      warning = `${missing} 片 chunk 未入库（${parts.join('；')}）；点"重新解析"会自动补抽这些片，已成功的片走 cache 秒级复用`;
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
          raw_response: rawResponse as unknown as Prisma.InputJsonValue,
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

  // 提前校验 provider（vision 管线依赖它，失败时立刻报，不要让用户等到 staging 页才发现）
  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled)
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  const caps = (provider.capabilities ?? {}) as { vision?: boolean };
  if (provider.protocol !== 'openai_chat' || caps.vision !== true) {
    return {
      error: `KP 解析只支持 openai_chat + capabilities.vision=true 的 Provider；当前 ${provider.id} protocol=${provider.protocol}`,
    };
  }
  const promptVersion = KP_VISION_PROMPT_VERSION;

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
  const caps = (provider.capabilities ?? {}) as { vision?: boolean };
  if (provider.protocol !== 'openai_chat' || caps.vision !== true) {
    return {
      error: `KP 解析只支持 openai_chat + capabilities.vision=true 的 Provider；当前 ${provider.id} protocol=${provider.protocol}`,
    };
  }
  const promptVersion = KP_VISION_PROMPT_VERSION;

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
