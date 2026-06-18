import Link from 'next/link';
import { getSessionHistoryData, requireCurrentStudent } from '../../../lib/student-data';

export const dynamic = 'force-dynamic';

export default async function StudyHistoryPage() {
  const student = await requireCurrentStudent();
  const history = await getSessionHistoryData(student);

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">练习记录</p>
          <h1 className="page-title">最近完成的练习</h1>
          <p className="muted mt-2">{student.name} 的答题记录和解析入口</p>
        </div>
        <Link className="secondary-button" href="/">
          返回首页
        </Link>
      </section>

      {history.sessions.length === 0 ? (
        <section className="content-section empty-history">
          <h2>还没有完成记录</h2>
          <p>完成一次今日练习后，这里会出现批改结果和解析入口。</p>
          <Link className="primary-button" href="/">
            去开始练习
          </Link>
        </section>
      ) : (
        <section className="history-list" aria-label="练习记录列表">
          {history.sessions.map((session, index) => (
            <article className="history-card" key={session.id}>
              <div>
                <p className="history-title">第 {history.sessions.length - index} 次练习</p>
                <p className="muted">{formatSessionDate(session.ended_at ?? session.started_at)}</p>
              </div>
              <dl className="history-stats">
                <div>
                  <dt>题目</dt>
                  <dd>{session.questionCount}</dd>
                </div>
                <div>
                  <dt>答对</dt>
                  <dd>
                    {session.correctCount} / {session.answeredCount}
                  </dd>
                </div>
                <div>
                  <dt>正确率</dt>
                  <dd>{session.accuracyPercent}%</dd>
                </div>
              </dl>
              <Link className="primary-button" href={`/study/${session.id}/result`}>
                查看解析
              </Link>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function formatSessionDate(date: Date): string {
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
