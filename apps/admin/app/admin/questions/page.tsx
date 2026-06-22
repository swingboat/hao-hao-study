/**
 * F3 试题列表 — /admin/questions
 * 按 KP 分组聚合 question；每组列出题数 + 最近 N 条题摘要。
 * 顶部入口：上传题集 PDF（→ /admin/questions/import）。
 *
 * v0.1 KP 没挂 textbook FK，列表纯按 primary_kp_id 聚合；学科过滤通过 KP→subject 反查。
 *
 * ⚠️ schema 缺口（v0.1）：`question` 表无 `options` 列，choice 题选项只在
 *   `llm_parse_staging.review_payload` JSONB 里（accept 时落进去）。这里靠
 *   `published_id` 反查 staging 把 options 拼回来仅用于展示；web端读 question
 *   暂时拿不到选项 —— 需要总控（A）给 schema 加列才能根治。
 */
import { prisma } from '@hao/db';
import Link from 'next/link';
import { sortSubjectsByStage } from '../../../lib/subjects';
import type { LlmQuestionPayload } from './import/[uploadId]/diff-drawer';
import { MathText } from './import/[uploadId]/math-text';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ subject?: string }>;
}

function questionTypeLabel(type: 'choice' | 'fill_in'): string {
  return type === 'choice' ? '选择题' : '填空题';
}

export default async function QuestionsListPage({ searchParams }: PageProps) {
  const { subject: subjectFilter } = await searchParams;

  const [subjects, questions] = await Promise.all([
    prisma.subject.findMany().then(sortSubjectsByStage),
    prisma.question.findMany({
      orderBy: [{ primary_kp_id: 'asc' }, { created_at: 'desc' }],
      take: 500,
      select: {
        id: true,
        content: true,
        question_type: true,
        difficulty: true,
        answer: true,
        primary_kp_id: true,
        created_at: true,
      },
    }),
  ]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject.name]));

  const kpIds = Array.from(new Set(questions.map((question) => question.primary_kp_id)));
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

  // 反查 staging 把 options 拼回来（schema 缺口的临时桥）。
  // 一次性按 published_id IN (...) 拉，避免 N+1。
  const questionIds = questions.map((question) => question.id);
  const stagings = questionIds.length
    ? await prisma.llm_parse_staging.findMany({
        where: { published_id: { in: questionIds }, entity_kind: 'question' },
        select: { published_id: true, review_payload: true },
      })
    : [];
  const optionsMap = new Map<string, Array<{ label: string; text: string }>>();
  for (const s of stagings) {
    if (!s.published_id) continue;
    const opts = (s.review_payload as LlmQuestionPayload | null)?.options;
    if (Array.isArray(opts) && opts.length > 0) optionsMap.set(s.published_id, opts);
  }

  // 按学科过滤后只保留命中 KP 的题
  const filtered = subjectFilter
    ? questions.filter((question) => kpMap.has(question.primary_kp_id))
    : questions;

  // 分组：按 KP（缺失映射时归 unknown）
  const groups = new Map<
    string,
    {
      kp: { id: string; name: string; subject_id: string; chapter_no: string | null } | null;
      questions: typeof filtered;
    }
  >();
  for (const question of filtered) {
    const kp = kpMap.get(question.primary_kp_id) ?? null;
    const key = kp?.id ?? `__missing__${question.primary_kp_id}`;
    const g = groups.get(key);
    if (g) g.questions.push(question);
    else groups.set(key, { kp, questions: [question] });
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
            按主知识点聚合；当前最多显示 500 条，更多请按知识点或学科筛选。
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
            href="/admin/questions/import"
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
                      <span className="opacity-60 ml-2 text-xs">
                        学科 {subjectMap.get(g.kp.subject_id) ?? g.kp.subject_id}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-700">知识点已删除或不属于当前筛选学科</span>
                  )}
                </h2>
                <span className="text-xs opacity-60">{g.questions.length} 题</span>
              </header>
              <ul className="divide-y">
                {g.questions.slice(0, 10).map((question) => {
                  const opts = optionsMap.get(question.id);
                  return (
                    <li key={question.id} className="px-4 py-2 text-xs">
                      <div className="flex items-baseline gap-2 mb-1 opacity-60">
                        <span>{questionTypeLabel(question.question_type)}</span>
                        <span>难度 {question.difficulty}</span>
                        <span className="ml-auto">
                          {question.created_at.toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      <MathText
                        block
                        text={question.content}
                        className="text-sm leading-snug line-clamp-3"
                      />
                      {question.question_type === 'choice' && opts && opts.length > 0 ? (
                        <ul className="mt-1 ml-1 space-y-0.5 text-xs">
                          {opts.map((o) => (
                            <li key={o.label} className="flex gap-2">
                              <span className="font-mono opacity-70 shrink-0">{o.label}.</span>
                              <MathText text={o.text} />
                            </li>
                          ))}
                        </ul>
                      ) : question.question_type === 'choice' ? (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                          选择题选项暂未显示，请到原审核记录中查看。
                        </p>
                      ) : null}
                      <p className="opacity-60 mt-1 inline-flex items-baseline gap-1">
                        <span>答案</span>
                        <MathText text={question.answer} className="text-xs" />
                      </p>
                    </li>
                  );
                })}
                {g.questions.length > 10 ? (
                  <li className="px-4 py-2 text-xs opacity-60">
                    （还有 {g.questions.length - 10} 题未显示）
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
