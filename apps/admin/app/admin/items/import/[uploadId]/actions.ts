/**
 * F3.3–F3.7 staging 审核 server actions（对照 /admin/kps/import/[uploadId]/actions.ts）。
 *
 *   - acceptStagingAction (F3.7)：事务里写 practice_item + audit_log + 更新 staging
 *     T3：item_type ∈ {choice, fill_in} + kp_ids 非空 + primary_kp_id ∈ kp_ids（DB schema 兜底但应用层先校）
 *     T4：audit_log.target_id == practice_item.id（同一事务，必一致）
 *   - rejectStagingAction：仅 review_status='rejected'
 *   - rerunStagingAction (F3.6 / T7)：选 provider → 新建 llm_parse_job → 同一 PDF（可缩窗）跑一遍
 *     → 用 item_no / kp_hints 匹配本 staging 行 → 覆盖 llm_payload + 把 parse_job_id 指到新 job
 *   - bulkAcceptAllAction / bulkRejectAllAction：dev-only 批量操作（对照 KP 版）
 *   - getJobProgressAction：客户端轮询返回 ItemProgressSnapshot
 *
 * accept 时 review_payload 写最终 { content, item_type, options, answer, solution_text,
 * difficulty, kp_ids, primary_kp_id, subject_id }，llm_payload 保持只读不动。
 */
'use server';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Prisma, prisma } from '@hao/db';
import { extractItemsFromPdf } from '@hao/llm';
import { PRACTICE_ITEM_PROMPT_VERSION, buildPracticeItemChunkPrompt } from '@hao/shared/prompts';
import { createStore } from '@hao/storage';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/auth';
import type { ItemProgressSnapshot } from '../../../../../lib/item-pipeline';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

// ────────── accept / reject (F3.7) ──────────

const UuidArray = z.array(z.string().uuid()).min(1, '至少关联 1 个 KP');

const AcceptSchema = z
  .object({
    staging_id: z.string().uuid('staging_id 非法'),
    content: z.string().trim().min(5).max(2000),
    item_type: z.enum(['choice', 'fill_in']),
    options_json: z.string().default('[]'),
    answer: z.string().trim().min(1).max(500),
    solution_text: z.string().max(3000).default(''),
    difficulty: z.coerce.number().int().min(1).max(5),
    kp_ids_csv: z.string().min(1),
    primary_kp_id: z.string().uuid('primary_kp_id 非法'),
    subject_id: z.string().min(1),
  })
  .transform((d) => {
    const kp_ids = UuidArray.parse(
      Array.from(
        new Set(
          d.kp_ids_csv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ),
    );
    let options: Array<{ label: string; text: string }>;
    try {
      const parsed = JSON.parse(d.options_json) as unknown;
      if (!Array.isArray(parsed)) throw new Error('options 不是数组');
      options = parsed as Array<{ label: string; text: string }>;
    } catch (e) {
      throw new Error(`options JSON 解析失败：${(e as Error).message}`);
    }
    return { ...d, kp_ids, options };
  })
  .superRefine((d, ctx) => {
    // T3 核心校验
    if (!d.kp_ids.includes(d.primary_kp_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primary_kp_id'],
        message: 'primary_kp_id 必须出现在 kp_ids 中',
      });
    }
    if (d.item_type === 'choice' && d.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options_json'],
        message: 'choice 题至少 2 个选项',
      });
    }
    if (d.item_type === 'fill_in' && d.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options_json'],
        message: 'fill_in 题不应有 options',
      });
    }
  });

export interface StagingActionState {
  error: string | null;
  ok?: boolean;
}

export async function acceptStagingAction(
  _prev: StagingActionState,
  formData: FormData,
): Promise<StagingActionState> {
  const session = await requireAdmin();

  const parsed = AcceptSchema.safeParse({
    staging_id: formData.get('staging_id'),
    content: formData.get('content'),
    item_type: formData.get('item_type'),
    options_json: formData.get('options_json') ?? '[]',
    answer: formData.get('answer'),
    solution_text: formData.get('solution_text') ?? '',
    difficulty: formData.get('difficulty'),
    kp_ids_csv: formData.get('kp_ids_csv') ?? '',
    primary_kp_id: formData.get('primary_kp_id'),
    subject_id: formData.get('subject_id'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '表单校验失败' };
  }
  const d = parsed.data;

  // 校验 kp_ids 全部存在 + 同学科（避免跨学科 KP 误关联）
  const kps = await prisma.knowledge_point.findMany({
    where: { id: { in: d.kp_ids } },
    select: { id: true, subject_id: true },
  });
  if (kps.length !== d.kp_ids.length) {
    return { error: '部分 kp_ids 在 knowledge_point 表中找不到' };
  }
  const wrongSubject = kps.find((k) => k.subject_id !== d.subject_id);
  if (wrongSubject) {
    return {
      error: `kp ${wrongSubject.id} 属于学科 ${wrongSubject.subject_id}，与本次发布学科不一致`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // T3：写 practice_item
      const item = await tx.practice_item.create({
        data: {
          content: d.content,
          answer: d.answer,
          solution_text: d.solution_text,
          difficulty: d.difficulty,
          item_type: d.item_type,
          kp_ids: d.kp_ids,
          primary_kp_id: d.primary_kp_id,
        },
      });

      // T4：同事务写 audit_log，target_id 必等于 item.id
      await tx.audit_log.create({
        data: {
          actor_id: session.sub,
          action: 'publish_practice_item',
          target_type: 'practice_item',
          target_id: item.id,
          payload: {
            staging_id: d.staging_id,
            subject_id: d.subject_id,
            kp_ids: d.kp_ids,
            primary_kp_id: d.primary_kp_id,
            item_type: d.item_type,
            difficulty: d.difficulty,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.llm_parse_staging.update({
        where: { id: d.staging_id },
        data: {
          review_status: 'accepted',
          review_payload: {
            content: d.content,
            item_type: d.item_type,
            options: d.options,
            answer: d.answer,
            solution_text: d.solution_text,
            difficulty: d.difficulty,
            kp_ids: d.kp_ids,
            primary_kp_id: d.primary_kp_id,
            subject_id: d.subject_id,
          } as Prisma.InputJsonValue,
          reviewed_by: session.sub,
          reviewed_at: new Date(),
          published_id: item.id,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 200) };
  }

  revalidatePath('/admin/items');
  const upload_id = String(formData.get('upload_id') ?? '');
  if (upload_id) revalidatePath(`/admin/items/import/${upload_id}`);
  return { error: null, ok: true };
}

export async function rejectStagingAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = String(formData.get('staging_id') ?? '');
  if (!id) throw new Error('staging_id 缺失');
  await prisma.llm_parse_staging.update({
    where: { id },
    data: {
      review_status: 'rejected',
      reviewed_by: session.sub,
      reviewed_at: new Date(),
    },
  });
  const upload_id = String(formData.get('upload_id') ?? '');
  if (upload_id) revalidatePath(`/admin/items/import/${upload_id}`);
  revalidatePath('/admin/items');
}

// ────────── KP 候选搜索（F3.5） ──────────

/**
 * 按 name 前缀 + 学科过滤；用于 diff 抽屉的"映射到正式 KP"自动补全。
 * 简体繁体不敏感：v0.1 先简单 ilike，后续可换 pg_trgm。
 */
export async function searchKpsAction(
  subjectId: string,
  query: string,
  limit = 20,
): Promise<Array<{ id: string; name: string; chapter_no: string | null }>> {
  await requireAdmin();
  if (!subjectId) return [];
  const q = query.trim();
  return prisma.knowledge_point.findMany({
    where: {
      subject_id: subjectId,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ chapter_no: 'asc' }, { name: 'asc' }],
    take: limit,
    select: { id: true, name: true, chapter_no: true },
  });
}

// ────────── F3.6 单条重跑（T7） ──────────

export interface RerunActionState {
  error: string | null;
  ok?: boolean;
}

/**
 * 用新 provider 重跑该 staging 行：
 *   1) 新建 llm_parse_job(task_kind='practice_item', provider=new)
 *   2) 把同一 PDF 跑一遍 extractItemsFromPdf（如果 staging 有 source_hint.page，
 *      就缩窗到 [page-1, page+1]，省 token；否则全本）
 *   3) 在结果里找匹配本题的那条（先按 item_no 精确匹配，找不到回退 content 前 60 字相似度），
 *      覆盖 staging.llm_payload + 把 staging.parse_job_id 指到新 job
 *   4) job 标 succeeded / failed
 *
 * 不修改 review_status —— 重跑只是换 LLM 数据，是否接受仍由人工决策。
 */
export async function rerunStagingAction(
  _prev: RerunActionState,
  formData: FormData,
): Promise<RerunActionState> {
  await requireAdmin();
  const stagingId = String(formData.get('staging_id') ?? '');
  const providerId = String(formData.get('provider_id') ?? '');
  if (!stagingId || !providerId) return { error: 'staging_id / provider_id 缺失' };

  const staging = await prisma.llm_parse_staging.findUnique({
    where: { id: stagingId },
    include: { upload: true },
  });
  if (!staging) return { error: 'staging 不存在' };
  if (staging.entity_kind !== 'practice_item') {
    return { error: '该 staging 不是 practice_item' };
  }

  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled) return { error: `provider ${providerId} 不存在 / 未启用` };
  const caps = (provider.capabilities ?? {}) as { vision?: boolean };
  if (!caps.vision) return { error: 'rerun 只支持 vision provider' };
  if (!staging.upload.sha256) return { error: 'upload 缺 sha256，无法 rerun' };

  const llmPayload = staging.llm_payload as {
    source_hint?: { page?: number | null; item_no?: string | null };
    content?: string;
    _subject_id?: string;
  };
  const subjectId = llmPayload._subject_id ?? '';
  if (!subjectId) return { error: 'staging 缺 _subject_id' };

  const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!subject) return { error: `subject ${subjectId} 不存在` };

  const srcPage = llmPayload.source_hint?.page ?? null;
  const srcItemNo = llmPayload.source_hint?.item_no ?? null;
  const oldContentKey = (llmPayload.content ?? '').replace(/\s+/g, '').slice(0, 60);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: staging.upload_id,
      task_kind: 'practice_item',
      provider_id: providerId,
      prompt_version: PRACTICE_ITEM_PROMPT_VERSION,
      status: 'running',
    },
  });

  const store = createStore();
  let tmpPath: string | null = null;
  try {
    const buf = await store.get(staging.upload.file_uri);
    const tmpDir = path.join(tmpdir(), 'hao-admin-item-rerun');
    await mkdir(tmpDir, { recursive: true });
    tmpPath = path.join(tmpDir, `${job.id}.pdf`);
    await writeFile(tmpPath, buf);

    // 同学科 KP 字典 → 注入 chunk prompt（与首次解析对称；rerun 后 admin 抽屉自动映射也能立刻命中）
    const existingKps = await prisma.knowledge_point.findMany({
      where: { subject_id: subjectId },
      select: { name: true },
      orderBy: [{ chapter_no: 'asc' }, { name: 'asc' }],
    });
    // 保留 query 的 chapter_no 顺序，不要 .sort()（理由见 item-pipeline.ts 同名注释）
    const kpNames = Array.from(
      new Set(existingKps.map((k) => k.name.trim()).filter((n) => n.length > 0)),
    ).slice(0, 500);
    const dictSection =
      kpNames.length === 0
        ? ''
        : [
            '',
            `【优先复用以下 ${kpNames.length} 个已有 ${subject.name} 知识点名（字面完全一致最佳）】`,
            kpNames.map((n) => `- ${n}`).join('\n'),
            '',
            '若题目考查的概念上方列表里没有，再用你自己的术语并保持 2-50 字符。',
          ].join('\n');

    if (kpNames.length > 0) {
      await prisma.llm_parse_job.update({
        where: { id: job.id },
        data: { prompt_version: `${PRACTICE_ITEM_PROMPT_VERSION}+kpdict-${kpNames.length}` },
      });
    }

    const result = await extractItemsFromPdf({
      pdfPath: tmpPath,
      providerId,
      sourceSha256: staging.upload.sha256,
      store,
      // 窗口 = ±1 页，给跨页留余地；没 source_hint 就全本（贵但兜底）
      firstPage: srcPage ? Math.max(1, srcPage - 1) : undefined,
      lastPage: srcPage ? srcPage + 1 : undefined,
      pagesPerCall: 3,
      chunkPromptBuilder: (ctx) =>
        [
          buildPracticeItemChunkPrompt({
            chunkIndex: ctx.chunkIndex,
            totalChunks: ctx.totalChunks,
            startPage: ctx.pages[0] ?? 1,
            endPage: ctx.pages[ctx.pages.length - 1] ?? ctx.pages[0] ?? 1,
            subjectName: subject.name,
          }),
          dictSection,
          '',
          '⚠️ 必须额外带 _src_pages / _truncated_before / _truncated_after / figures / source_hint。',
        ].join('\n'),
    });

    // 匹配：先按 item_no（不空），再按 content 前 60 字归一相似（startsWith / includes 兜底）
    const matched =
      (srcItemNo
        ? result.items.find((it) => (it.item_no ?? '').trim() === srcItemNo.trim())
        : null) ??
      result.items.find(
        (it) =>
          oldContentKey.length > 10 &&
          it.content.replace(/\s+/g, '').slice(0, 60).startsWith(oldContentKey.slice(0, 30)),
      ) ??
      result.items[0];

    if (!matched) {
      throw new Error('rerun 没产出可匹配的题（result.items 为空）');
    }

    await prisma.$transaction([
      prisma.llm_parse_staging.update({
        where: { id: stagingId },
        data: {
          parse_job_id: job.id,
          llm_payload: {
            content: matched.content,
            item_type: matched.item_type,
            options: matched.options,
            answer: matched.answer,
            solution_text: matched.solution_text,
            difficulty: matched.difficulty,
            kp_hints: matched.kp_hints,
            source_hint: {
              page: matched._src_page ?? null,
              item_no: matched.item_no ?? null,
            },
            figures: matched.figures ?? [],
            _subject_id: subjectId,
            _rerun: {
              previous_job_id: staging.parse_job_id,
              previous_provider_id: provider.id,
              matched_strategy:
                srcItemNo && matched.item_no === srcItemNo ? 'item_no' : 'content_prefix',
            },
          } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.llm_parse_job.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          parsed_output: { items: result.items } as unknown as Prisma.InputJsonValue,
          token_usage: {
            input: result.totalTokenUsage.input,
            output: result.totalTokenUsage.output,
            total: result.totalTokenUsage.input + result.totalTokenUsage.output,
          } as Prisma.InputJsonValue,
          finished_at: new Date(),
        },
      }),
    ]);

    revalidatePath(`/admin/items/import/${staging.upload_id}`);
    return { error: null, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.llm_parse_job
      .update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error_message: msg.slice(0, 500),
          finished_at: new Date(),
        },
      })
      .catch(() => {});
    return { error: msg.slice(0, 200) };
  } finally {
    if (tmpPath) await rm(tmpPath, { force: true }).catch(() => {});
  }
}

// ────────── dev 批量（对照 KP） ──────────

function ensureDevOnly() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('bulk-all 仅限开发环境');
  }
}

export interface BulkActionState {
  error: string | null;
  ok?: boolean;
  rejected?: number;
}

export async function bulkRejectAllAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  ensureDevOnly();
  const session = await requireAdmin();
  const upload_id = String(formData.get('upload_id') ?? '');
  if (!upload_id) return { error: 'upload_id 缺失' };

  const result = await prisma.llm_parse_staging.updateMany({
    where: { upload_id, review_status: 'pending', entity_kind: 'practice_item' },
    data: { review_status: 'rejected', reviewed_by: session.sub, reviewed_at: new Date() },
  });

  revalidatePath(`/admin/items/import/${upload_id}`);
  revalidatePath('/admin/items');
  return { error: null, ok: true, rejected: result.count };
}

// ────────── 进度轮询 ──────────

export interface JobProgressView {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  errorMessage: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  promptVersion: string;
  providerId: string;
  progress: ItemProgressSnapshot | null;
  tokenUsage: { input: number; output: number; total: number } | null;
  itemCount: number;
}

export async function getJobProgressAction(jobId: string): Promise<JobProgressView> {
  await requireAdmin();
  const job = await prisma.llm_parse_job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      error_message: true,
      finished_at: true,
      latency_ms: true,
      prompt_version: true,
      provider_id: true,
      raw_response: true,
      token_usage: true,
    },
  });
  if (!job) throw new Error(`job ${jobId} 不存在`);

  const rawProgress =
    (job.raw_response as { progress?: ItemProgressSnapshot } | null)?.progress ?? null;
  const tokenUsageField = job.token_usage as {
    input?: number;
    output?: number;
    total?: number;
  } | null;
  const fallbackUsage = rawProgress?.tokenUsageSoFar
    ? {
        input: rawProgress.tokenUsageSoFar.input,
        output: rawProgress.tokenUsageSoFar.output,
        total: rawProgress.tokenUsageSoFar.input + rawProgress.tokenUsageSoFar.output,
      }
    : null;

  const itemCount = await prisma.llm_parse_staging.count({
    where: { parse_job_id: jobId, entity_kind: 'practice_item' },
  });

  return {
    jobId: job.id,
    status: job.status as JobProgressView['status'],
    errorMessage: job.error_message,
    finishedAt: job.finished_at?.toISOString() ?? null,
    latencyMs: job.latency_ms,
    promptVersion: job.prompt_version,
    providerId: job.provider_id,
    progress: rawProgress,
    tokenUsage:
      tokenUsageField && tokenUsageField.input != null && tokenUsageField.output != null
        ? {
            input: tokenUsageField.input,
            output: tokenUsageField.output,
            total: tokenUsageField.total ?? tokenUsageField.input + tokenUsageField.output,
          }
        : fallbackUsage,
    itemCount,
  };
}
