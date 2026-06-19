import Link from 'next/link';
import { requireCurrentStudent } from '../lib/student-data';
import { getTodayPlannerDataForStudent } from '../lib/today-planner';
import { startTodaySessionAction } from './actions';
import { PlannerSettingsForm } from './planner-settings-form';

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

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">今日练习</p>
          <h1 className="page-title">{planner.student.name}</h1>
          <p className="muted mt-2">
            {planner.student.gradeLabel} · {planner.student.targetExam}
          </p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/progress">
            学习进度
          </Link>
          <div className="practice-status" data-ready={canStart}>
            {canStart ? '今日练习已准备好' : '今日练习正在准备'}
          </div>
        </div>
      </section>

      {showPreparingNotice ? <p className="notice">今天的练习还在准备中，稍后再来看看。</p> : null}

      <section className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">今日题量</span>
          <strong>{canStart ? readyCount : planner.result.targetCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">预计用时</span>
          <strong className="metric-text">25 分钟</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">完成后</span>
          <strong className="metric-text">查看解析</strong>
        </div>
      </section>

      <section className="content-section practice-start-section">
        <div>
          <h2>开始今日练习</h2>
          <p>一次完成这组题，提交后会马上看到批改结果和解析。</p>
        </div>
        <form action={startTodaySessionAction}>
          <button
            type="submit"
            className="primary-button start-practice-button"
            disabled={!canStart}
          >
            {canStart ? '开始今日练习' : '练习准备中'}
          </button>
        </form>
        <Link className="secondary-button" href="/study/history">
          查看练习记录
        </Link>
      </section>

      <section className="content-section planner-settings-section">
        <div className="section-heading-row">
          <div>
            <h2>练习设置</h2>
            <p>选择今天各类练习的安排比例。</p>
          </div>
          <span className="mode-pill">
            {planner.plannerPreference.mode === 'auto' ? '自动安排' : '自定义比例'}
          </span>
        </div>
        <PlannerSettingsForm preference={planner.plannerPreference} />
      </section>
    </main>
  );
}
