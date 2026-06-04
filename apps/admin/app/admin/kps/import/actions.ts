/**
 * F4.3 上传页 server actions。
 *
 *   - uploadAction：multipart 上传 → 落本地 .run/uploads/ → 写 content_upload（status=uploaded）
 *     → 立刻触发 parse（同步等待结果）→ redirect 到 staging 审核页
 *
 * 同步触发解析（不走 worker queue）的取舍：
 *   v0.1 没有 worker / queue 基础设施，且单次解析 30s 内能回；
 *   server action 直接 await callLLM，前端用 useTransition 转圈即可。
 *   超时风险：人教版整本教材 PDF 较大；上层 prompt 已 truncate 到 80k 字，
 *   实测 Webex Gemini 3.1 Pro p99 < 60s，落在 Next 默认超时内。
 *
 * 失败处理：
 *   - parseAction 内任何抛错都会捕获并把 llm_parse_job.status 置 failed + error_message；
 *     redirect 仍然带过去，让运营在 staging 页看到失败提示
 */
'use server';

import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@hao/db';
import { callLLM, redactAuthHeaders } from '@hao/llm';
import { type KnowledgePointBatch, KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import { extractPdfText } from '../../../../lib/pdf-extract';
import { KP_PROMPT_VERSION, buildKpPrompt } from '../../../../lib/prompts';
import { readUpload, saveUpload } from '../../../../lib/storage';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB，PRD F3.1
const ACCEPTED_PDF_MIME = ['application/pdf'];

/**
 * 真正干活：拿 upload 行 → 抽 PDF 文本 → callLLM → 写 staging。
 * 同步执行；任何失败都会把 job status 置 failed。
 */
async function runParse(uploadId: string, providerId: string, subjectId: string): Promise<void> {
  const upload = await prisma.content_upload.findUnique({ where: { id: uploadId } });
  if (!upload) throw new Error('content_upload 不存在');

  const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!subject) throw new Error(`subject ${subjectId} 不存在`);

  // 1. 创建 job 记录
  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'knowledge_point',
      provider_id: providerId,
      prompt_version: KP_PROMPT_VERSION,
      status: 'queued',
    },
  });

  try {
    await prisma.llm_parse_job.update({
      where: { id: job.id },
      data: { status: 'running' },
    });

    // 2. 抽 PDF 文本
    const pdfBuf = await readUpload(upload.file_uri);
    const { text: pdfText, numPages, truncated } = await extractPdfText(pdfBuf);
    if (!pdfText.trim()) {
      throw new Error(`PDF 解析后为空（${numPages} 页），疑似扫描件，需要 OCR`);
    }

    // 3. 拼 prompt 调 LLM（schema 给定 → callLLM 内部强制 structured output）
    const prompt = buildKpPrompt(subject, pdfText);
    const result = await callLLM<KnowledgePointBatch>({
      providerId,
      prompt,
      schema: KnowledgePointBatchSchema,
    });

    // 4. 写每条 KP 候选到 staging
    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: result.data.items.map((kp) => ({
          parse_job_id: job.id,
          upload_id: uploadId,
          entity_kind: 'knowledge_point' as const,
          llm_payload: { ...kp, _subject_id: subjectId } as Prisma.InputJsonValue,
        })),
      }),
      prisma.llm_parse_job.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          request_payload: redactAuthHeaders(result.requestPayload) as Prisma.InputJsonValue,
          raw_response: { rawText: result.rawText } as Prisma.InputJsonValue,
          parsed_output: { items: result.data.items } as Prisma.InputJsonValue,
          token_usage: (result.tokenUsage
            ? {
                input: result.tokenUsage.input,
                output: result.tokenUsage.output,
                total: result.tokenUsage.input + result.tokenUsage.output,
              }
            : Prisma.JsonNull) as Prisma.InputJsonValue,
          latency_ms: result.latencyMs,
          finished_at: new Date(),
          error_message: truncated ? 'PDF 文本超 80k 字，仅取前段抽取' : null,
        },
      }),
      prisma.content_upload.update({
        where: { id: uploadId },
        data: { status: 'parsed' },
      }),
    ]);
  } catch (e) {
    // 失败仍要落 job，运营才能在 F7.1 审计里看到
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.llm_parse_job.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error_message: msg.slice(0, 500),
        finished_at: new Date(),
      },
    });
    throw e;
  }
}

export interface UploadFormState {
  error: string | null;
}

/**
 * F4.3 入口：multipart 表单 → 上传 → 解析 → 跳 staging 页。
 */
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
    return { error: `文件超过 20MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` };
  }
  if (!ACCEPTED_PDF_MIME.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
    return { error: '仅支持 PDF 文件' };
  }
  if (!subjectId) return { error: '请选择学科' };
  if (!providerId) return { error: '请选择 LLM Provider' };

  // 1) 落本地
  const saved = await saveUpload(file, '.pdf');

  // 2) 写 content_upload
  const upload = await prisma.content_upload.create({
    data: {
      uploader_id: session.sub,
      file_uri: saved.fileUri,
      file_type: 'textbook',
      purpose: 'knowledge_point',
      original_name: file.name,
      size_bytes: saved.sizeBytes,
      // status 默认 uploaded
    },
  });

  // 3) 同步触发解析
  let parseError: string | null = null;
  try {
    await runParse(upload.id, providerId, subjectId);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  // 4) 不论成败都跳 staging 页（失败时页面顶部会读 job.error_message 提示）
  const target = `/admin/kps/import/${upload.id}${parseError ? `?error=${encodeURIComponent(parseError.slice(0, 200))}` : ''}`;
  // 用 hidden token 绕过 redirect throw 干扰：在 next 14+ redirect 通过抛特殊 error 实现
  redirect(target);
}

/** 重新解析（用同一文件，可换 provider）— 复用 runParse */
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

  let err: string | null = null;
  try {
    await runParse(uploadId, providerId, subjectId);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  redirect(
    `/admin/kps/import/${uploadId}${err ? `?error=${encodeURIComponent(err.slice(0, 200))}` : ''}`,
  );
}

// 防止 ts unused-export 报警；同时给 page.tsx 进度提示用
export { randomUUID as _uuid };
