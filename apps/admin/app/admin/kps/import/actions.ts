/**
 * F4.3 上传页 server actions：教材 PDF → analyzeKnowledgePoints → staging 审核。
 *
 * admin 只负责上传、任务状态、进度映射和 DB 落库；LLM 解析能力统一走 @hao/llm
 * 从 how-to-use-llm-proxy 同步来的公共入口。
 */
'use server';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@hao/db';
import { type EducationProgressEvent, analyzeKnowledgePoints } from '@hao/llm';
import { StoragePaths, createStore, extOf, sha256OfBuffer } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import {
  type TokenUsage,
  knowledgePointToStagingPayload,
  tokenUsageFromEducationUsage,
  tokenUsageTotal,
} from '../../../../lib/education-analysis-adapter';
import {
  documentAnalysisProtocolLabel,
  getLlmProviderById,
  isDocumentAnalysisProvider,
} from '../../../../lib/llm-providers';

const KP_PROMPT_VERSION = 'knowledge_points/common/analyzeKnowledgePoints';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const ACCEPTED_PDF_MIME = ['application/pdf'];

export interface ProgressSnapshot {
  phase:
    | 'preparing'
    | 'rendering'
    | 'analyzing'
    | 'synthesizing'
    | 'persisting'
    | 'done'
    | 'failed';
  startedAt: string;
  lastEventAt: string;
  pageCount?: number;
  pagesDone: number;
  pagesFailed?: number;
  tokenUsageSoFar: TokenUsage;
  lastEvent: string;
}

const jobWriteQueues = new Map<string, Promise<void>>();
function enqueueJobWrite(jobId: string, work: () => Promise<void>): Promise<void> {
  const prev = jobWriteQueues.get(jobId) ?? Promise.resolve();
  const next = prev.then(work, work);
  jobWriteQueues.set(jobId, next);
  return next;
}

async function patchProgress(jobId: string, patch: Partial<ProgressSnapshot>): Promise<void> {
  return enqueueJobWrite(jobId, async () => {
    const cur = await prisma.llm_parse_job.findUnique({
      where: { id: jobId },
      select: { raw_response: true },
    });
    const prev =
      (cur?.raw_response as { progress?: ProgressSnapshot } | null)?.progress ??
      ({
        phase: 'preparing',
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        pagesDone: 0,
        pagesFailed: 0,
        tokenUsageSoFar: null,
        lastEvent: 'init',
      } satisfies ProgressSnapshot);
    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        raw_response: {
          progress: { ...prev, ...patch, lastEventAt: new Date().toISOString() },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

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

    const provider = await getLlmProviderById(providerId);
    if (!provider) throw new Error(`llm_provider ${providerId} 不存在`);
    if (!provider.enabled) throw new Error(`llm_provider ${providerId} 已禁用`);
    if (!isDocumentAnalysisProvider(provider)) {
      throw new Error(`KP 解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}`);
    }

    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        status: 'running',
        raw_response: {
          progress: {
            phase: 'preparing',
            startedAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            pagesDone: 0,
            pagesFailed: 0,
            tokenUsageSoFar: null,
            lastEvent: 'started analyzeKnowledgePoints',
          } satisfies ProgressSnapshot,
        } as Prisma.InputJsonValue,
      },
    });

    const pdfBuf = await store.get(upload.file_uri);
    const tmpDir = path.join(tmpdir(), 'hao-admin-kp-parse');
    await mkdir(tmpDir, { recursive: true });
    const originalName = upload.original_name ?? `${jobId}.pdf`;
    tmpPath = path.join(tmpDir, `${jobId}${extOf(originalName) || '.pdf'}`);
    await writeFile(tmpPath, pdfBuf);

    let pagesDone = 0;
    const result = await analyzeKnowledgePoints({
      providerId,
      file: {
        type: 'pdf',
        name: originalName,
        path: tmpPath,
        mimeType: 'application/pdf',
      },
      onProgress: (event) => {
        if (event.stage === 'page_done') pagesDone += 1;
        void patchProgress(jobId, kpProgressFromEvent(event, pagesDone)).catch((e) =>
          console.warn(`[analyzeKnowledgePoints job=${jobId}] progress patch fail:`, e),
        );
      },
    });

    const items = result.knowledge_points.map((kp) =>
      knowledgePointToStagingPayload(kp, subjectId),
    );
    if (items.length === 0) {
      throw new Error(result.diagnostics?.parse_error ?? 'analyzeKnowledgePoints 未产出知识点');
    }

    const tokenUsage = tokenUsageFromEducationUsage(result.usage);
    const tokenUsageForDb = tokenUsageTotal(tokenUsage);

    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: items.map((kp) => ({
          parse_job_id: jobId,
          upload_id: uploadId,
          entity_kind: 'knowledge_point' as const,
          llm_payload: kp as Prisma.InputJsonValue,
        })),
      }),
      prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          request_payload: {
            entry: 'analyzeKnowledgePoints',
            file_type: 'pdf',
          } as Prisma.InputJsonValue,
          raw_response: {
            status: result.status,
            coverage: result.coverage,
            diagnostics: result.diagnostics,
            pageCount: result.source.page_count,
            knowledgePointCount: result.knowledge_points.length,
            llm: result.llm,
          } as unknown as Prisma.InputJsonValue,
          parsed_output: {
            knowledge_points: result.knowledge_points,
          } as unknown as Prisma.InputJsonValue,
          token_usage: tokenUsageForDb
            ? (tokenUsageForDb as Prisma.InputJsonValue)
            : (Prisma.JsonNull as unknown as Prisma.InputJsonValue),
          latency_ms: typeof result.latency_ms === 'number' ? result.latency_ms : null,
          finished_at: new Date(),
          error_message: result.status === 'ok' ? null : (result.diagnostics?.parse_error ?? null),
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
      const cur = await prisma.llm_parse_job.findUnique({
        where: { id: jobId },
        select: { raw_response: true },
      });
      const prev = (cur?.raw_response as { progress?: ProgressSnapshot } | null)?.progress;
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
                  pagesDone: 0,
                  pagesFailed: 0,
                  tokenUsageSoFar: null,
                  lastEvent: msg.slice(0, 200),
                },
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

function kpProgressFromEvent(
  event: EducationProgressEvent,
  pagesDone: number,
): Partial<ProgressSnapshot> {
  switch (event.stage) {
    case 'word_to_pdf':
    case 'pdf_to_pages':
      return { phase: 'rendering', lastEvent: event.message };
    case 'pdf_to_pages_done':
      return {
        phase: 'analyzing',
        pageCount: event.total_pages,
        lastEvent: event.message,
      };
    case 'page_started':
      return {
        phase: 'analyzing',
        pageCount: event.total_pages,
        lastEvent: event.message,
      };
    case 'page_done':
      return {
        phase: 'analyzing',
        pageCount: event.total_pages,
        pagesDone,
        lastEvent: event.message,
      };
    case 'synthesis_started':
    case 'synthesis_done':
      return {
        phase: 'synthesizing',
        pageCount: event.total_pages,
        lastEvent: event.message,
      };
  }
}

export interface UploadFormState {
  error: string | null;
}

export async function uploadAndParseAction(
  _prev: UploadFormState,
  formData: FormData,
): Promise<UploadFormState> {
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

  const provider = await getLlmProviderById(providerId);
  if (!provider || !provider.enabled)
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  if (!isDocumentAnalysisProvider(provider)) {
    return { error: `KP 解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}` };
  }

  const store = createStore();
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = sha256OfBuffer(buf);
  const ext = extOf(file.name);
  const key = StoragePaths.upload(sha256, ext);
  await store.put(key, buf, {
    contentType: file.type || 'application/pdf',
    expectedSha256: sha256,
  });

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
      prompt_version: KP_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runParse(job.id, upload.id, providerId, subjectId);
  redirect(`/admin/kps/import/${upload.id}`);
}

async function reapZombieJobs(uploadId: string): Promise<number> {
  const result = await prisma.llm_parse_job.updateMany({
    where: {
      upload_id: uploadId,
      status: { in: ['running', 'queued'] },
      task_kind: 'knowledge_point',
    },
    data: {
      status: 'failed',
      error_message: '被新一轮重新解析接管（旧任务可能已因 server 重启等原因中断）',
      finished_at: new Date(),
    },
  });
  return result.count;
}

export interface ReparseFormState {
  error: string | null;
}

export async function reparseUploadAction(
  _prev: ReparseFormState,
  formData: FormData,
): Promise<ReparseFormState> {
  await requireAdmin();
  const uploadId = String(formData.get('upload_id') ?? '');
  const providerId = String(formData.get('provider_id') ?? '');
  const subjectId = String(formData.get('subject_id') ?? '');
  if (!uploadId || !providerId || !subjectId) return { error: '参数不全' };

  const provider = await getLlmProviderById(providerId);
  if (!provider || !provider.enabled)
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  if (!isDocumentAnalysisProvider(provider)) {
    return { error: `KP 解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}` };
  }

  await reapZombieJobs(uploadId);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'knowledge_point',
      provider_id: providerId,
      prompt_version: KP_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runParse(job.id, uploadId, providerId, subjectId);
  redirect(`/admin/kps/import/${uploadId}`);
}
