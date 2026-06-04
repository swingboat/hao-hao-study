import { type Prisma, prisma } from '@hao/db';
/**
 * F4.1 KP 列表 + F4.2 入口。
 *
 *  - 表格列（PRD F4.1）：name / subject_id / chapter_no / 关联题数 / 关联学生数
 *    · 关联题数 = practice_item 中 kp_id ∈ kp_ids 的题数（kp_ids 是 String[]，需 unnest）
 *    · 关联学生数 = knowledge_point_mastery 中 distinct(student_id)
 *  - 顶部：subject 过滤下拉 + "+ 新建 KP"
 *  - 编辑：行末"编辑"按钮，URL 加 ?edit=<id> 触发模态框
 *  - 模态框开关由 search params 决定：?new=1 / ?edit=<id>
 */
import Link from 'next/link';
import { KpDialog } from './kp-dialog';

export const dynamic = 'force-dynamic';

interface KpRow {
  id: string;
  name: string;
  subject_id: string;
  chapter_no: string | null;
  item_count: number;
  student_count: number;
}

async function loadKps(subjectFilter: string | undefined): Promise<KpRow[]> {
  const where: Prisma.knowledge_pointWhereInput = subjectFilter
    ? { subject_id: subjectFilter }
    : {};
  const kps = await prisma.knowledge_point.findMany({
    where,
    orderBy: [{ subject_id: 'asc' }, { chapter_no: 'asc' }, { name: 'asc' }],
  });
  if (kps.length === 0) return [];

  // 关联题数：unnest practice_item.kp_ids → 按 kp_id 聚合
  // 学生数：knowledge_point_mastery 复合主键 (student_id, kp_id)，
  //         同一 (student, kp) 只会有一条，所以直接 count(*) 即可
  const ids = kps.map((k) => k.id);
  const [itemCounts, studentCounts] = await Promise.all([
    prisma.$queryRaw<Array<{ kp_id: string; cnt: bigint }>>`
      SELECT kp_id, COUNT(*)::bigint AS cnt
      FROM (SELECT unnest(kp_ids) AS kp_id FROM practice_item) sub
      WHERE kp_id = ANY(${ids}::uuid[])
      GROUP BY kp_id
    `,
    prisma.knowledge_point_mastery.groupBy({
      by: ['kp_id'],
      where: { kp_id: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const itemMap = new Map(itemCounts.map((r) => [r.kp_id, Number(r.cnt)]));
  const studentMap = new Map(studentCounts.map((r) => [r.kp_id, r._count._all]));

  return kps.map((k) => ({
    id: k.id,
    name: k.name,
    subject_id: k.subject_id,
    chapter_no: k.chapter_no,
    item_count: itemMap.get(k.id) ?? 0,
    student_count: studentMap.get(k.id) ?? 0,
  }));
}

interface PageProps {
  searchParams: Promise<{ subject?: string; new?: string; edit?: string }>;
}

export default async function KpsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [subjects, kps] = await Promise.all([
    prisma.subject.findMany({ orderBy: { id: 'asc' } }),
    loadKps(sp.subject),
  ]);

  // 模态框模式
  let dialogMode: Parameters<typeof KpDialog>[0]['mode'] | null = null;
  if (sp.new === '1') {
    dialogMode = 'new';
  } else if (sp.edit) {
    const target = await prisma.knowledge_point.findUnique({ where: { id: sp.edit } });
    if (target) {
      dialogMode = {
        id: target.id,
        name: target.name,
        subject_id: target.subject_id,
        chapter_no: target.chapter_no,
      };
    }
  }

  // 过滤下拉的当前值
  const currentSubject = sp.subject ?? '';

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">知识点（KP）</h1>
          <p className="text-sm opacity-60 mt-1">F4.1 列表 · F4.2 新建 / 编辑</p>
        </div>
        <Link
          href="/admin/kps?new=1"
          className="px-3 py-1.5 rounded bg-black text-white text-sm font-medium dark:bg-white dark:text-black"
        >
          + 新建 KP
        </Link>
        <Link
          href="/admin/kps/import"
          className="ml-2 px-3 py-1.5 rounded border text-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          ↑ 上传教材解析（F4.3）
        </Link>
      </header>

      {/* 学科过滤 — 用纯 GET form，无需 client component */}
      <form className="mb-4 flex items-center gap-2 text-sm">
        <label htmlFor="subject-filter" className="opacity-70">
          学科：
        </label>
        <select
          id="subject-filter"
          name="subject"
          defaultValue={currentSubject}
          className="px-2 py-1 border rounded bg-transparent"
        >
          <option value="">全部</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.id}）
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          应用
        </button>
        {currentSubject ? (
          <Link href="/admin/kps" className="text-xs opacity-60 hover:opacity-100">
            清除
          </Link>
        ) : null}
      </form>

      {subjects.length === 0 ? (
        <p className="text-sm text-amber-600 mb-3">
          subject 表为空。请总控先 seed 至少 1 条学科记录（如 math / 高中数学），否则无法创建 KP。
        </p>
      ) : null}

      {kps.length === 0 ? (
        <p className="text-sm opacity-60">
          暂无 KP{currentSubject ? `（学科：${currentSubject}）` : ''}。点击右上角"+ 新建 KP"开始。
        </p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/5 text-left">
              <tr>
                <th className="p-2">name</th>
                <th className="p-2">subject_id</th>
                <th className="p-2">chapter_no</th>
                <th className="p-2 text-right">关联题数</th>
                <th className="p-2 text-right">关联学生数</th>
                <th className="p-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {kps.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="p-2">{k.name}</td>
                  <td className="p-2 font-mono text-xs">{k.subject_id}</td>
                  <td className="p-2 text-xs opacity-80">{k.chapter_no ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{k.item_count}</td>
                  <td className="p-2 text-right tabular-nums">{k.student_count}</td>
                  <td className="p-2 text-right">
                    <Link
                      href={`/admin/kps?edit=${k.id}`}
                      className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      编辑
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogMode ? <KpDialog mode={dialogMode} subjects={subjects} /> : null}
    </main>
  );
}
