/**
 * F3.3 staging 审核页 — /admin/items/import/[uploadId]
 * 对照 /admin/kps/import/[uploadId]/page.tsx。
 *
 *   - 顶部：上传元信息 + 最近一次 job 状态
 *   - 主体：pending staging 列表（一行一题，点开抽屉做 F3.4–F3.6）
 *   - 已处理（accepted / rejected）折叠展示
 *
 * subject_id 从 staging.llm_payload._subject_id 透传。
 */
import { prisma } from '@hao/db';
import Link from 'next/link';
import { reparseUploadAction } from '../actions';
import { BulkAcceptButton } from './bulk-accept-button';
import type { LlmItemPayload } from './diff-drawer';
import { JobProgressPoller } from './job-progress-poller';
import { MathText } from './math-text';
import { StagingRow } from './staging-row';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ uploadId: string }>;
}

export default async function ItemStagingReviewPage({ params }: PageProps) {
  const { uploadId } = await params;

  const upload = await prisma.content_upload.findUnique({
    where: { id: uploadId },
    include: {
      llm_parse_jobs: { orderBy: { created_at: 'desc' }, take: 1 },
      llm_parse_stagings: {
        where: { entity_kind: 'practice_item' },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!upload) {
    return (
      <main className="p-8 max-w-4xl mx-auto">
        <p className="text-red-600">upload {uploadId} 不存在。</p>
        <Link href="/admin/items/import" className="underline text-sm">
          ← 返回上传页
        </Link>
      </main>
    );
  }

  const [subjects, providers] = await Promise.all([
    prisma.subject.findMany(),
    prisma.llm_provider.findMany({
      where: { enabled: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  const visionProviders = providers.filter((p) => {
    const caps = p.capabilities as { vision?: boolean } | null;
    return caps?.vision === true;
  });
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const lastJob = upload.llm_parse_jobs[0];
  const pending = upload.llm_parse_stagings.filter((s) => s.review_status === 'pending');
  const processed = upload.llm_parse_stagings.filter((s) => s.review_status !== 'pending');

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">题目解析审核</h1>
          <p className="text-sm opacity-60 mt-1">
            上传：{upload.original_name ?? '(未命名)'} · {upload.created_at.toLocaleString('zh-CN')}
          </p>
        </div>
        <Link href="/admin/items/import" className="text-sm underline opacity-70 hover:opacity-100">
          ← 返回上传列表
        </Link>
      </header>

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
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
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
        <h2 className="font-medium mb-3 flex items-center justify-between gap-3 flex-wrap">
          <span>
            待审核（{pending.length}）
            {pending.length === 0 ? (
              <span className="opacity-50 text-sm font-normal"> — 已全部处理</span>
            ) : null}
          </span>
          {pending.length > 0 ? (
            <BulkAcceptButton uploadId={upload.id} pendingCount={pending.length} />
          ) : null}
        </h2>
        {pending.length === 0 ? null : (
          <div className="space-y-2">
            {pending.map((s) => {
              const payload = s.llm_payload as LlmItemPayload;
              const subjectId = payload._subject_id ?? subjects[0]?.id ?? '';
              const sub = subjectMap.get(subjectId);
              return (
                <StagingRow
                  key={s.id}
                  stagingId={s.id}
                  uploadId={upload.id}
                  payload={payload}
                  subjectId={subjectId}
                  subjectLabel={sub ? `${sub.name}（${subjectId}）` : subjectId}
                  providers={visionProviders.map((p) => ({ id: p.id, model: p.model }))}
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
                    <th className="p-2">摘要</th>
                    <th className="p-2">状态</th>
                    <th className="p-2">审核者</th>
                    <th className="p-2 font-mono text-xs">published_id</th>
                  </tr>
                </thead>
                <tbody>
                  {processed.map((s) => {
                    const display = (s.review_payload ?? s.llm_payload) as LlmItemPayload;
                    // 截 200 char 而非 60：MathText 渲染后视觉密度变高，留更多空间还能塞下；
                    // 表格 max-w 仍由 td 控制不会撑爆。
                    const summary = (display.content ?? '').replace(/\s+/g, ' ').slice(0, 200);
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="p-2 align-top max-w-[60ch]">
                          <MathText text={summary} className="text-sm leading-snug" />
                        </td>
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
