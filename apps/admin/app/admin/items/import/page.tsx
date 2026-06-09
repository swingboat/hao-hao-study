/**
 * F3.1 题集 PDF 上传 + 解析入口页 — /admin/items/import
 * 同构对照 /admin/kps/import/page.tsx：表单 + 最近上传列表。
 */
import { prisma } from '@hao/db';
import Link from 'next/link';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

const TASK_KIND_DEFAULT_ENV = 'DEFAULT_PROVIDER_PRACTICE_ITEM';

export default async function ItemsImportPage() {
  const [subjects, providers, recent] = await Promise.all([
    prisma.subject.findMany({ orderBy: { id: 'asc' } }),
    prisma.llm_provider.findMany({
      where: { enabled: true },
      orderBy: { id: 'asc' },
    }),
    prisma.content_upload.findMany({
      where: { purpose: 'practice_item' },
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

  // L2 流水线全程走 vision（rasterize + analyzeImageBatch）；只列 vision provider。
  const visionProviders = providers.filter((p) => {
    const caps = p.capabilities as { vision?: boolean } | null;
    return caps?.vision === true;
  });

  const envDefault = process.env[TASK_KIND_DEFAULT_ENV];
  const defaultProvider =
    envDefault && visionProviders.some((p) => p.id === envDefault)
      ? envDefault
      : (visionProviders[0]?.id ?? '');

  return (
    <main className="p-8 max-w-4xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">题集 PDF 上传 → 解析试题（F3.1–F3.2）</h1>
          <p className="text-sm opacity-60 mt-1">
            上传后自动调 LLM 抽题（含跨页修复 + figure crop），落 staging 等运营审核。
          </p>
        </div>
        <Link href="/admin/items" className="text-sm underline opacity-70 hover:opacity-100">
          ← 返回试题列表
        </Link>
      </header>

      {subjects.length === 0 || visionProviders.length === 0 ? (
        <section className="border border-amber-500 rounded-lg p-4 text-sm">
          {subjects.length === 0 ? (
            <p className="text-amber-700">subject 表为空，请总控先 seed 至少 1 条学科。</p>
          ) : null}
          {visionProviders.length === 0 ? (
            <p className="text-amber-700">
              没有 capabilities.vision=true 且启用的 LLM Provider；请去 /admin/settings/llm 检查。
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
                  <th className="p-2 text-right">操作</th>
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
                      <td className="p-2 text-right">
                        <Link
                          href={`/admin/items/import/${u.id}`}
                          className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          查看
                        </Link>
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
