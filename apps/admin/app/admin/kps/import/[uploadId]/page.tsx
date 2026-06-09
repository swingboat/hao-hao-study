/**
 * F4.3 staging 审核页 — /admin/kps/import/[uploadId]
 *
 *   - 顶部：上传元信息 + 最近一次 job 状态（失败时红字 + 错误摘要）
 *   - 主体：pending staging 列表 — 行内可编辑 name / chapter_no，逐条接受 / 丢弃
 *   - 已处理（accepted / rejected）单独折叠展示
 *
 * subject_id 不在 LLM 输出里（schema 注释明确"由调用方上下文注入"），
 * 解析时 admin 把 subject_id 塞进 llm_payload._subject_id 透传到这里。
 */
import { prisma } from '@hao/db';
import Link from 'next/link';
import { reparseUploadAction } from '../actions';
import { DevBulkBar } from './dev-bulk-bar';
import { JobProgressPoller } from './job-progress-poller';
import { StagingRow } from './staging-row';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ uploadId: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function StagingReviewPage({ params, searchParams }: PageProps) {
  const { uploadId } = await params;
  const { error: parseError } = await searchParams;

  const upload = await prisma.content_upload.findUnique({
    where: { id: uploadId },
    include: {
      llm_parse_jobs: { orderBy: { created_at: 'desc' }, take: 1 },
      llm_parse_stagings: { orderBy: { created_at: 'asc' } },
    },
  });

  if (!upload) {
    return (
      <main className="p-8 max-w-4xl mx-auto">
        <p className="text-red-600">upload {uploadId} 不存在。</p>
        <Link href="/admin/kps/import" className="underline text-sm">
          ← 返回上传页
        </Link>
      </main>
    );
  }

  const subjects = await prisma.subject.findMany();
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const lastJob = upload.llm_parse_jobs[0];
  const pending = upload.llm_parse_stagings.filter((s) => s.review_status === 'pending');
  const processed = upload.llm_parse_stagings.filter((s) => s.review_status !== 'pending');

  return (
    <main className="p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">KP 解析审核</h1>
          <p className="text-sm opacity-60 mt-1">
            上传：{upload.original_name ?? '(未命名)'} · {upload.created_at.toLocaleString('zh-CN')}
          </p>
        </div>
        <Link href="/admin/kps/import" className="text-sm underline opacity-70 hover:opacity-100">
          ← 返回上传列表
        </Link>
      </header>

      {parseError ? (
        <section className="border border-red-500 rounded-lg p-3 text-sm text-red-700 bg-red-50 dark:bg-red-950/30">
          上传失败：{parseError}
        </section>
      ) : null}

      {lastJob && (lastJob.status === 'queued' || lastJob.status === 'running') ? (
        <JobProgressPoller jobId={lastJob.id} initialStatus={lastJob.status} />
      ) : null}

      {lastJob && lastJob.status === 'failed' ? (
        <section className="border-2 border-red-500 rounded-lg p-4 bg-red-50/50 dark:bg-red-950/30 space-y-3">
          <p className="font-medium text-sm text-red-700 dark:text-red-300">❌ 上次解析失败</p>
          {lastJob.error_message ? (
            <p className="text-xs font-mono text-red-700 dark:text-red-300 break-all">
              {lastJob.error_message}
            </p>
          ) : null}
          <form
            action={async (formData: FormData) => {
              'use server';
              await reparseUploadAction({ error: null }, formData);
            }}
            className="flex flex-wrap items-end gap-3 pt-1"
          >
            <input type="hidden" name="upload_id" value={upload.id} />
            <input type="hidden" name="provider_id" value={lastJob.provider_id} />
            <div>
              <label className="block text-xs opacity-70 mb-1" htmlFor="reparse_subject_id">
                学科
              </label>
              <select
                id="reparse_subject_id"
                name="subject_id"
                required
                defaultValue={subjects[0]?.id ?? ''}
                className="px-3 py-2 border rounded text-sm bg-transparent"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.id}）
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 cursor-pointer"
            >
              重新解析（{lastJob.provider_id}）
            </button>
          </form>
        </section>
      ) : null}

      {lastJob ? (
        <section className="border rounded-lg p-3 text-sm flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span>
            <span className="opacity-60">job</span>{' '}
            <span
              className={
                lastJob.status === 'failed'
                  ? 'text-red-600'
                  : lastJob.status === 'succeeded'
                    ? 'text-green-600'
                    : ''
              }
            >
              {lastJob.status}
            </span>
          </span>
          <span>
            <span className="opacity-60">provider</span>{' '}
            <code className="text-xs">{lastJob.provider_id}</code>
          </span>
          <span>
            <span className="opacity-60">prompt</span>{' '}
            <code className="text-xs">{lastJob.prompt_version}</code>
          </span>
          {lastJob.latency_ms != null ? (
            <span>
              <span className="opacity-60">耗时</span> {(lastJob.latency_ms / 1000).toFixed(1)}s
            </span>
          ) : null}
          {lastJob.token_usage ? (
            <span>
              <span className="opacity-60">tokens</span>{' '}
              {(lastJob.token_usage as { total?: number }).total ?? '?'}
            </span>
          ) : null}
          {lastJob.error_message ? (
            <span className="basis-full text-xs text-red-600 mt-1">
              错误：{lastJob.error_message}
            </span>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="font-medium mb-3">
          待审核（{pending.length}）
          {pending.length === 0 ? (
            <span className="opacity-50 text-sm font-normal"> — 已全部处理</span>
          ) : null}
        </h2>
        {process.env.NODE_ENV !== 'production' && pending.length > 0 ? (
          <div className="mb-3">
            <DevBulkBar uploadId={upload.id} pendingCount={pending.length} />
          </div>
        ) : null}
        {pending.length === 0 ? null : (
          <div className="space-y-2">
            {pending.map((s) => {
              const payload = s.llm_payload as {
                name?: string;
                chapter_no?: string | null;
                brief?: string;
                _subject_id?: string;
              };
              const subjectId = payload._subject_id ?? subjects[0]?.id ?? '';
              return (
                <StagingRow
                  key={s.id}
                  stagingId={s.id}
                  uploadId={upload.id}
                  initialName={payload.name ?? ''}
                  initialChapterNo={payload.chapter_no ?? ''}
                  brief={payload.brief ?? ''}
                  subjectId={subjectId}
                  subjectLabel={(() => {
                    const sub = subjectMap.get(subjectId);
                    return sub ? `${sub.name}（${subjectId}）` : subjectId;
                  })()}
                />
              );
            })}
          </div>
        )}
      </section>

      {processed.length > 0 ? (
        <section>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              已处理（{processed.length}）—— 点击展开
            </summary>
            <div className="mt-3 overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-black/5 dark:bg-white/5 text-left">
                  <tr>
                    <th className="p-2">name</th>
                    <th className="p-2">chapter_no</th>
                    <th className="p-2">状态</th>
                    <th className="p-2">审核者</th>
                    <th className="p-2 font-mono text-xs">published_id</th>
                  </tr>
                </thead>
                <tbody>
                  {processed.map((s) => {
                    const display = (s.review_payload ?? s.llm_payload) as {
                      name?: string;
                      chapter_no?: string | null;
                    };
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="p-2">{display.name ?? '—'}</td>
                        <td className="p-2 text-xs opacity-80">{display.chapter_no ?? '—'}</td>
                        <td className="p-2">
                          <span
                            className={
                              s.review_status === 'accepted' ? 'text-green-600' : 'opacity-60'
                            }
                          >
                            {s.review_status}
                          </span>
                        </td>
                        <td className="p-2 text-xs opacity-80">{s.reviewed_by ?? '—'}</td>
                        <td className="p-2 font-mono text-xs truncate max-w-[16ch]">
                          {s.published_id ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ) : null}
    </main>
  );
}
