/**
 * F2.1 Provider 启停 server action。
 *
 * 仅切换 `enabled` 字段；其余字段 v0.1 通过 SQL/seed 维护（PRD §3.5 排他：无 Provider CRUD UI）。
 * 任何写操作前都校验 session，避免 server action 被直接调用绕过 middleware。
 */
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import { setLlmProviderEnabled } from '../../../../lib/llm-providers';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

export async function toggleProviderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const next = String(formData.get('next') ?? '') === 'true';
  if (!id) throw new Error('Provider id 缺失');

  await setLlmProviderEnabled(id, next);
  revalidatePath('/admin/settings/llm');
}
