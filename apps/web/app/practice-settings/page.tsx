import { prisma } from '@hao/db';
import Link from 'next/link';
import { resolvePlannerPreference } from '../../lib/planner-preferences';
import { requireCurrentStudent } from '../../lib/student-data';
import { PlannerSettingsForm } from '../planner-settings-form';

export const dynamic = 'force-dynamic';

export default async function PracticeSettingsPage() {
  const student = await requireCurrentStudent();
  const preferenceRow = await prisma.student_planner_preference.findUnique({
    where: { student_id: student.id },
    select: { mode: true, weights: true },
  });
  const preference = resolvePlannerPreference(preferenceRow);
  const modeLabel = preference.mode === 'custom' ? '自定义比例' : '自动安排';

  return (
    <main className="page-shell narrow-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">练习设置</p>
          <h1 className="page-title">出题来源</h1>
          <p className="muted mt-2">调整今日练习里不同类型题目的安排比例。</p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
        </div>
      </section>

      <section className="content-section planner-settings-section">
        <div className="section-heading-row">
          <div>
            <h2>今日练习怎么安排</h2>
            <p>
              自动安排会根据近期错题、复习节奏和新学内容综合分配；自定义比例适合临时加强某一类练习。
            </p>
          </div>
          <span className="mode-pill">{modeLabel}</span>
        </div>
        <PlannerSettingsForm preference={preference} />
      </section>
    </main>
  );
}
