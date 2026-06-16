import { type Prisma, prisma } from '@hao/db';
/**
 * F4.1 KP 列表 + F4.2 入口。
 *
 *  - 主导航：教材（content_upload where file_type='textbook'）—— 选择教材后才展示该教材
 *    的 KP（通过 llm_parse_staging.published_id 反查）。
 *    rationale：v0.1 的 knowledge_point 没有 textbook FK，KP 只挂 subject_id；但运营审核
 *    时希望"按本教材审核 / 浏览"，所以走 staging 反向 join 拿 KP 集合。
 *  - 视图默认 **章节树**（list 仍可切，URL ?view=list）。
 *  - 学科过滤保留为次级过滤（textbook 已隐含一个 subject，但加学科可看历史 KP 子集）。
 *  - 编辑：行末"编辑"按钮，URL 加 ?edit=<id> 触发模态框
 *  - 模态框开关由 search params 决定：?new=1 / ?edit=<id>
 */
import Link from 'next/link';
import { resolveTextbookFilter } from '../../../lib/kp-filters';
import { sortSubjectsByStage } from '../../../lib/subjects';
import { KpDialog } from './kp-dialog';
import { KpTreeView } from './kp-tree-view';

export const dynamic = 'force-dynamic';

interface KpRow {
  id: string;
  name: string;
  subject_id: string;
  chapter_no: string | null;
  question_count: number;
  student_count: number;
}

/**
 * 拿教材的 chapter_no → chapter_title 映射（vision-v3+ 才有，老 staging 缺失就空 Map）。
 * 同一 chapter_no 可能在不同 upload / 不同 staging 行里被 LLM 标成略有差异的 title——
 * 取出现次数最多的；并列时取首次见到的（按 created_at 排序）。
 */
async function loadChapterTitles(textbookUploadIds: string[]): Promise<Map<string, string>> {
  if (textbookUploadIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ chapter_no: string; chapter_title: string }>>`
    SELECT s.llm_payload->>'chapter_no'    AS chapter_no,
           s.llm_payload->>'chapter_title' AS chapter_title
    FROM llm_parse_staging s
    WHERE s.upload_id = ANY(${textbookUploadIds}::uuid[])
      AND s.entity_kind = 'knowledge_point'
      AND s.llm_payload->>'chapter_no'    IS NOT NULL
      AND s.llm_payload->>'chapter_title' IS NOT NULL
    ORDER BY s.created_at ASC
  `;
  // 同 chapter_no 多 title → 数频次取最大；并列保留首次见到的
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const chap = r.chapter_no.trim();
    const title = r.chapter_title.trim();
    if (!chap || !title) continue;
    let m = counts.get(chap);
    if (!m) {
      m = new Map();
      counts.set(chap, m);
    }
    m.set(title, (m.get(title) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [chap, m] of counts) {
    let bestTitle: string | undefined;
    let bestCount = -1;
    for (const [t, n] of m) {
      if (n > bestCount) {
        bestCount = n;
        bestTitle = t;
      }
    }
    if (bestTitle) out.set(chap, bestTitle);
  }
  return out;
}

/**
 * 根据 (textbook upload_id 集合, subject?) 加载 KP。
 *   - textbookUploadIds 非空时：从 staging 反查这些 upload 已 publish 的 KP id 集合，再过滤
 *   - 空数组 → 返回空（页面显示"请选择教材"空状态，避免一次性 load 全库 KP）
 * 接受 ID 集合（不是单个 ID）是因为同一份 PDF 可能被多次上传，每次都拿到不同的 upload_id；
 * 我们要把这些 upload_id 合并视为同一本"教材"，KP 集合是它们的并集。
 */
async function loadKps(
  subjectFilter: string | undefined,
  textbookUploadIds: string[],
): Promise<KpRow[]> {
  if (textbookUploadIds.length === 0) return []; // 反查这些教材上传通过 staging publish 出的 KP id（并集）
  // accepted 后 staging.published_id 必然写入；筛 published_id NOT NULL 即可。
  const stagings = await prisma.llm_parse_staging.findMany({
    where: {
      upload_id: { in: textbookUploadIds },
      entity_kind: 'knowledge_point',
      published_id: { not: null },
    },
    select: { published_id: true },
  });
  const kpIds = Array.from(
    new Set(stagings.map((s) => s.published_id).filter((x): x is string => x !== null)),
  );
  if (kpIds.length === 0) return [];

  const where: Prisma.knowledge_pointWhereInput = {
    id: { in: kpIds },
    ...(subjectFilter ? { subject_id: subjectFilter } : {}),
  };
  const kps = await prisma.knowledge_point.findMany({
    where,
    orderBy: [{ subject_id: 'asc' }, { chapter_no: 'asc' }, { name: 'asc' }],
  });
  if (kps.length === 0) return [];

  // 关联题数：unnest question.kp_ids → 按 kp_id 聚合
  // 学生数：knowledge_point_mastery 复合主键 (student_id, kp_id)，
  //         同一 (student, kp) 只会有一条，所以直接 count(*) 即可
  const ids = kps.map((k) => k.id);
  const [questionCounts, studentCounts] = await Promise.all([
    prisma.$queryRaw<Array<{ kp_id: string; cnt: bigint }>>`
      SELECT kp_id, COUNT(*)::bigint AS cnt
      FROM (SELECT unnest(kp_ids) AS kp_id FROM question) sub
      WHERE kp_id = ANY(${ids}::uuid[])
      GROUP BY kp_id
    `,
    prisma.knowledge_point_mastery.groupBy({
      by: ['kp_id'],
      where: { kp_id: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const questionMap = new Map(questionCounts.map((r) => [r.kp_id, Number(r.cnt)]));
  const studentMap = new Map(studentCounts.map((r) => [r.kp_id, r._count._all]));

  return kps.map((k) => ({
    id: k.id,
    name: k.name,
    subject_id: k.subject_id,
    chapter_no: k.chapter_no,
    question_count: questionMap.get(k.id) ?? 0,
    student_count: studentMap.get(k.id) ?? 0,
  }));
}

interface PageProps {
  searchParams: Promise<{
    subject?: string;
    new?: string;
    edit?: string;
    view?: string;
    textbook?: string;
  }>;
}

export default async function KpsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  // Step 1：拿教材原始行 + subjects（KP 等去重完算出真正的 upload_id 集合再 load）
  const [subjects, textbookRows] = await Promise.all([
    prisma.subject.findMany().then(sortSubjectsByStage),
    // 教材原始行附带 subject_id（从 staging.llm_payload._subject_id 拿；该字段在
    // actions.ts:530 写入，每条 KP staging 都有；无 staging 的"裸上传"为 null）。
    // 一本教材只挂一个 subject（上传时强制选了），所以 LIMIT 1。
    prisma.$queryRaw<
      Array<{
        id: string;
        original_name: string | null;
        created_at: Date;
        subject_id: string | null;
      }>
    >`
      SELECT cu.id::text AS id,
             cu.original_name,
             cu.created_at,
             (
               SELECT s.llm_payload->>'_subject_id'
               FROM llm_parse_staging s
               WHERE s.upload_id = cu.id AND s.entity_kind = 'knowledge_point'
               LIMIT 1
             ) AS subject_id
      FROM content_upload cu
      WHERE cu.file_type = 'textbook'
      ORDER BY cu.created_at DESC
    `,
  ]);

  // Step 2：按 original_name 去重（同一份 PDF 被多次上传 → 同名多 upload_id）。
  // sha256 当前未上线（actions.ts 没算指纹），name 是唯一可用 dedup 信号。
  //   - 只按 name 分组，**不**带 subject —— 否则同名 PDF 因有的有 staging（subject 已知）
  //     有的没有（孤儿 / 裸上传，subject=null）会被分成两组，UI 上还是会重复
  //   - subject 取组内首个非空：任一上传跑成功了就拿到 subject；全失败才 null
  //   - canonical 取该组最新 created_at 的 upload_id（textbookRows 已 desc 排，map 首次写即最新）
  //   - 等 sha256 上线后把 key 换成 `sha256 ?? name` 更稳
  interface TextbookGroup {
    /** 组内最新上传的 upload_id；下拉 option value */
    canonicalId: string;
    originalName: string | null;
    /** 组内最新上传的 created_at */
    createdAt: Date;
    /** 组内首个非 null 的 subject_id；全空则 null（提示该书还未成功解析过） */
    subjectId: string | null;
    /** 组内所有 upload_id（用于 loadKps 并集查 staging） */
    uploadIds: string[];
  }
  const groupMap = new Map<string, TextbookGroup>();
  for (const row of textbookRows) {
    const key = row.original_name ?? `__nameless__:${row.id}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.uploadIds.push(row.id);
      if (!existing.subjectId && row.subject_id) existing.subjectId = row.subject_id;
    } else {
      groupMap.set(key, {
        canonicalId: row.id,
        originalName: row.original_name,
        createdAt: row.created_at,
        subjectId: row.subject_id,
        uploadIds: [row.id],
      });
    }
  }
  const textbookGroups = Array.from(groupMap.values());

  // Step 3：学科 → 教材联动。未选具体学科时不列教材，残留的 ?textbook= 也不生效。
  const currentSubject0 = sp.subject ?? '';
  const requestedTextbook = sp.textbook ?? '';
  const { textbooks, currentGroup } = resolveTextbookFilter(
    currentSubject0,
    requestedTextbook,
    textbookGroups,
  );
  const currentTextbook = currentGroup?.canonicalId ?? '';
  const uploadIdsForKp = currentGroup?.uploadIds ?? [];
  const [kps, chapterTitles] = await Promise.all([
    loadKps(sp.subject, uploadIdsForKp),
    loadChapterTitles(uploadIdsForKp),
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
  const currentSubject = currentSubject0;
  // currentTextbook 已在上面 step 3 解析；此处不再重复。
  // 默认视图改为 tree —— 用户日常浏览以章节为脉络；列表是次级。
  const view: 'list' | 'tree' = sp.view === 'list' ? 'list' : 'tree';

  // 视图切换链接保留 textbook + subject filter；其它一次性参数（new/edit）丢掉，
  // 否则切视图会顺带把模态框带过去。tree 是默认所以不写 ?view=tree。
  const buildViewLink = (target: 'list' | 'tree') => {
    const qp = new URLSearchParams();
    if (currentTextbook) qp.set('textbook', currentTextbook);
    if (currentSubject) qp.set('subject', currentSubject);
    if (target === 'list') qp.set('view', 'list');
    const qs = qp.toString();
    return qs ? `/admin/kps?${qs}` : '/admin/kps';
  };

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

      {/* 教材 + 学科过滤 — 用纯 GET form，无需 client component */}
      <form
        key={`${currentSubject || 'all'}:${currentGroup?.canonicalId ?? 'none'}:${view}`}
        action="/admin/kps"
        autoComplete="off"
        className="mb-4 flex flex-wrap items-center gap-2 text-sm"
      >
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

        <label htmlFor="textbook-filter" className="ml-2 opacity-70">
          教材：
        </label>
        <select
          id="textbook-filter"
          name="textbook"
          defaultValue={currentGroup?.canonicalId ?? ''}
          disabled={!currentSubject}
          className={`px-2 py-1 border rounded bg-transparent min-w-64 ${
            currentSubject ? '' : 'opacity-60 cursor-not-allowed'
          }`}
        >
          <option value="">{currentSubject ? '— 请选择教材 —' : '— 请先选择学科 —'}</option>
          {textbooks.map((g) => {
            const subjName = subjects.find((s) => s.id === g.subjectId)?.name;
            const display = g.originalName ?? `<未命名>·${g.canonicalId.slice(0, 8)}`;
            const date = new Date(g.createdAt).toLocaleDateString('zh-CN');
            // 同一份 PDF 被多次上传 → 提示"× N"，避免用户怀疑"为什么我传了 4 次只看到 1 项"
            const dupSuffix = g.uploadIds.length > 1 ? ` · 上传 ${g.uploadIds.length} 次` : '';
            return (
              <option key={g.canonicalId} value={g.canonicalId}>
                {subjName ? `[${subjName}] ` : ''}
                {display}（{date}
                {dupSuffix}）
              </option>
            );
          })}
        </select>
        {/* 提交过滤时保留当前视图（list 才显式带；tree 是默认不带） */}
        {view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
        <button
          type="submit"
          className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          应用
        </button>
        {currentTextbook || currentSubject ? (
          <Link
            href={view === 'list' ? '/admin/kps?view=list' : '/admin/kps'}
            className="text-xs opacity-60 hover:opacity-100"
          >
            清除筛选
          </Link>
        ) : null}
        {currentSubject && textbooks.length === 0 ? (
          <span className="text-xs text-amber-600 ml-2">该学科下还没有上传教材</span>
        ) : null}

        {/* 视图切换器：tree（默认）/ list */}
        <span className="ml-auto inline-flex border rounded overflow-hidden text-xs">
          <Link
            href={buildViewLink('tree')}
            aria-current={view === 'tree' ? 'page' : undefined}
            className={`px-2 py-1 ${
              view === 'tree'
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            🌲 章节树
          </Link>
          <Link
            href={buildViewLink('list')}
            aria-current={view === 'list' ? 'page' : undefined}
            className={`px-2 py-1 border-l ${
              view === 'list'
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            ☰ 列表
          </Link>
        </span>
      </form>

      {subjects.length === 0 ? (
        <p className="text-sm text-amber-600 mb-3">
          subject 表为空。请总控先 seed 至少 1 条学科记录（如 math / 高中数学），否则无法创建 KP。
        </p>
      ) : null}

      {!currentTextbook ? (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-sm opacity-70">
            请先在上方选择学科和教材，本页将展示该教材下的全部 KP。
          </p>
          {!currentSubject ? (
            <p className="text-xs opacity-50 mt-2">教材列表会在选择具体学科后显示。</p>
          ) : textbooks.length === 0 ? (
            <p className="text-xs opacity-50 mt-2">
              该学科下还没有上传过教材。点右上角"↑ 上传教材解析"开始。
            </p>
          ) : null}
        </div>
      ) : kps.length === 0 ? (
        <p className="text-sm opacity-60">
          所选教材下暂无已发布的 KP
          {currentSubject ? `（学科：${currentSubject}）` : ''}。
          可能解析尚未审核通过；可在"导入审核"页继续操作。
        </p>
      ) : view === 'tree' ? (
        <KpTreeView
          kps={kps}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
          filteredSubject={currentSubject || undefined}
          chapterTitles={chapterTitles}
        />
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
                  <td className="p-2 text-right tabular-nums">{k.question_count}</td>
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
