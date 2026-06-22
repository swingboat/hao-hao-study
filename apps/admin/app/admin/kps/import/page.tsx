/**
 * F4.3 上传 + 解析入口页 — /admin/kps/import
 *
 *   - 表单：subject 下拉 / Provider 下拉 / 文件输入（仅 PDF，≤500MB）
 *   - 提交 → uploadAndParseAction 上传并创建后台 analyzeKnowledgePoints 解析任务
 *   - 成功跳到 /admin/kps/import/<uploadId> 看 staging
 *   - 历史上传列表：最近 10 条 content_upload(purpose=knowledge_point)
 */
import { prisma } from '@hao/db';
import Link from 'next/link';
import {
  documentAnalysisProtocolLabel,
  isDocumentAnalysisProvider,
  listLlmProviders,
  resolveLlmProviderId,
} from '../../../../lib/llm-providers';
import { sortSubjectsByStage } from '../../../../lib/subjects';
import { deleteUploadHistoryAction } from './actions';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

const TASK_KIND_DEFAULT_ENV = 'DEFAULT_PROVIDER_KNOWLEDGE_POINT';

export default async function KpImportPage() {
  const [subjects, providers, recent] = await Promise.all([
    prisma.subject.findMany().then(sortSubjectsByStage),
    // 只列启用的 provider；下面再收敛到 analyzeKnowledgePoints 可用的协议与能力。
    listLlmProviders({ enabledOnly: true }),
    prisma.content_upload.findMany({
      where: { purpose: 'knowledge_point' },
      orderBy: { created_at: 'desc' },
      take: 10,
      include: {
        llm_parse_jobs: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, error_message: true, finished_at: true },
        },
        _count: { select: { llm_parse_stagings: true } },
      },
    }),
  ]);

  const visionProviders = providers.filter(isDocumentAnalysisProvider);

  // env 值必须在 visionProviders 名单内；否则 select.defaultValue 不匹配任何 option →
  // React 把 selectedIndex 置 -1 → required 校验静默失败 → 用户点提交无反应。
  // 默认用 visionProviders[0].id，永远确保 defaultProvider 在 options 里。
  const envDefault = resolveLlmProviderId(process.env[TASK_KIND_DEFAULT_ENV] ?? '', providers);
  const defaultProvider =
    envDefault && visionProviders.some((p) => p.id === envDefault)
      ? envDefault
      : (visionProviders[0]?.id ?? '');

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">教材 PDF 上传 → 解析 KP（F4.3）</h1>
          <p className="text-sm opacity-60 mt-1">
            上传后自动调 LLM 抽取 KP 候选，落 staging 等 admin 人员逐条审核。
          </p>
        </div>
        <Link href="/admin/kps" className="text-sm underline opacity-70 hover:opacity-100">
          ← 返回 KP 列表
        </Link>
      </header>

      {subjects.length === 0 || visionProviders.length === 0 ? (
        <section className="border border-amber-500 rounded-lg p-4 text-sm">
          {subjects.length === 0 ? (
            <p className="text-amber-700">subject 表为空，请总控先 seed 至少 1 条学科记录。</p>
          ) : null}
          {visionProviders.length === 0 ? (
            <p className="text-amber-700">
              没有启用的{documentAnalysisProtocolLabel()} LLM Provider；请去 /admin/settings/llm
              检查。
            </p>
          ) : null}
        </section>
      ) : (
        <ImportForm
          subjects={subjects.map((s) => ({ id: s.id, name: s.name, stage: s.stage }))}
          providers={visionProviders.map((p) => ({ id: p.id, model: p.model }))}
          defaultProvider={defaultProvider}
        />
      )}

      <section>
        <h2 className="font-medium mb-3">最近上传</h2>
        {recent.length === 0 ? (
          <p className="text-sm opacity-60">暂无记录。</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/5 text-left">
                <tr>
                  <th className="p-2">时间</th>
                  <th className="p-2">文件</th>
                  <th className="p-2 text-right">大小</th>
                  <th className="p-2">状态</th>
                  <th className="p-2 text-right">staging 数</th>
                  <th className="p-2 text-right w-32">操作</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((u) => {
                  const lastJob = u.llm_parse_jobs[0];
                  const statusLabel = lastJob
                    ? { queued: '排队', running: '运行中', succeeded: '成功', failed: '失败' }[
                        lastJob.status
                      ]
                    : '未触发';
                  return (
                    <tr key={u.id} className="border-t">
                      <td className="p-2 text-xs whitespace-nowrap">
                        {u.created_at.toLocaleString('zh-CN')}
                      </td>
                      <td className="p-2 max-w-xs truncate" title={u.original_name ?? u.file_uri}>
                        {u.original_name ?? '(未命名)'}
                      </td>
                      <td className="p-2 text-right tabular-nums text-xs">
                        {u.size_bytes != null
                          ? `${(u.size_bytes / 1024 / 1024).toFixed(2)} MB`
                          : '—'}
                      </td>
                      <td className="p-2">
                        <span
                          className={
                            lastJob?.status === 'failed'
                              ? 'text-red-600'
                              : lastJob?.status === 'succeeded'
                                ? 'text-green-600'
                                : 'opacity-70'
                          }
                        >
                          {statusLabel}
                        </span>
                        {lastJob?.error_message ? (
                          <span
                            className="block text-xs text-red-600 truncate max-w-xs"
                            title={lastJob.error_message}
                          >
                            {lastJob.error_message}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-right tabular-nums">{u._count.llm_parse_stagings}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/kps/import/${u.id}`}
                            className="inline-flex h-7 items-center rounded border px-2 text-xs leading-none whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            查看
                          </Link>
                          <form action={deleteUploadHistoryAction}>
                            <input type="hidden" name="upload_id" value={u.id} />
                            <button
                              type="submit"
                              className="inline-flex h-7 items-center rounded border border-red-300 px-2 text-xs leading-none text-red-600 whitespace-nowrap hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              删除
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
