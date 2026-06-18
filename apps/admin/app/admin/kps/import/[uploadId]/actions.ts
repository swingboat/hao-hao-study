/**
 * F4.3 staging 审核 server actions。
 *
 *   - acceptStagingAction：写 knowledge_point + 更新 staging.review_status=accepted +
 *     published_id；带学科内 name 唯一冲突保护（P2002 → 跳过并标 reviewed_by）
 *   - rejectStagingAction：仅更新 staging.review_status=rejected
 *   - bulkAcceptAction：逐条调 accept；失败的累计后返回
 *   - getJobProgressAction：客户端轮询 — 返回当前 job 的 status / progress / kpCount，
 *     poller 每 2s 调一次，终态后停轮询并 router.refresh
 *
 * accept 时 review_payload 写 { name, chapter_no, subject_id }（以 form 里的最终值为准），
 * llm_payload 保持只读。
 */
'use server';

import { type Prisma, prisma } from '@hao/db';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/auth';
import { upsertAdminKnowledgePointTextbookMapping } from '../../../../../lib/kp-textbook-mapping';
import type { ProgressSnapshot } from '../actions';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const AcceptSchema = z.object({
  staging_id: z.string().uuid('staging_id 非法'),
  name: z.string().trim().min(2).max(50),
  subject_id: z.string().min(1),
  chapter_no: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

export interface StagingActionState {
  error: string | null;
  ok?: boolean;
}

/**
 * 单条 accept：在事务里
 *   1) 写 knowledge_point（学科内 name 唯一，冲突 → 视为"已存在"，复用其 id）
 *   2) 更新 staging.review_status=accepted + published_id + review_payload
 */
export async function acceptStagingAction(
  _prev: StagingActionState,
  formData: FormData,
): Promise<StagingActionState> {
  const session = await requireAdmin();

  const parsed = AcceptSchema.safeParse({
    staging_id: formData.get('staging_id'),
    name: formData.get('name'),
    subject_id: formData.get('subject_id'),
    chapter_no: formData.get('chapter_no') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '表单校验失败' };
  }
  const { staging_id, name, subject_id, chapter_no } = parsed.data;
  const reviewPayload = { name, subject_id, chapter_no };

  const [staging, subject] = await Promise.all([
    prisma.llm_parse_staging.findUnique({
      where: { id: staging_id },
      include: { upload: true },
    }),
    prisma.subject.findUnique({
      where: { id: subject_id },
      select: { id: true, name: true, stage: true },
    }),
  ]);
  if (!staging) return { error: 'staging 不存在' };
  if (staging.entity_kind !== 'knowledge_point')
    return { error: '该 staging 不是 knowledge_point' };
  if (!subject) return { error: `subject ${subject_id} 不存在` };

  try {
    await prisma.$transaction(async (tx) => {
      // 1. 找/建 KP
      let kp = await tx.knowledge_point.findUnique({
        where: { subject_id_name: { subject_id, name } },
      });
      if (!kp) {
        kp = await tx.knowledge_point.create({
          data: { name, subject_id, chapter_no },
        });
      }
      await upsertAdminKnowledgePointTextbookMapping({
        db: tx,
        upload: staging.upload,
        subject,
        knowledgePoint: kp,
        reviewPayload,
        llmPayload: staging.llm_payload,
      });

      // 2. 更新 staging
      await tx.llm_parse_staging.update({
        where: { id: staging_id },
        data: {
          review_status: 'accepted',
          review_payload: reviewPayload as Prisma.InputJsonValue,
          reviewed_by: session.sub,
          reviewed_at: new Date(),
          published_id: kp.id,
        },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.slice(0, 200) };
  }

  revalidatePath('/admin/kps');
  // page.tsx 用 ?staging=<id> 高亮（可选），无 staging 即列表
  const upload_id = String(formData.get('upload_id') ?? '');
  if (upload_id) revalidatePath(`/admin/kps/import/${upload_id}`);
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
  if (upload_id) revalidatePath(`/admin/kps/import/${upload_id}`);
  revalidatePath('/admin/kps');
}

/**
 * 开发期批量动作：一次性把某个 upload 下所有 pending staging 全部 accept / reject。
 *
 * 仅在 NODE_ENV !== 'production' 时由 UI 暴露按钮；server action 这层也校验，
 * 避免有人误调（PRD 正式生产不允许 bulk 接受未审知识点）。
 *
 * accept-all：复用 acceptStagingAction 的 KP upsert 语义（学科内 name 唯一冲突 →
 * 复用已存在 KP id），单条失败不中断整批，最后聚合上报失败数。
 * reject-all：单条 updateMany 一发，原子。
 */
function ensureDevOnly() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('bulk-all 仅限开发环境');
  }
}

export interface BulkActionState {
  error: string | null;
  ok?: boolean;
  /** 成功条数 */
  accepted?: number;
  rejected?: number;
  /** 失败明细（前 5 条），方便页面上提示 */
  failures?: Array<{ stagingId: string; reason: string }>;
}

export async function bulkAcceptAllAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  ensureDevOnly();
  const session = await requireAdmin();
  const upload_id = String(formData.get('upload_id') ?? '');
  if (!upload_id) return { error: 'upload_id 缺失' };

  const pendings = await prisma.llm_parse_staging.findMany({
    where: { upload_id, review_status: 'pending', entity_kind: 'knowledge_point' },
    include: { upload: true },
  });
  const subjectIds = Array.from(
    new Set(
      pendings
        .map((s) => (s.llm_payload as { _subject_id?: unknown })._subject_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds } },
    select: { id: true, name: true, stage: true },
  });
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

  let accepted = 0;
  const failures: NonNullable<BulkActionState['failures']> = [];

  for (const s of pendings) {
    const payload = s.llm_payload as {
      name?: unknown;
      chapter_no?: unknown;
      _subject_id?: unknown;
    };
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const subject_id = typeof payload._subject_id === 'string' ? payload._subject_id : '';
    const chapter_no =
      typeof payload.chapter_no === 'string' && payload.chapter_no.trim() !== ''
        ? payload.chapter_no
        : null;

    if (name.length < 2 || name.length > 50 || !subject_id) {
      failures.push({
        stagingId: s.id,
        reason: `字段非法 name=${name.slice(0, 20)} subject_id=${subject_id || '∅'}`,
      });
      continue;
    }
    const subject = subjectById.get(subject_id);
    if (!subject) {
      failures.push({
        stagingId: s.id,
        reason: `subject ${subject_id} 不存在`,
      });
      continue;
    }

    try {
      const reviewPayload = { name, subject_id, chapter_no };
      await prisma.$transaction(async (tx) => {
        let kp = await tx.knowledge_point.findUnique({
          where: { subject_id_name: { subject_id, name } },
        });
        if (!kp) {
          kp = await tx.knowledge_point.create({
            data: { name, subject_id, chapter_no },
          });
        }
        await upsertAdminKnowledgePointTextbookMapping({
          db: tx,
          upload: s.upload,
          subject,
          knowledgePoint: kp,
          reviewPayload,
          llmPayload: s.llm_payload,
        });
        await tx.llm_parse_staging.update({
          where: { id: s.id },
          data: {
            review_status: 'accepted',
            review_payload: reviewPayload as Prisma.InputJsonValue,
            reviewed_by: session.sub,
            reviewed_at: new Date(),
            published_id: kp.id,
          },
        });
      });
      accepted += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ stagingId: s.id, reason: msg.slice(0, 120) });
    }
  }

  revalidatePath(`/admin/kps/import/${upload_id}`);
  revalidatePath('/admin/kps');
  return {
    error: failures.length ? `${failures.length} 条失败（共 ${pendings.length} 条 pending）` : null,
    ok: failures.length === 0,
    accepted,
    failures: failures.slice(0, 5),
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
    where: { upload_id, review_status: 'pending', entity_kind: 'knowledge_point' },
    data: {
      review_status: 'rejected',
      reviewed_by: session.sub,
      reviewed_at: new Date(),
    },
  });

  revalidatePath(`/admin/kps/import/${upload_id}`);
  revalidatePath('/admin/kps');
  return { error: null, ok: true, rejected: result.count };
}

/**
 * 客户端轮询用：返回某个 job 的实时状态 + 进度 + 已落 staging 行数。
 * 终态（succeeded / failed）时，poller 应停止轮询并 router.refresh 刷整页。
 *
 * 不做鉴权宽松化 —— 仍然要 admin session（避免被外部脚本暴力遍历 jobId）。
 */
export interface JobProgressView {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  errorMessage: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  promptVersion: string;
  providerId: string;
  /** 实时进度快照（运行中有值，终态后通常被 final raw_response 覆盖掉） */
  progress: ProgressSnapshot | null;
  /** 累计 token 用量（终态后从 token_usage 字段读，运行中从 progress.tokenUsageSoFar 估算） */
  tokenUsage: { input: number; output: number; total: number } | null;
  /** 已落 llm_parse_staging 行数（succeeded 后等于最终 KP 数；运行中通常 0，因为 staging 在最末写） */
  kpCount: number;
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
    (job.raw_response as { progress?: ProgressSnapshot } | null)?.progress ?? null;
  const tokenUsageField = job.token_usage as {
    input?: number;
    output?: number;
    total?: number;
  } | null;
  const progressUsage = rawProgress?.tokenUsageSoFar
    ? {
        input: rawProgress.tokenUsageSoFar.input,
        output: rawProgress.tokenUsageSoFar.output,
        total: rawProgress.tokenUsageSoFar.input + rawProgress.tokenUsageSoFar.output,
      }
    : null;

  const kpCount = await prisma.llm_parse_staging.count({
    where: { parse_job_id: jobId, entity_kind: 'knowledge_point' },
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
        : progressUsage,
    kpCount,
  };
}
