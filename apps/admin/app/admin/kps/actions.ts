/**
 * F4.2 KP 创建 / 更新 server actions。
 *
 *  - 写操作前都校验 session（防绕过 middleware 直调）
 *  - 学科内 name 唯一在 schema 层有 @@unique([subject_id, name])，
 *    这里再额外捕获 P2002 给一个友好提示
 *  - 提交后 revalidatePath 触发列表刷新；成功重定向到列表页（同时关闭 modal）
 */
'use server';

import { Prisma, prisma } from '@hao/db';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { SESSION_COOKIE, verifySession } from '../../../lib/auth';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

export interface KpFormState {
  error: string | null;
}

const KpSchema = z.object({
  name: z.string().trim().min(1, 'name 必填').max(100, 'name 过长'),
  subject_id: z.string().trim().min(1, 'subject_id 必填'),
  // 表单空字符串 → null
  chapter_no: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

function parseForm(formData: FormData) {
  return KpSchema.safeParse({
    name: formData.get('name') ?? '',
    subject_id: formData.get('subject_id') ?? '',
    chapter_no: formData.get('chapter_no') ?? '',
  });
}

export async function createKpAction(_prev: KpFormState, formData: FormData): Promise<KpFormState> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '表单校验失败' };
  }
  try {
    await prisma.knowledge_point.create({ data: parsed.data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: '该学科下已存在同名 KP' };
    }
    throw e;
  }
  revalidatePath('/admin/kps');
  redirect('/admin/kps');
}

export async function updateKpAction(_prev: KpFormState, formData: FormData): Promise<KpFormState> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'id 缺失' };
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '表单校验失败' };
  }
  try {
    await prisma.knowledge_point.update({ where: { id }, data: parsed.data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return { error: '该学科下已存在同名 KP' };
      if (e.code === 'P2025') return { error: 'KP 不存在或已删除' };
    }
    throw e;
  }
  revalidatePath('/admin/kps');
  redirect('/admin/kps');
}
