/**
 * F3.3–F3.7 staging 审核 server actions（对照 /admin/kps/import/[uploadId]/actions.ts）。
 *
 *   - acceptStagingAction (F3.7)：事务里写 question + audit_log + 更新 staging
 *     T3：question_type ∈ {choice, fill_in} + kp_ids 非空 + primary_kp_id ∈ kp_ids（DB schema 兜底但应用层先校）
 *     T4：audit_log.target_id == question.id（同一事务，必一致）
 *   - rejectStagingAction：仅 review_status='rejected'
 *   - rerunStagingAction (F3.6 / T7)：选 provider → 新建 llm_parse_job → 同一文件跑一遍
 *     analyzeLearningResource → 用 question_no / content 匹配本 staging 行 → 覆盖 llm_payload + 把 parse_job_id 指到新 job
 *   - bulkAcceptAllAction / bulkRejectAllAction：dev-only 批量操作（对照 KP 版）
 *   - getJobProgressAction：客户端轮询返回 QuestionProgressSnapshot
 *
 * accept 时 review_payload 写最终 { content, question_type, options, answer, solution_text,
 * difficulty, kp_ids, primary_kp_id, subject_id }，llm_payload 保持只读不动。
 */
'use server';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@hao/db';
import { createStore } from '@hao/storage';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { buildStoredAnalysisFile } from '../../../../../lib/analysis-file';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/auth';
import {
  knowledgeRowsForQuestionContext,
  learningResourceToStagingPayloads,
  questionContentKey,
  questionNoFromPayload,
  tokenUsageFromEducationUsage,
  tokenUsageTotal,
} from '../../../../../lib/education-analysis-adapter';
import {
  createQuestionSourceForPayload,
  ensurePublishedSourceDocumentForUpload,
  publishLearningMaterialStaging,
} from '../../../../../lib/learning-resource-publish';
import {
  documentAnalysisProtocolLabel,
  getLlmProviderById,
  isDocumentAnalysisProvider,
} from '../../../../../lib/llm-providers';
import {
  createQuestionAnalysisCache,
  resolveQuestionAnalysisRuntime,
} from '../../../../../lib/question-analysis-runtime';
import { createAndPersistQuestionFigureCropAssets } from '../../../../../lib/question-figure-assets';
import {
  QUESTION_PROMPT_VERSION,
  type QuestionProgressSnapshot,
  runQuestionAnalysis,
} from '../../../../../lib/question-pipeline';
import { buildSupportingAcceptPlan } from '../../../../../lib/supporting-staging-bulk';

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
    question_type: z.enum(['choice', 'fill_in']),
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
    if (d.question_type === 'choice' && d.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options_json'],
        message: 'choice 题至少 2 个选项',
      });
    }
    if (d.question_type === 'fill_in' && d.options.length > 0) {
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
    question_type: formData.get('question_type'),
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

  const staging = await prisma.llm_parse_staging.findUnique({
    where: { id: d.staging_id },
    include: { upload: true },
  });
  if (!staging) return { error: 'staging 不存在' };
  if (staging.entity_kind !== 'question') return { error: '该 staging 不是 question' };

  let publishedQuestionId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // T3：写 question
      const question = await tx.question.create({
        data: {
          content: d.content,
          answer: d.answer,
          solution_text: d.solution_text,
          difficulty: d.difficulty,
          question_type: d.question_type,
          kp_ids: d.kp_ids,
          primary_kp_id: d.primary_kp_id,
        },
      });
      publishedQuestionId = question.id;

      const { sourceDocumentId } = await ensurePublishedSourceDocumentForUpload(tx, {
        uploadId: staging.upload_id,
        subjectId: d.subject_id,
        reviewedBy: session.sub,
      });
      await createQuestionSourceForPayload(tx, {
        questionId: question.id,
        sourceDocumentId,
        payload: staging.llm_payload,
      });

      // T4：同事务写 audit_log，target_id 必等于 question.id
      await tx.audit_log.create({
        data: {
          actor_id: session.sub,
          action: 'publish_question',
          target_type: 'question',
          target_id: question.id,
          payload: {
            staging_id: d.staging_id,
            subject_id: d.subject_id,
            source_document_id: sourceDocumentId,
            kp_ids: d.kp_ids,
            primary_kp_id: d.primary_kp_id,
            question_type: d.question_type,
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
            question_type: d.question_type,
            options: d.options,
            answer: d.answer,
            solution_text: d.solution_text,
            difficulty: d.difficulty,
            kp_ids: d.kp_ids,
            primary_kp_id: d.primary_kp_id,
            subject_id: d.subject_id,
            source_ref: (staging.llm_payload as { source_ref?: unknown }).source_ref ?? null,
          } as Prisma.InputJsonValue,
          reviewed_by: session.sub,
          reviewed_at: new Date(),
          published_id: question.id,
        },
      });
    });
    if (publishedQuestionId) {
      await createAndPersistQuestionFigureCropAssets({
        staging,
        publishedQuestionId,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 200) };
  }

  revalidatePath('/admin/questions');
  const upload_id = String(formData.get('upload_id') ?? '');
  if (upload_id) revalidatePath(`/admin/questions/import/${upload_id}`);
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
  if (upload_id) revalidatePath(`/admin/questions/import/${upload_id}`);
  revalidatePath('/admin/questions');
}

export interface LearningResourceEntityActionState {
  error: string | null;
  ok?: boolean;
}

export async function acceptSourceDocumentStagingAction(
  _prev: LearningResourceEntityActionState,
  formData: FormData,
): Promise<LearningResourceEntityActionState> {
  const session = await requireAdmin();
  const stagingId = String(formData.get('staging_id') ?? '');
  const subjectId = String(formData.get('subject_id') ?? '');
  if (!stagingId || !subjectId) return { error: 'staging_id / subject_id 缺失' };

  const staging = await prisma.llm_parse_staging.findUnique({ where: { id: stagingId } });
  if (!staging) return { error: 'staging 不存在' };
  if (staging.entity_kind !== 'source_document')
    return { error: '该 staging 不是 source_document' };

  try {
    await prisma.$transaction(async (tx) => {
      const { sourceDocumentId } = await ensurePublishedSourceDocumentForUpload(tx, {
        uploadId: staging.upload_id,
        subjectId,
        reviewedBy: session.sub,
      });
      await tx.audit_log.create({
        data: {
          actor_id: session.sub,
          action: 'publish_source_document',
          target_type: 'source_document',
          target_id: sourceDocumentId,
          payload: {
            staging_id: staging.id,
            subject_id: subjectId,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 200) };
  }

  const uploadId = String(formData.get('upload_id') ?? staging.upload_id);
  revalidatePath(`/admin/questions/import/${uploadId}`);
  return { error: null, ok: true };
}

export async function acceptLearningMaterialStagingAction(
  _prev: LearningResourceEntityActionState,
  formData: FormData,
): Promise<LearningResourceEntityActionState> {
  const session = await requireAdmin();
  const stagingId = String(formData.get('staging_id') ?? '');
  const subjectId = String(formData.get('subject_id') ?? '');
  if (!stagingId || !subjectId) return { error: 'staging_id / subject_id 缺失' };

  try {
    await prisma.$transaction(async (tx) => {
      const materialId = await publishLearningMaterialStaging(tx, {
        stagingId,
        subjectId,
        reviewedBy: session.sub,
      });
      await tx.audit_log.create({
        data: {
          actor_id: session.sub,
          action: 'publish_learning_material',
          target_type: 'learning_material',
          target_id: materialId,
          payload: {
            staging_id: stagingId,
            subject_id: subjectId,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 200) };
  }

  const uploadId = String(formData.get('upload_id') ?? '');
  if (uploadId) revalidatePath(`/admin/questions/import/${uploadId}`);
  return { error: null, ok: true };
}

export async function bulkAcceptSupportingStagingsAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const session = await requireAdmin();
  const uploadId = String(formData.get('upload_id') ?? '');
  const fallbackSubjectId = String(formData.get('subject_id') ?? '');
  if (!uploadId) return { error: 'upload_id 缺失' };

  const stagings = await prisma.llm_parse_staging.findMany({
    where: {
      upload_id: uploadId,
      review_status: 'pending',
      entity_kind: { in: ['source_document', 'learning_material'] },
    },
    select: {
      id: true,
      upload_id: true,
      entity_kind: true,
      review_status: true,
      llm_payload: true,
    },
    orderBy: { created_at: 'asc' },
  });
  const stagingById = new Map(stagings.map((staging) => [staging.id, staging]));
  const plan = buildSupportingAcceptPlan(stagings, fallbackSubjectId);
  let accepted = 0;
  const skipReasons = [...plan.skipReasons];

  for (const item of plan.items) {
    const staging = stagingById.get(item.id);
    if (!staging) {
      skipReasons.push(`${item.id.slice(0, 8)} 已不存在`);
      continue;
    }

    try {
      if (item.entityKind === 'source_document') {
        await prisma.$transaction(async (tx) => {
          const { sourceDocumentId, sourcePayload } = await ensurePublishedSourceDocumentForUpload(
            tx,
            {
              uploadId,
              subjectId: item.subjectId,
              reviewedBy: session.sub,
            },
          );
          await tx.llm_parse_staging.update({
            where: { id: item.id },
            data: {
              review_status: 'accepted',
              review_payload: {
                ...sourcePayload,
                subject_id: item.subjectId,
                bulk: true,
              } as Prisma.InputJsonValue,
              reviewed_by: session.sub,
              reviewed_at: new Date(),
              published_id: sourceDocumentId,
            },
          });
          await tx.audit_log.create({
            data: {
              actor_id: session.sub,
              action: 'publish_source_document',
              target_type: 'source_document',
              target_id: sourceDocumentId,
              payload: {
                staging_id: item.id,
                subject_id: item.subjectId,
                bulk: true,
              } as Prisma.InputJsonValue,
            },
          });
        });
      } else {
        await prisma.$transaction(async (tx) => {
          const materialId = await publishLearningMaterialStaging(tx, {
            stagingId: item.id,
            subjectId: item.subjectId,
            reviewedBy: session.sub,
          });
          await tx.audit_log.create({
            data: {
              actor_id: session.sub,
              action: 'publish_learning_material',
              target_type: 'learning_material',
              target_id: materialId,
              payload: {
                staging_id: item.id,
                subject_id: item.subjectId,
                bulk: true,
              } as Prisma.InputJsonValue,
            },
          });
        });
      }
      accepted += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push(`${supportingKindLabel(item.entityKind)} ${item.id.slice(0, 8)}：${msg}`);
    }
  }

  revalidatePath(`/admin/questions/import/${uploadId}`);
  return {
    error: null,
    ok: true,
    accepted,
    skipped: skipReasons.length,
    skipReasons: skipReasons.slice(0, 20),
  };
}

function supportingKindLabel(kind: 'source_document' | 'learning_material'): string {
  return kind === 'source_document' ? '来源资料' : '学习材料';
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
 *   1) 新建 llm_parse_job(task_kind='mixed_learning_material', provider=new)
 *   2) 把同一文件跑一遍 analyzeLearningResource
 *   3) 在结果里找匹配本题的那条（先按 question_no 精确匹配，找不到回退 content 前 60 字相似度），
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
  if (staging.entity_kind !== 'question') {
    return { error: '该 staging 不是 question' };
  }

  const provider = await getLlmProviderById(providerId);
  if (!provider || !provider.enabled) return { error: `provider ${providerId} 不存在 / 未启用` };
  if (!isDocumentAnalysisProvider(provider)) {
    return {
      error: `rerun 只支持 ${documentAnalysisProtocolLabel()} 的 provider；当前 ${provider.id}`,
    };
  }
  const llmPayload = staging.llm_payload as {
    source_hint?: { page?: number | null; question_no?: string | null };
    content?: string;
    _subject_id?: string;
  };
  const subjectId = llmPayload._subject_id ?? '';
  if (!subjectId) return { error: 'staging 缺 _subject_id' };

  const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
  if (!subject) return { error: `subject ${subjectId} 不存在` };

  const srcPage = llmPayload.source_hint?.page ?? null;
  const srcQuestionNo = questionNoFromPayload(llmPayload);
  const oldContentKey = questionContentKey(llmPayload);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: staging.upload_id,
      task_kind: 'mixed_learning_material',
      provider_id: provider.db_id,
      prompt_version: QUESTION_PROMPT_VERSION,
      status: 'running',
    },
  });

  const store = createStore();
  let tmpPath: string | null = null;
  try {
    const buf = await store.get(staging.upload.file_uri);
    const tmpDir = path.join(tmpdir(), 'hao-admin-question-rerun');
    await mkdir(tmpDir, { recursive: true });
    const originalName = staging.upload.original_name ?? `${job.id}.pdf`;
    tmpPath = path.join(tmpDir, `${job.id}${path.extname(originalName) || '.pdf'}`);
    await writeFile(tmpPath, buf);
    const analysisFile = buildStoredAnalysisFile({
      bytes: buf,
      name: originalName,
      path: tmpPath,
      mimeType: staging.upload.file_type,
    });

    const existingKps = await prisma.knowledge_point.findMany({
      where: { subject_id: subjectId },
      select: { id: true, name: true, chapter_no: true },
      orderBy: [{ chapter_no: 'asc' }, { name: 'asc' }],
    });

    const runtime = resolveQuestionAnalysisRuntime();
    const result = await runQuestionAnalysis({
      providerId: provider.db_id,
      file: analysisFile,
      subject,
      knowledge: knowledgeRowsForQuestionContext(existingKps),
      concurrency: runtime.concurrency,
      maxRetries: runtime.maxRetries,
      cache: createQuestionAnalysisCache(),
    });
    const flattened = learningResourceToStagingPayloads(result, subjectId);
    const resultQuestions = flattened.questions;

    // 匹配：先按 question_no（不空），再按 content 前 60 字归一相似（startsWith / includes 兜底）
    const matched =
      (srcQuestionNo
        ? resultQuestions.find((question) => questionNoFromPayload(question) === srcQuestionNo)
        : null) ??
      resultQuestions.find(
        (question) =>
          oldContentKey.length > 10 &&
          questionContentKey(question).startsWith(oldContentKey.slice(0, 30)),
      ) ??
      resultQuestions[0];

    if (!matched) {
      throw new Error('rerun 没产出可匹配的题（学习资料解析结果中没有题目）');
    }

    const matchedPayload = matched;
    const resultRecord = result as Record<string, unknown>;
    const tokenUsage = tokenUsageTotal(tokenUsageFromEducationUsage(resultRecord.usage));
    const jobStatus = learningResourceParseJobStatus(result);
    const errorMessage = learningResourceErrorMessage(result);

    await prisma.$transaction([
      prisma.llm_parse_staging.update({
        where: { id: stagingId },
        data: {
          parse_job_id: job.id,
          llm_payload: {
            ...matchedPayload,
            _rerun: {
              previous_job_id: staging.parse_job_id,
              previous_provider_id: provider.id,
              matched_strategy:
                srcQuestionNo &&
                questionNoFromPayload(
                  matchedPayload as { source_hint?: { question_no?: string | null } },
                ) === srcQuestionNo
                  ? 'question_no'
                  : 'content_prefix',
            },
          } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.llm_parse_job.update({
        where: { id: job.id },
        data: {
          status: jobStatus,
          parsed_output: result as unknown as Prisma.InputJsonValue,
          token_usage: tokenUsage
            ? (tokenUsage as Prisma.InputJsonValue)
            : (Prisma.JsonNull as unknown as Prisma.InputJsonValue),
          raw_response: {
            ok: resultRecord.ok ?? null,
            diagnostics: result.diagnostics,
            pageCount: result.source_document.page_count,
            sourceDocumentTitle: result.source_document.title,
            learningMaterialCount: flattened.learningMaterials.length,
            questionCount: resultQuestions.length,
            rerun_source_page: srcPage,
          } as unknown as Prisma.InputJsonValue,
          error_message: errorMessage,
          finished_at: new Date(),
        },
      }),
    ]);

    revalidatePath(`/admin/questions/import/${staging.upload_id}`);
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
  accepted?: number;
  skipped?: number;
  skipReasons?: string[];
}

/**
 * 批量接受 pending stagings（运营人员"快进"用）。
 *
 * 逐条处理 —— 每条复用 acceptStagingAction 的核心逻辑（事务里写 question + audit_log + 更新 staging），
 * 但 kp_ids / primary_kp_id 由 kp_hints 在同学科 knowledge_point 表里按 name 自动解析（不命中的题跳过）。
 *
 * 跳过条件（写进 skipReasons 返回给前端，不抛错以免一条挡所有）：
 *   - 缺 _subject_id / content
 *   - kp_hints 全部在该学科里搜不到（v0.1 不自动新建 KP）
 *   - choice 题 options.length < 2
 *   - DB 事务失败（外键 / 字段长度）
 *
 * 与单条 accept 一致：question_type / kp_ids.len≥1 / primary∈kp_ids；同事务写 audit_log。
 *
 * 关于 dev-only：bulkRejectAll 是 dev-only（reject 不可逆是数据安全考量），
 * 但 bulkAccept 是常规运营动作，**不**加 ensureDevOnly —— 运营人员就是要在生产环境批量过题。
 */
export async function bulkAcceptAllAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const session = await requireAdmin();
  const upload_id = String(formData.get('upload_id') ?? '');
  if (!upload_id) return { error: 'upload_id 缺失' };

  const stagings = await prisma.llm_parse_staging.findMany({
    where: { upload_id, review_status: 'pending', entity_kind: 'question' },
    include: { upload: true },
    orderBy: { created_at: 'asc' },
  });

  if (stagings.length === 0) {
    return { error: null, ok: true, accepted: 0, skipped: 0, skipReasons: [] };
  }

  // 预取该上传涉及的所有学科 KP；下面用"双向 contains + 去后缀"做模糊匹配，避免
  // 精确等于太严（LLM 常加 "运算/方法/性质" 等后缀，例如 hint "集合的并集运算" vs DB "集合的并集"）。
  const subjectIds = Array.from(
    new Set(
      stagings
        .map((s) => (s.llm_payload as { _subject_id?: string })?._subject_id)
        .filter((x): x is string => !!x),
    ),
  );
  const allKps = await prisma.knowledge_point.findMany({
    where: { subject_id: { in: subjectIds } },
    select: { id: true, name: true, subject_id: true },
  });

  // 同 DiffDrawer 用的 searchKpsAction 一致：忽略大小写 + contains。再加去常见后缀做兜底。
  // 顺序：exact > 一方 contains 另一方 > 去后缀后 contains。命中第一个非空 bucket 即停。
  const NOISE_SUFFIXES = ['运算', '方法', '性质', '概念', '定义', '表示', '关系', '判定'];
  const stripNoise = (s: string) => {
    let out = s;
    let changed = true;
    while (changed) {
      changed = false;
      for (const suf of NOISE_SUFFIXES) {
        if (out.endsWith(suf) && out.length > suf.length) {
          out = out.slice(0, -suf.length);
          changed = true;
        }
      }
    }
    return out;
  };
  const kpsBySubject = new Map<string, Array<{ id: string; name: string; norm: string }>>();
  for (const kp of allKps) {
    const norm = kp.name.trim().toLowerCase();
    let bucket = kpsBySubject.get(kp.subject_id);
    if (!bucket) {
      bucket = [];
      kpsBySubject.set(kp.subject_id, bucket);
    }
    bucket.push({ id: kp.id, name: kp.name, norm });
  }

  function matchKp(subjectId: string, hint: string): string | null {
    const pool = kpsBySubject.get(subjectId);
    if (!pool) return null;
    const h = hint.trim().toLowerCase();
    if (!h) return null;
    // 1) exact
    const exact = pool.find((k) => k.norm === h);
    if (exact) return exact.id;
    // 2) 双向 contains（与 searchKpsAction 一致的 ilike 语义）
    const contains = pool.find((k) => k.norm.includes(h) || h.includes(k.norm));
    if (contains) return contains.id;
    // 3) 去后缀后再 contains（"集合的并集运算" → "集合的并集"）
    const hStripped = stripNoise(h);
    if (hStripped && hStripped !== h) {
      const after = pool.find((k) => k.norm.includes(hStripped) || hStripped.includes(k.norm));
      if (after) return after.id;
    }
    // 4) 最长公共子串：cover "并集及其运算" ↔ "集合的并集"（共享 "并集"）这类只在中间共享的情况。
    //    阈值：LCS ≥ 3 直接采纳；LCS = 2 仅当不是"集合 / 函数 / 方程 / 命题"等通用领域词时采纳
    //    （否则任何含"集合"的 hint 都会乱匹配上随便一条含"集合"的 KP）。
    //    在所有 pool 里取 LCS 最长的一条。
    let bestId: string | null = null;
    let bestLen = 0;
    for (const k of pool) {
      const lcs = longestCommonSubstring(h, k.norm);
      if (lcs < 2) continue;
      if (lcs === 2) {
        const sub = longestCommonSubstringText(h, k.norm);
        if (GENERIC_2CHAR_STOPS.has(sub)) continue;
      }
      if (lcs > bestLen) {
        bestLen = lcs;
        bestId = k.id;
      }
    }
    return bestId;
  }

  /** 通用 2-字领域词；hint 与 kp 仅在这些上共享时不算匹配（高假阳）。 */
  const GENERIC_2CHAR_STOPS = new Set([
    '集合',
    '函数',
    '方程',
    '不等',
    '命题',
    '数列',
    '向量',
    '直线',
    '平面',
    '导数',
    '概率',
    '统计',
    '复数',
    '空间',
    '图象',
    '关系',
    '运算',
    '思想',
    '方法',
    '应用',
    '问题',
  ]);

  /** 经典 DP，O(n×m)。n,m 都 ≤ 30 字，单次调用 ~1k op，可忽略。 */
  function longestCommonSubstring(a: string, b: string): number {
    if (!a || !b) return 0;
    const m = a.length;
    const n = b.length;
    let prev: number[] = new Array<number>(n + 1).fill(0);
    let curr: number[] = new Array<number>(n + 1).fill(0);
    let best = 0;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          const v = (prev[j - 1] ?? 0) + 1;
          curr[j] = v;
          if (v > best) best = v;
        } else {
          curr[j] = 0;
        }
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
      curr.fill(0);
    }
    return best;
  }

  /** 同 longestCommonSubstring，但返回那个子串本身，用于做 stopword 检查。 */
  function longestCommonSubstringText(a: string, b: string): string {
    if (!a || !b) return '';
    const m = a.length;
    const n = b.length;
    let prev: number[] = new Array<number>(n + 1).fill(0);
    let curr: number[] = new Array<number>(n + 1).fill(0);
    let best = 0;
    let endI = 0;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          const v = (prev[j - 1] ?? 0) + 1;
          curr[j] = v;
          if (v > best) {
            best = v;
            endI = i;
          }
        } else {
          curr[j] = 0;
        }
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
      curr.fill(0);
    }
    return a.slice(endI - best, endI);
  }

  let accepted = 0;
  const skipReasons: string[] = [];

  function skipReasonLabel(
    payload: {
      content?: string;
      source_hint?: { page?: number | null; question_no?: string | null };
    },
    fallbackId: string,
  ): string {
    const sourceParts: string[] = [];
    if (payload.source_hint?.page) sourceParts.push(`p${payload.source_hint.page}`);
    if (payload.source_hint?.question_no) sourceParts.push(payload.source_hint.question_no);
    if (sourceParts.length > 0) return `原文 ${sourceParts.join(' · ')}`;
    const summary = (payload.content ?? '').replace(/\s+/g, ' ').slice(0, 30);
    return summary || `staging:${fallbackId.slice(0, 8)}`;
  }

  for (const s of stagings) {
    const payload = s.llm_payload as {
      content?: string;
      question_type?: 'choice' | 'fill_in';
      options?: Array<{ label: string; text: string }>;
      answer?: string;
      solution_text?: string;
      difficulty?: number;
      kp_hints?: string[];
      source_hint?: { page?: number | null; question_no?: string | null };
      _subject_id?: string;
    };

    const label = skipReasonLabel(payload, s.id);
    const subjectId = payload._subject_id ?? '';
    const questionType = payload.question_type ?? 'choice';
    const content = (payload.content ?? '').trim();
    const answer = (payload.answer ?? '').trim();
    const options = Array.isArray(payload.options) ? payload.options : [];

    if (!subjectId) {
      skipReasons.push(`「${label}…」缺 _subject_id`);
      continue;
    }
    if (content.length < 5) {
      skipReasons.push(`「${label}…」content 过短`);
      continue;
    }
    if (!answer) {
      skipReasons.push(`「${label}…」缺 answer`);
      continue;
    }
    if (questionType === 'choice' && options.length < 2) {
      skipReasons.push(`「${label}…」choice 题 options < 2`);
      continue;
    }

    // kp_hints → kp_ids（模糊匹配同学科 KP；见上方 matchKp）
    const hints = (payload.kp_hints ?? []).map((h) => h.trim()).filter((h) => h.length > 0);
    const kpIds: string[] = [];
    const seen = new Set<string>();
    for (const hint of hints) {
      const id = matchKp(subjectId, hint);
      if (id && !seen.has(id)) {
        seen.add(id);
        kpIds.push(id);
      }
    }
    if (kpIds.length === 0) {
      skipReasons.push(
        `「${label}…」kp_hints (${hints.join(', ') || '空'}) 在该学科无匹配 KP，需人工处理`,
      );
      continue;
    }
    const primaryKpId = kpIds[0];
    if (!primaryKpId) {
      skipReasons.push(`「${label}…」kp_ids 为空，需人工处理`);
      continue;
    }
    const difficulty = Math.min(5, Math.max(1, payload.difficulty ?? 3));
    const solution = (payload.solution_text ?? '').slice(0, 3000);

    try {
      let publishedQuestionId: string | null = null;
      await prisma.$transaction(async (tx) => {
        const question = await tx.question.create({
          data: {
            content,
            answer,
            solution_text: solution,
            difficulty,
            question_type: questionType,
            kp_ids: kpIds,
            primary_kp_id: primaryKpId,
          },
        });
        publishedQuestionId = question.id;
        const { sourceDocumentId } = await ensurePublishedSourceDocumentForUpload(tx, {
          uploadId: s.upload_id,
          subjectId,
          reviewedBy: session.sub,
        });
        await createQuestionSourceForPayload(tx, {
          questionId: question.id,
          sourceDocumentId,
          payload: s.llm_payload,
        });
        await tx.audit_log.create({
          data: {
            actor_id: session.sub,
            action: 'publish_question',
            target_type: 'question',
            target_id: question.id,
            payload: {
              staging_id: s.id,
              subject_id: subjectId,
              kp_ids: kpIds,
              primary_kp_id: primaryKpId,
              question_type: questionType,
              difficulty,
              source_document_id: sourceDocumentId,
              bulk: true,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.llm_parse_staging.update({
          where: { id: s.id },
          data: {
            review_status: 'accepted',
            review_payload: {
              content,
              question_type: questionType,
              options,
              answer,
              solution_text: solution,
              difficulty,
              kp_ids: kpIds,
              primary_kp_id: primaryKpId,
              subject_id: subjectId,
              source_ref: (s.llm_payload as { source_ref?: unknown }).source_ref ?? null,
            } as Prisma.InputJsonValue,
            reviewed_by: session.sub,
            reviewed_at: new Date(),
            published_id: question.id,
          },
        });
      });
      if (publishedQuestionId) {
        await createAndPersistQuestionFigureCropAssets({
          staging: s,
          publishedQuestionId,
        });
      }
      accepted += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push(`「${label}…」事务失败：${msg.slice(0, 100)}`);
    }
  }

  revalidatePath(`/admin/questions/import/${upload_id}`);
  revalidatePath('/admin/questions');
  return {
    error: null,
    ok: true,
    accepted,
    skipped: skipReasons.length,
    skipReasons: skipReasons.slice(0, 20), // 防止溢出
  };
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
    where: { upload_id, review_status: 'pending', entity_kind: 'question' },
    data: { review_status: 'rejected', reviewed_by: session.sub, reviewed_at: new Date() },
  });

  revalidatePath(`/admin/questions/import/${upload_id}`);
  revalidatePath('/admin/questions');
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
  progress: QuestionProgressSnapshot | null;
  tokenUsage: { input: number; output: number; total: number } | null;
  questionCount: number;
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
    (job.raw_response as { progress?: QuestionProgressSnapshot } | null)?.progress ?? null;
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

  const questionCount = await prisma.llm_parse_staging.count({
    where: { parse_job_id: jobId, entity_kind: 'question' },
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
    questionCount,
  };
}

function learningResourceParseJobStatus(result: {
  diagnostics?: {
    parse_error?: unknown | null;
    validation_error?: unknown | null;
  };
  [key: string]: unknown;
}): 'succeeded' | 'failed' {
  if (result.ok === false) return 'failed';
  if (result.diagnostics?.parse_error != null || result.diagnostics?.validation_error != null) {
    return 'failed';
  }
  return 'succeeded';
}

function learningResourceErrorMessage(result: {
  diagnostics?: {
    parse_error?: unknown | null;
    validation_error?: unknown | null;
  };
  [key: string]: unknown;
}): string | null {
  if (learningResourceParseJobStatus(result) === 'succeeded') return null;
  const reason =
    result.diagnostics?.parse_error ??
    result.diagnostics?.validation_error ??
    'analyzeLearningResource returned failed';
  return typeof reason === 'string' ? reason : JSON.stringify(reason).slice(0, 500);
}
