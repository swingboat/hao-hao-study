import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatStudentDisplayText } from '../../../../lib/display-text';
import { buildSessionResultChoiceOptions } from '../../../../lib/session-result-options';
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
  const knowledgeGroupById = new Map(
    result.relatedKnowledgeGroups.map((group) => [group.kpId, group]),
  );

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

      {result.reviewPlan ? (
        <section className="review-plan-section" aria-labelledby="review-plan-title">
          <div className="review-advice-band">
            <div>
              <p className="eyebrow">本次复盘建议</p>
              <h2 id="review-plan-title">{result.reviewPlan.headline}</h2>
              <p>{result.reviewPlan.summary}</p>
              {result.reviewPlan.encouragement ? (
                <p className="review-encouragement">{result.reviewPlan.encouragement}</p>
              ) : null}
            </div>
            <ol className="review-step-list">
              {result.reviewPlan.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="review-focus-grid">
            {result.reviewPlan.focusItems.map((item) => {
              const group = knowledgeGroupById.get(item.kpId);

              return (
                <article className="review-focus-card" key={item.kpId}>
                  <div className="review-focus-head">
                    <span>{item.priorityLabel}</span>
                    <strong>{item.scoreText}</strong>
                  </div>
                  <div>
                    <h3>{item.knowledgePointName}</h3>
                    {item.reason ? <p className="review-focus-reason">{item.reason}</p> : null}
                    <p>{item.suggestion}</p>
                  </div>
                  {item.recommendedLabels.length > 0 ? (
                    <div className="review-material-pills" aria-label="推荐先看">
                      {item.recommendedLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  ) : null}
                  {group?.materials.length ? (
                    <details className="review-material-details">
                      <summary>查看推荐材料</summary>
                      <div className="review-material-list">
                        {group.materials.slice(0, 3).map((material) => (
                          <div className="review-material-row" key={material.id}>
                            <div className="review-material-row-head">
                              <span>{material.label}</span>
                              <h4>{material.title}</h4>
                            </div>
                            <p>{material.studentSummary || material.content}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="result-list">
        {result.attempts.map((attempt, index) => {
          const choiceOptions = buildSessionResultChoiceOptions({
            questionType: attempt.question.question_type,
            options: attempt.question.options,
            studentAnswer: attempt.student_answer,
            correctAnswer: attempt.question.answer,
          });

          return (
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
              {choiceOptions.length > 0 ? (
                <div className="result-choice-list" aria-label="选项">
                  {choiceOptions.map((option) => {
                    const markers = [
                      option.isStudentAnswer ? '你的答案' : '',
                      option.isCorrectAnswer ? '正确答案' : '',
                    ].filter(Boolean);

                    return (
                      <div
                        className={[
                          'result-choice-option',
                          option.isStudentAnswer ? 'student-answer' : '',
                          option.isCorrectAnswer ? 'correct-answer' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={option.label}
                      >
                        <span className="result-option-label">{option.label}</span>
                        <span className="result-option-text">{option.text}</span>
                        {markers.length > 0 ? (
                          <span className="result-choice-marker">{markers.join(' · ')}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
          );
        })}
      </div>
    </main>
  );
}
