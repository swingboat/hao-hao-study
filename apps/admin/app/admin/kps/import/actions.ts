/**
 * F4.3 上传页 server actions。
 *
 *   - uploadAction：multipart 上传 → 落本地 .run/uploads/ → 写 content_upload（status=uploaded）
 *     → 立刻触发 parse（同步等待结果）→ redirect 到 staging 审核页
 *
 * 解析路径分两支（按 provider.protocol 选）：
 *   - bedrock_converse → analyzePdf（原生 PDF 分片 + 终审）；推荐用于教材类。
 *     一次产生 N+1 次 LLM 调用（N chunk + 1 终审），聚合为 1 条 llm_parse_job（v0.1 方案 A）。
 *     等待时长 ≈ N × LLM_call + N × 60s 间隔；server action 一路 await 到底，运营前端转圈等。
 *   - 其他 protocol → 老路径（pdf-parse 抽纯文本 → 单次 callLLM）。保留作 A/B 兜底；F5.x 全切原生后移除。
 *
 * 失败处理：
 *   - parseAction 内任何抛错都会捕获并把 llm_parse_job.status 置 failed + error_message；
 *     redirect 仍然带过去，让运营在 staging 页看到失败提示
 */
'use server';

import { randomUUID } from 'node:crypto';
import { Prisma, prisma } from '@hao/db';
import {
  type AnalyzeProgressEvent,
  type AnalyzedChunk,
  analyzePdf,
  callLLM,
  extractJsonBlock,
  redactAuthHeaders,
} from '@hao/llm';
import { type KnowledgePointBatch, KnowledgePointBatchSchema } from '@hao/shared/schemas';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import { extractPdfText } from '../../../../lib/pdf-extract';
import {
  KP_CONVERSE_PROMPT_VERSION,
  KP_PROMPT_VERSION,
  buildKpChunkPrompt,
  buildKpFinalPrompt,
  buildKpPrompt,
} from '../../../../lib/prompts';
import { readUpload, saveUpload } from '../../../../lib/storage';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB，PRD F3.1
const ACCEPTED_PDF_MIME = ['application/pdf'];

type TokenUsage = { input: number; output: number } | null;

/** 把两个 tokenUsage 相加；任一为 null → 把它当 0 处理，保留另一边。 */
function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  if (!a && !b) return null;
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
  };
}

/** chunk 阶段 LLM 自由 JSON（可能少 chapter_no 字段）；做最宽松的 KP shape 判断。 */
interface LooseKp {
  name?: unknown;
  chapter_no?: unknown;
  brief?: unknown;
}
function isLooseKpItem(x: unknown): x is LooseKp {
  return typeof x === 'object' && x !== null && 'name' in x;
}

/**
 * 真正干活：拿 upload 行 → 按 provider.protocol 走 analyzePdf 或老纯文本路径 → 写 staging。
 * 同步执行；任何失败都会把 job status 置 failed。
 */
async function runParse(uploadId: string, providerId: string, subjectId: string): Promise<void> {
  const upload = await prisma.content_upload.findUnique({ where: { id: uploadId } });
  if (!upload) throw new Error('content_upload 不存在');

  const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!subject) throw new Error(`subject ${subjectId} 不存在`);

  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider) throw new Error(`llm_provider ${providerId} 不存在`);
  if (!provider.enabled) throw new Error(`llm_provider ${providerId} 已禁用`);

  const useConverse = provider.protocol === 'bedrock_converse';
  const promptVersion = useConverse ? KP_CONVERSE_PROMPT_VERSION : KP_PROMPT_VERSION;

  // 1. 创建 job 记录（v0.1 方案 A：N+1 次调用聚合为 1 条 job）
  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'knowledge_point',
      provider_id: providerId,
      prompt_version: promptVersion,
      status: 'queued',
    },
  });

  try {
    await prisma.llm_parse_job.update({
      where: { id: job.id },
      data: { status: 'running' },
    });

    let items: KnowledgePointBatch['items'];
    let requestPayload: object;
    let rawResponse: object;
    let parsedOutput: object;
    let tokenUsage: TokenUsage;
    let latencyMs: number;
    let warning: string | null = null;

    if (useConverse) {
      // ── analyzePdf 路径（教材类，推荐） ─────────────────────
      const pdfPath = upload.file_uri.startsWith('file://')
        ? upload.file_uri.slice('file://'.length)
        : upload.file_uri; // 后续切 R2 时 readUpload 走 stream，这里也要相应改

      const t0 = Date.now();
      const result = await analyzePdf({
        providerId,
        pdfPath,
        // chunkPages 15 是 example 默认；若发现单片 KP 数超 20 漏抽，调 10。
        chunkPromptBuilder: (ctx) => buildKpChunkPrompt(subject, ctx),
        finalPromptBuilder: (ctx) => buildKpFinalPrompt(subject, ctx),
        onProgress: (ev: AnalyzeProgressEvent) => {
          // v0.1：只 console.info，后续若要 UI 实时进度再走 SSE
          console.info(`[analyzePdf job=${job.id}]`, ev.type, JSON.stringify(ev));
        },
      });
      latencyMs = Date.now() - t0;

      // 终审 raw → JSON → schema
      const finalJson = extractJsonBlock(result.final.text);
      const parsed = KnowledgePointBatchSchema.safeParse(finalJson);
      if (!parsed.success) {
        throw new Error(
          `终审 JSON 不符合 KnowledgePointBatchSchema: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`,
        );
      }
      items = parsed.data.items;

      // token 累加（N chunk + 终审）
      const allUsages: TokenUsage[] = [
        ...result.chunks.map((c) => c.tokenUsage),
        result.final.tokenUsage,
      ];
      tokenUsage = allUsages.reduce<TokenUsage>((acc, cur) => addTokenUsage(acc, cur), null);

      // request_payload 落终审（含真实 token，必须 redact）
      requestPayload = redactAuthHeaders(result.final.requestPayload);

      // raw_response 存终审全文 + 每 chunk 摘要（含 text、tokenUsage、latency、retries）
      rawResponse = {
        final: {
          rawText: result.final.text,
          tokenUsage: result.final.tokenUsage,
          latencyMs: result.final.latencyMs,
          retries: result.final.retries,
        },
        chunks: result.chunks.map((c: AnalyzedChunk) => ({
          chunkIndex: c.chunkIndex,
          startPage: c.startPage,
          endPage: c.endPage,
          text: c.text,
          tokenUsage: c.tokenUsage,
          latencyMs: c.latencyMs,
          retries: c.retries,
          // chunk 阶段额外尝试 loose-parse 一下，便于运营审计时回看每片抽到什么
          looseItems: (() => {
            try {
              const j = extractJsonBlock(c.text) as { items?: unknown };
              if (Array.isArray(j?.items)) return j.items.filter(isLooseKpItem).length;
              return null;
            } catch {
              return null;
            }
          })(),
        })),
        pageCount: result.pageCount,
        chunkPages: result.chunkPages,
      };
      parsedOutput = { items };
    } else {
      // ── 老纯文本路径（兜底；F5.x 移除） ─────────────────────
      const pdfBuf = await readUpload(upload.file_uri);
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

    // 写每条 KP 候选到 staging
    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: items.map((kp) => ({
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
