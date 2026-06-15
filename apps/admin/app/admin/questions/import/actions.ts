/**
 * F3.1 / F3.2 上传 + 触发解析 server actions（同构对照 apps/admin/app/admin/kps/import/actions.ts）。
 *
 * 流程：
 *   1. uploadAndParseAction：multipart → 算 sha256 → @hao/storage 落盘（CAS）
 *      → 写 content_upload(purpose='question', file_uri=storage key, sha256)
 *      → 预创建 llm_parse_job(task_kind='question', status='queued')
 *      → void runQuestionParse() 抛进事件循环 → 立刻 redirect 到 staging 页
 *   2. reparseUploadAction：同一 upload，旧 zombie job 先标 failed，再起新 job
 *
 * 与 KP 路径的差异（除了 task_kind）：
 *   - 文件上限 50MB（PDF / Word）
 *   - file_uri 即 storage key（不是 file:// 绝对路径）；后端读用 store.get(key)
 *   - runQuestionParse 在 lib/question-runner.ts —— 不要放回 'use server' 文件里：
 *     'use server' 文件的导出会被 Next 注册成 client-callable action，runParse
 *     不能作为公开 endpoint。
 *
 * T10：LLM 失败时 runQuestionParse 把 job.status='failed' + error_message；createMany
 * 包在事务最后，前面 throw 直接走 catch 分支，事务根本没开始 → staging 一行都不写。
 */
'use server';

import { prisma } from '@hao/db';
import { StoragePaths, createStore, extOf, sha256OfBuffer } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '../../../../lib/auth';
import {
  documentAnalysisProtocolLabel,
  getLlmProviderById,
  isDocumentAnalysisProvider,
} from '../../../../lib/llm-providers';
import { QUESTION_PROMPT_VERSION } from '../../../../lib/question-pipeline';
import { runQuestionParse } from '../../../../lib/question-runner';

async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new Error('未登录');
  return session;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_FILE_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

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

  if (!(file instanceof File) || file.size === 0) return { error: '请选择 PDF / Word 文件' };
  if (file.size > MAX_FILE_BYTES) {
    return { error: `文件超过 50MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` };
  }
  if (!isAcceptedQuestionFile(file)) {
    return { error: '仅支持 PDF / Word 文件' };
  }
  if (!subjectId) return { error: '请选择学科' };
  if (!providerId) return { error: '请选择 LLM Provider' };

  const provider = await getLlmProviderById(providerId);
  if (!provider || !provider.enabled) {
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  }
  if (!isDocumentAnalysisProvider(provider)) {
    return { error: `试题解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}` };
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
      file_type: 'question_pack',
      purpose: 'question',
      original_name: file.name,
      size_bytes: buf.byteLength,
      sha256,
    },
  });
  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: upload.id,
      task_kind: 'question',
      provider_id: providerId,
      prompt_version: QUESTION_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runQuestionParse(job.id, upload.id, providerId, subjectId);

  redirect(`/admin/questions/import/${upload.id}`);
}

function isAcceptedQuestionFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    ACCEPTED_FILE_MIME.includes(file.type) ||
    name.endsWith('.pdf') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  );
}

async function reapZombieJobs(uploadId: string): Promise<number> {
  const result = await prisma.llm_parse_job.updateMany({
    where: {
      upload_id: uploadId,
      status: { in: ['running', 'queued'] },
      task_kind: 'question',
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
  if (!provider || !provider.enabled) {
    return { error: `LLM Provider ${providerId} 不存在 / 未启用` };
  }
  if (!isDocumentAnalysisProvider(provider)) {
    return { error: `试题解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}` };
  }

  await reapZombieJobs(uploadId);

  const job = await prisma.llm_parse_job.create({
    data: {
      upload_id: uploadId,
      task_kind: 'question',
      provider_id: providerId,
      prompt_version: QUESTION_PROMPT_VERSION,
      status: 'queued',
    },
  });

  void runQuestionParse(job.id, uploadId, providerId, subjectId);
  redirect(`/admin/questions/import/${uploadId}`);
}
