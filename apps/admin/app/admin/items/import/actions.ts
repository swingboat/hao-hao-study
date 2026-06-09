/**
 * F3.1 / F3.2 上传 + 触发解析 server actions（同构对照 apps/admin/app/admin/kps/import/actions.ts）。
 *
 * 流程：
 *   1. uploadAndParseAction：multipart → 算 sha256 → @hao/storage 落盘（CAS）
 *      → 写 content_upload(purpose='practice_item', file_uri=storage key, sha256)
 *      → 预创建 llm_parse_job(task_kind='practice_item', status='queued')
 *      → void runItemParse() 抛进事件循环 → 立刻 redirect 到 staging 页
 *   2. reparseUploadAction：同一 upload，旧 zombie job 先标 failed，再起新 job
 *
 * 与 KP 路径的差异（除了 task_kind）：
 *   - 上传走 @hao/storage（KP 现在还在用 apps/admin/lib/storage 的 .run/uploads —— 那是 grandfathered，
 *     新业务按 AGENTS.md §通用规则 4 必须走抽象层）
 *   - PDF 上限 50MB（PRD §F3.1：题集 PDF ≤20MB，放宽到 50 容错）
 *   - file_uri 即 storage key（不是 file:// 绝对路径）；后端读用 store.get(key)
 *   - runItemParse 在 lib/item-runner.ts —— 不要放回 'use server' 文件里：
 *     'use server' 文件的导出会被 Next 注册成 client-callable action，runParse
 *     不能作为公开 endpoint。
 *
 * T10：LLM 失败时 runItemParse 把 job.status='failed' + error_message；createMany
 * 包在事务最后，前面 throw 直接走 catch 分支，事务根本没开始 → staging 一行都不写。
 */
'use server';

import { prisma } from '@hao/db';
import { StoragePaths, createStore, extOf, sha256OfBuffer } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import { ITEM_PROMPT_VERSION } from '../../../../lib/item-pipeline';
import { runItemParse } from '../../../../lib/item-runner';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_PDF_MIME = ['application/pdf'];

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

  if (!(file instanceof File) || file.size === 0) return { error: '请选择 PDF 文件' };
  if (file.size > MAX_FILE_BYTES) {
    return { error: `文件超过 50MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` };
  }
  if (!ACCEPTED_PDF_MIME.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
    return { error: '仅支持 PDF 文件' };
  }
  if (!subjectId) return { error: '请选择学科' };
  if (!providerId) return { error: '请选择 LLM Provider' };

  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled) {
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  }
  const caps = (provider.capabilities ?? {}) as { vision?: boolean };
  if (!caps.vision) {
    return { error: `Provider ${providerId} 不支持 vision；请改选有 vision 能力的 provider` };
  }

  // CAS：按 sha256 寻址，同份文件多次上传只存一份
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
      file_type: 'item_pack',
      purpose: 'practice_item',
      original_name: file.name,
      size_bytes: buf.byteLength,
      sha256,
    },
  });
  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: upload.id,
      task_kind: 'practice_item',
      provider_id: providerId,
      prompt_version: ITEM_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runItemParse(job.id, upload.id, providerId, subjectId);

  redirect(`/admin/items/import/${upload.id}`);
}

async function reapZombieJobs(uploadId: string): Promise<number> {
  const result = await prisma.llm_parse_job.updateMany({
    where: {
      upload_id: uploadId,
      status: { in: ['running', 'queued'] },
      task_kind: 'practice_item',
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

  const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled) {
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  }

  await reapZombieJobs(uploadId);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'practice_item',
      provider_id: providerId,
      prompt_version: ITEM_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runItemParse(job.id, uploadId, providerId, subjectId);
  redirect(`/admin/items/import/${uploadId}`);
}
