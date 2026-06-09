/**
 * F3 试题列表 — /admin/items
 * 按 KP 分组聚合 practice_item；每组列出题数 + 最近 N 条题摘要。
 * 顶部入口：上传题集 PDF（→ /admin/items/import）。
 *
 * v0.1 KP 没挂 textbook FK，列表纯按 primary_kp_id 聚合；学科过滤通过 KP→subject 反查。
 */
import { prisma } from '@hao/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ subject?: string }>;
}

export default async function ItemsListPage({ searchParams }: PageProps) {
  const { subject: subjectFilter } = await searchParams;

  const [subjects, items] = await Promise.all([
    prisma.subject.findMany({ orderBy: { id: 'asc' } }),
    prisma.practice_item.findMany({
      orderBy: [{ primary_kp_id: 'asc' }, { created_at: 'desc' }],
      take: 500,
      select: {
        id: true,
        content: true,
        item_type: true,
        difficulty: true,
        answer: true,
        primary_kp_id: true,
        created_at: true,
      },
    }),
  ]);

  const kpIds = Array.from(new Set(items.map((i) => i.primary_kp_id)));
  const kps =
    kpIds.length > 0
      ? await prisma.knowledge_point.findMany({
          where: {
            id: { in: kpIds },
            ...(subjectFilter ? { subject_id: subjectFilter } : {}),
          },
          select: { id: true, name: true, subject_id: true, chapter_no: true },
        })
      : [];
  const kpMap = new Map(kps.map((k) => [k.id, k]));

  // 按学科过滤后只保留命中 KP 的题
  const filtered = subjectFilter ? items.filter((i) => kpMap.has(i.primary_kp_id)) : items;

  // 分组：按 KP（缺失映射时归 unknown）
  const groups = new Map<
    string,
    {
      kp: { id: string; name: string; subject_id: string; chapter_no: string | null } | null;
      items: typeof filtered;
    }
  >();
  for (const it of filtered) {
    const kp = kpMap.get(it.primary_kp_id) ?? null;
    const key = kp?.id ?? `__missing__${it.primary_kp_id}`;
    const g = groups.get(key);
    if (g) g.items.push(it);
    else groups.set(key, { kp, items: [it] });
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const ka = `${a.kp?.subject_id ?? 'zzz'}|${a.kp?.chapter_no ?? 'zzz'}|${a.kp?.name ?? 'zzz'}`;
    const kb = `${b.kp?.subject_id ?? 'zzz'}|${b.kp?.chapter_no ?? 'zzz'}|${b.kp?.name ?? 'zzz'}`;
    return ka.localeCompare(kb);
  });

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">试题库（按 KP 分组）</h1>
          <p className="text-sm opacity-60 mt-1">
            按 primary_kp_id 聚合；上限 500 条，更多请按 KP 钻取。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form method="get" className="text-sm flex items-center gap-2">
            <select
              name="subject"
              defaultValue={subjectFilter ?? ''}
              className="px-2 py-1.5 border rounded text-sm bg-transparent"
            >
              <option value="">全部学科</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-2 py-1.5 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
            >
              筛选
            </button>
          </form>
          <Link
            href="/admin/items/import"
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            + 上传题集 PDF
          </Link>
        </div>
      </header>

      {sortedGroups.length === 0 ? (
        <section className="border rounded-lg p-8 text-center text-sm opacity-70">
          {filtered.length === 0
            ? '题库为空。点右上 "+ 上传题集 PDF" 开始 F3 流程。'
            : '当前过滤无结果。'}
        </section>
      ) : (
        <div className="space-y-4">
          {sortedGroups.map((g) => (
            <section key={g.kp?.id ?? Math.random()} className="border rounded-lg">
              <header className="px-4 py-2 border-b bg-black/3 dark:bg-white/5 flex items-baseline justify-between">
                <h2 className="font-medium text-sm">
                  {g.kp ? (
                    <>
                      {g.kp.chapter_no ? (
                        <span className="opacity-60 mr-2">{g.kp.chapter_no}</span>
                      ) : null}
                      {g.kp.name}
                      <span className="opacity-60 ml-2 text-xs">学科 {g.kp.subject_id}</span>
                    </>
                  ) : (
                    <span className="text-amber-700">⚠️ KP 缺失 / 异学科</span>
                  )}
                </h2>
                <span className="text-xs opacity-60">{g.items.length} 题</span>
              </header>
              <ul className="divide-y">
                {g.items.slice(0, 10).map((it) => (
                  <li key={it.id} className="px-4 py-2 text-xs">
                    <div className="flex items-baseline gap-2 mb-1 opacity-60">
                      <span className="font-mono">{it.id.slice(0, 8)}</span>
                      <span>{it.item_type}</span>
                      <span>难度 {it.difficulty}</span>
                      <span className="ml-auto">{it.created_at.toLocaleDateString('zh-CN')}</span>
                    </div>
                    <p className="line-clamp-2">{it.content}</p>
                    <p className="opacity-60 mt-0.5">
                      答案 <code className="font-mono">{it.answer}</code>
                    </p>
                  </li>
                ))}
                {g.items.length > 10 ? (
                  <li className="px-4 py-2 text-xs opacity-60">
                    （还有 {g.items.length - 10} 题未显示）
                  </li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
