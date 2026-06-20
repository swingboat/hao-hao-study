import Link from 'next/link';
import { getMistakeBookData, mistakeBookEmptyState } from '../../../lib/mistake-book';
import { requireCurrentStudent } from '../../../lib/student-data';
import { startTodaySessionAction } from '../../actions';
import { QuestionContentBlock } from '../question-content-block';

export const dynamic = 'force-dynamic';

export default async function MistakeBookPage() {
  const student = await requireCurrentStudent();
  const mistakeBook = await getMistakeBookData(student);

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">错题复习</p>
          <h1 className="page-title">需要回炉的题</h1>
          <p className="muted mt-2">按知识点整理最近做错的题，优先攻克反复卡住的地方。</p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
          <form action={startTodaySessionAction}>
            <button className="primary-button" type="submit">
              开始今日复习
            </button>
          </form>
        </div>
      </section>

      <section className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">待巩固错题</span>
          <strong>{mistakeBook.totalCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">涉及知识点</span>
          <strong>{mistakeBook.groups.length}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">建议方式</span>
          <strong className="metric-text">逐题重做</strong>
        </div>
      </section>

      {mistakeBook.groups.length === 0 ? (
        <section className="content-section empty-state">
          <h2>今天错题很清爽</h2>
          <p>{mistakeBookEmptyState}</p>
          <Link className="primary-button" href="/">
            回到今日复习
          </Link>
        </section>
      ) : (
        <section className="mistake-book-list" aria-label="错题复习列表">
          {mistakeBook.groups.map((group) => (
            <details className="mistake-group" key={group.knowledgePointName} open>
              <summary className="mistake-group-summary">
                <div>
                  <p className="chapter-label">知识点</p>
                  <h2>{group.knowledgePointName}</h2>
                </div>
                <span>{group.itemCount} 道待巩固</span>
              </summary>

              <div className="mistake-card-list">
                {group.items.map((item) => (
                  <article className="mistake-card" key={item.questionId}>
                    <div>
                      <div className="mistake-card-preview">
                        {item.questionContentParts.length > 0 ? (
                          <QuestionContentBlock parts={item.questionContentParts} />
                        ) : (
                          <p>{item.questionSummary}</p>
                        )}
                      </div>
                      <div className="mistake-card-meta">
                        <span>累计做错 {item.errorCount} 次</span>
                        <span>最近 {formatDate(item.lastPracticedAt)}</span>
                      </div>
                    </div>
                    <Link className="primary-button" href={`/study/mistakes/${item.questionId}`}>
                      重做这题
                    </Link>
                  </article>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
    </main>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}
