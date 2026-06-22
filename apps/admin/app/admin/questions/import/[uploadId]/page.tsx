/**
 * F3.3 staging 审核页 — /admin/questions/import/[uploadId]
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
import {
  displayLlmProviderId,
  isDocumentAnalysisProvider,
  listLlmProviders,
  resolveLlmProviderId,
} from '../../../../../lib/llm-providers';
import { sortSubjectsByStage } from '../../../../../lib/subjects';
import {
  resolvePdfPreviewPages,
  resolveUploadFilePreview,
} from '../../../../../lib/upload-file-preview';
import { reparseUploadAction } from '../actions';
import { BulkAcceptButton } from './bulk-accept-button';
import type { LlmQuestionPayload } from './diff-drawer';
import { JobProgressPoller } from './job-progress-poller';
import { MathText } from './math-text';
import { OriginalFilePreviewPanel } from './original-file-preview-panel';
import { StagingRow } from './staging-row';
import { SupportingBulkAcceptButton } from './supporting-bulk-accept-button';
import { SupportingStagingCard } from './supporting-staging-card';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ uploadId: string }>;
}

export default async function QuestionStagingReviewPage({ params }: PageProps) {
  const { uploadId } = await params;

  const upload = await prisma.content_upload.findUnique({
    where: { id: uploadId },
    include: {
      llm_parse_jobs: { orderBy: { created_at: 'desc' }, take: 1 },
      llm_parse_stagings: {
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!upload) {
    return (
      <main className="p-8 max-w-4xl mx-auto">
        <p className="text-red-600">upload {uploadId} 不存在。</p>
        <Link href="/admin/questions/import" className="underline text-sm">
          ← 返回上传页
        </Link>
      </main>
    );
  }

  const [subjects, providers, allProviders] = await Promise.all([
    prisma.subject.findMany().then(sortSubjectsByStage),
    listLlmProviders({ enabledOnly: true }),
    listLlmProviders(),
  ]);
  const visionProviders = providers.filter(isDocumentAnalysisProvider);
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const lastJob = upload.llm_parse_jobs[0];
  const lastJobProviderId = lastJob
    ? resolveLlmProviderId(lastJob.provider_id, allProviders)
    : null;
  const lastJobProvider = lastJob
    ? allProviders.find(
        (provider) => provider.id === lastJob.provider_id || provider.db_id === lastJob.provider_id,
      )
    : null;
  const lastJobProviderTechnicalLabel = lastJob
    ? displayLlmProviderId(lastJob.provider_id, allProviders)
    : null;
  const lastJobProviderLabel = lastJobProvider?.model ?? lastJobProviderTechnicalLabel;
  const sourceDocuments = upload.llm_parse_stagings.filter(
    (s) => s.entity_kind === 'source_document',
  );
  const learningMaterials = upload.llm_parse_stagings.filter(
    (s) => s.entity_kind === 'learning_material',
  );
  const questionStagings = upload.llm_parse_stagings.filter((s) => s.entity_kind === 'question');
  const pending = questionStagings.filter((s) => s.review_status === 'pending');
  const processed = questionStagings.filter((s) => s.review_status !== 'pending');
  const uploadPreview = resolveUploadFilePreview({
    originalName: upload.original_name,
    fileType: upload.file_type,
  });
  const sourceDocumentPageCount =
    sourceDocuments
      .map((s) => {
        const payload = asRecord(s.llm_payload);
        return intValue(payload?.page_count ?? payload?.pageCount);
      })
      .find(isPageNumber) ?? null;
  const questionSourcePages = questionStagings.map(
    (s) => (s.llm_payload as LlmQuestionPayload).source_hint?.page,
  );
  const previewPageNumbers =
    uploadPreview.kind === 'pdf'
      ? resolvePdfPreviewPages({
          pageCount: sourceDocumentPageCount,
          sourcePages: questionSourcePages,
        })
      : [];
  const firstPendingPage =
    pending
      .map((s) => (s.llm_payload as LlmQuestionPayload).source_hint?.page)
      .find(isPageNumber) ?? null;
  const pendingSupporting = [...sourceDocuments, ...learningMaterials].filter(
    (s) => s.review_status === 'pending',
  );
  const supportingFallbackSubjectId =
    pendingSupporting.map((s) => stringValue(asRecord(s.llm_payload)?._subject_id)).find(Boolean) ||
    subjects[0]?.id ||
    '';
  const acceptedSources = sourceDocuments.filter((s) => s.review_status === 'accepted').length;
  const acceptedMaterials = learningMaterials.filter((s) => s.review_status === 'accepted').length;

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">学习资料解析审核</h1>
          <p className="text-sm opacity-60 mt-1">
            上传：{upload.original_name ?? '(未命名)'} · {upload.created_at.toLocaleString('zh-CN')}
          </p>
        </div>
        <Link
          href="/admin/questions/import"
          className="text-sm underline opacity-70 hover:opacity-100"
        >
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
            <input type="hidden" name="provider_id" value={lastJobProviderId ?? ''} />
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
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              重新解析（{lastJobProviderLabel}）
            </button>
          </form>
        </section>
      ) : null}

      {lastJob ? (
        <section className="border rounded-lg p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span>
              <span className="opacity-60">解析状态</span>{' '}
              <span
                className={
                  lastJob.status === 'failed'
                    ? 'text-red-600'
                    : lastJob.status === 'succeeded'
                      ? 'text-green-600'
                      : ''
                }
              >
                {jobStatusLabel(lastJob.status)}
              </span>
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
          </div>
          <details className="text-xs opacity-70">
            <summary className="cursor-pointer">技术详情</summary>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
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
                <code className="text-xs">{lastJobProviderTechnicalLabel}</code>
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
            </div>
          </details>
        </section>
      ) : null}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <MetricCard label="待审核来源" value={sourceDocuments.length - acceptedSources} />
        <MetricCard
          label="已提取学习材料"
          value={learningMaterials.length}
          detail={`已发布 ${acceptedMaterials}`}
        />
        <MetricCard
          label="已提取题目"
          value={questionStagings.length}
          detail={`待审核 ${pending.length}`}
        />
      </section>

      {pendingSupporting.length > 0 ? (
        <section>
          <h2 className="font-medium mb-3 flex items-center justify-between gap-3 flex-wrap">
            <span>待审核来源与学习材料（{pendingSupporting.length}）</span>
            <SupportingBulkAcceptButton
              uploadId={upload.id}
              subjectId={supportingFallbackSubjectId}
              pendingCount={pendingSupporting.length}
            />
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pendingSupporting.map((s) => {
              const payload = asRecord(s.llm_payload) ?? {};
              const subjectId = stringValue(payload._subject_id) || subjects[0]?.id || '';
              return (
                <SupportingStagingCard
                  key={s.id}
                  stagingId={s.id}
                  uploadId={upload.id}
                  subjectId={subjectId}
                  entityKind={s.entity_kind as 'source_document' | 'learning_material'}
                  payload={payload}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-medium mb-3 flex items-center justify-between gap-3 flex-wrap">
          <span>
            待审核题目（{pending.length}）
            {pending.length === 0 ? (
              <span className="opacity-50 text-sm font-normal"> — 已全部处理</span>
            ) : null}
          </span>
          {pending.length > 0 ? (
            <BulkAcceptButton uploadId={upload.id} pendingCount={pending.length} />
          ) : null}
        </h2>
        {pending.length === 0 ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,42%)] gap-4 items-start">
            <div className="min-w-0 space-y-2">
              {pending.map((s) => {
                const payload = s.llm_payload as LlmQuestionPayload;
                const subjectId = payload._subject_id ?? subjects[0]?.id ?? '';
                const sub = subjectMap.get(subjectId);
                return (
                  <StagingRow
                    key={s.id}
                    stagingId={s.id}
                    uploadId={upload.id}
                    payload={payload}
                    subjectId={subjectId}
                    subjectLabel={sub ? sub.name : '未识别学科'}
                    providers={visionProviders.map((p) => ({ id: p.id, model: p.model }))}
                    draftProviders={providers.map((p) => ({ id: p.id, model: p.model }))}
                  />
                );
              })}
            </div>
            <OriginalFilePreviewPanel
              uploadId={upload.id}
              originalName={upload.original_name}
              preview={uploadPreview}
              initialPage={firstPendingPage}
              pageNumbers={previewPageNumbers}
            />
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
                  </tr>
                </thead>
                <tbody>
                  {processed.map((s) => {
                    const display = (s.review_payload ?? s.llm_payload) as LlmQuestionPayload;
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
                            {reviewStatusLabel(s.review_status)}
                          </span>
                        </td>
                        <td className="p-2 text-xs opacity-80">{s.reviewed_by ?? '—'}</td>
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

function MetricCard({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs opacity-60">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs opacity-60 mt-1">{detail}</p> : null}
    </div>
  );
}

function jobStatusLabel(status: string): string {
  return (
    {
      queued: '排队中',
      running: '学习资料解析中',
      succeeded: '解析完成',
      failed: '解析失败',
    }[status] ?? status
  );
}

function reviewStatusLabel(status: string): string {
  return (
    {
      pending: '待审核',
      accepted: '已发布',
      rejected: '已丢弃',
      edited: '已编辑',
    }[status] ?? status
  );
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function intValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPageNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
