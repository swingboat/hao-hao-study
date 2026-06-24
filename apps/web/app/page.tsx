import Link from 'next/link';
import { HOME_ACTION_LINKS } from '../lib/home-actions';
import { requireCurrentStudent } from '../lib/student-data';
import { getTodayPlannerDataForStudent } from '../lib/today-planner';
import { startTodaySessionAction } from './actions';

export const dynamic = 'force-dynamic';

interface HomePageProps {
  searchParams: Promise<{ notice?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [params, student] = await Promise.all([searchParams, requireCurrentStudent()]);
  const planner = await getTodayPlannerDataForStudent(student, {
    answerableOnly: true,
    onlyUnattemptedQuestions: true,
  });
  const readyCount = planner.sessionPlan?.questionIds.length ?? 0;
  const canStart = Boolean(planner.sessionPlan);
  const showPreparingNotice = params.notice === 'practice-preparing' || !canStart;
  const taskSummary = planner.taskSummary;

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">今日一轮复习</p>
          <h1 className="page-title">今天练这些</h1>
          <p className="muted mt-2">
            {planner.student.name} · {planner.student.gradeLabel} · {planner.student.targetExam}
          </p>
        </div>
      </section>

      {showPreparingNotice && taskSummary.positiveEmptyState ? (
        <p className="notice">{taskSummary.positiveEmptyState}</p>
      ) : null}

      <section className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">今日题量</span>
          <strong>{canStart ? readyCount : planner.result.targetCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">预计用时</span>
          <strong className="metric-text">{taskSummary.estimatedMinutes} 分钟</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">完成后</span>
          <strong className="metric-text">解析和进度变化</strong>
        </div>
      </section>

      <section className="content-section task-console-section">
        <div className="task-console-primary">
          <p className="chapter-label">今天练什么</p>
          <h2>{taskSummary.knowledgePointSummary}</h2>
          {taskSummary.chapterLabels.length > 0 ? (
            <p className="task-console-subtitle">{taskSummary.chapterLabels.join(' · ')}</p>
          ) : null}
          <div className="task-console-meta" aria-label="今日复习概览">
            <span>{canStart ? readyCount : planner.result.targetCount} 题</span>
            <span>{taskSummary.estimatedMinutes} 分钟</span>
            <span>完成后看解析和进度变化</span>
          </div>
          <form action={startTodaySessionAction}>
            <button
              type="submit"
              className="primary-button start-practice-button"
              disabled={!canStart}
            >
              {canStart ? '开始今日复习' : '今天先保持复习节奏'}
            </button>
          </form>
        </div>

        <aside className="task-console-context" aria-label="今日推荐说明">
          <div>
            <p className="chapter-label">为什么练</p>
            <div className="task-chip-list">
              {taskSummary.reasons.map((reason) => (
                <span className="task-chip" key={reason}>
                  {reason}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="chapter-label">做完看到什么</p>
            <ul className="task-outcome-list">
              {taskSummary.afterCompletion.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </aside>
      </section>

      <section className="home-action-grid" aria-label="学习入口">
        {HOME_ACTION_LINKS.map((action) => (
          <Link className="home-action-card" href={action.href} key={action.href}>
            <strong>{action.title}</strong>
            <span>{action.description}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
