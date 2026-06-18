import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatStudentDisplayText } from '../../../../lib/display-text';
import { getSessionResultData, requireCurrentStudent } from '../../../../lib/student-data';
import { QuestionContentBlock } from '../../question-content-block';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionResultPage({ params }: PageProps) {
  const [{ sessionId }, student] = await Promise.all([params, requireCurrentStudent()]);
  const result = await getSessionResultData(student, sessionId);

  if (!result) redirect('/');

  const correctCount = result.attempts.filter((attempt) => attempt.is_correct).length;
  const total = result.attempts.length;
  const percent = total === 0 ? 0 : Math.round((correctCount / total) * 100);

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">解析</p>
          <h1 className="page-title">
            答对 {correctCount} / {total}
          </h1>
          <p className="muted mt-2">
            正确率 {percent}% · 完成时间{' '}
            {result.ended_at ? result.ended_at.toLocaleTimeString('zh-CN') : '刚刚'}
          </p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/study/history">
            练习记录
          </Link>
          <Link className="primary-button" href="/">
            返回首页
          </Link>
        </div>
      </section>

      <div className="result-list">
        {result.attempts.map((attempt, index) => (
          <article
            className={attempt.is_correct ? 'result-card correct' : 'result-card wrong'}
            key={attempt.id}
          >
            <div className="result-head">
              <span>第 {index + 1} 题</span>
              <strong>{attempt.is_correct ? '正确' : '错误'}</strong>
            </div>
            <QuestionContentBlock parts={attempt.question.contentParts} />
            <dl className="answer-grid">
              <div>
                <dt>我的答案</dt>
                <dd>{formatStudentDisplayText(attempt.student_answer || '未作答')}</dd>
              </div>
              <div>
                <dt>正确答案</dt>
                <dd>{formatStudentDisplayText(attempt.question.answer)}</dd>
              </div>
            </dl>
            <div className="solution-block">
              <h2>解析</h2>
              <QuestionContentBlock parts={attempt.question.solutionParts} />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
