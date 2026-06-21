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

      {result.resolvedMistakeHeadline ? (
        <section className="content-section success-panel">
          <h2>{result.resolvedMistakeHeadline}</h2>
          <p>这些题已经从错题复习中移除，后面会继续把时间留给更需要巩固的内容。</p>
        </section>
      ) : null}

      {result.relatedKnowledgeGroups.length > 0 ? (
        <section className="related-knowledge-section" aria-labelledby="related-knowledge-title">
          <div className="section-heading-row">
            <div>
              <h2 id="related-knowledge-title">本次复盘重点</h2>
              <p>先看和这次练习最相关的知识点，再回到每道题的解析。</p>
            </div>
          </div>

          <div className="related-knowledge-list">
            {result.relatedKnowledgeGroups.map((group) => (
              <article className="related-knowledge-group" key={group.kpId}>
                <div className="related-knowledge-group-head">
                  <div>
                    <p className="related-knowledge-status">
                      {group.status === 'needs_work' ? '这部分还需要巩固' : '这部分可以顺手复习'}
                    </p>
                    <h3>{group.knowledgePointName}</h3>
                  </div>
                  <span>
                    本次 {group.correctCount} / {group.totalCount}
                  </span>
                </div>

                <div className="related-material-list">
                  {group.materials.map((material) => (
                    <article className="related-material-item" key={material.id}>
                      <div className="related-material-head">
                        <span>{material.label}</span>
                        <h4>{material.title}</h4>
                      </div>
                      {material.studentSummary ? (
                        <p className="related-material-summary">{material.studentSummary}</p>
                      ) : null}
                      <p className="related-material-content">{material.content}</p>
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="result-list">
        {result.attempts.map((attempt, index) => (
          <article
            className={attempt.is_correct ? 'result-card correct' : 'result-card wrong'}
            key={attempt.id}
          >
            <div className="result-head">
              <span>第 {index + 1} 题</span>
              <strong>{attempt.is_correct ? '正确' : '还需巩固'}</strong>
            </div>
            {attempt.mistakeResolved ? (
              <p className="resolved-mistake-note">这道错题已攻克，已从错题复习中移除。</p>
            ) : null}
            <QuestionContentBlock parts={attempt.question.contentParts} />
            <dl className="answer-grid">
              <div>
                <dt>你的答案</dt>
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
