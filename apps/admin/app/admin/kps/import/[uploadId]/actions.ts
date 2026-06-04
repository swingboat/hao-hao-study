/**
 * F4.3 staging 审核 server actions。
 *
 *   - acceptStagingAction：写 knowledge_point + 更新 staging.review_status=accepted +
 *     published_id；带学科内 name 唯一冲突保护（P2002 → 跳过并标 reviewed_by）
 *   - rejectStagingAction：仅更新 staging.review_status=rejected
 *   - bulkAcceptAction：逐条调 accept；失败的累计后返回
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

      // 2. 更新 staging
      await tx.llm_parse_staging.update({
        where: { id: staging_id },
        data: {
          review_status: 'accepted',
          review_payload: { name, subject_id, chapter_no } as Prisma.InputJsonValue,
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
