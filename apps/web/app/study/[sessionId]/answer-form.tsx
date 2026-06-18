'use client';

import { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { buildSessionSubmitPath } from '../../../lib/session-submit-path';
import type { SessionQuestionView } from '../../../lib/student-data';
import { QuestionContentBlock } from '../question-content-block';

interface AnswerFormProps {
  sessionId: string;
  startedAt: string;
  questions: SessionQuestionView[];
}

export function AnswerForm({ sessionId, startedAt, questions }: AnswerFormProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const current = questions[currentIndex];
  const answeredCount = useMemo(
    () => questions.filter((question) => answers[question.id]?.trim()).length,
    [answers, questions],
  );

  if (!current) {
    return <p className="notice">这组题为空，请返回首页重新开始。</p>;
  }

  const currentAnswer = answers[current.id] ?? '';

  return (
    <form action={buildSessionSubmitPath(sessionId)} className="study-shell" method="post">
      <input type="hidden" name="sessionId" value={sessionId} />
      {questions.map((question) => (
        <input
          key={question.id}
          type="hidden"
          name={`answer_${question.id}`}
          value={answers[question.id] ?? ''}
        />
      ))}

      <header className="study-header">
        <div>
          <p className="eyebrow">25 分钟题组</p>
          <h1>
            {currentIndex + 1} / {questions.length}
          </h1>
          <p className="muted">开始时间 {new Date(startedAt).toLocaleTimeString('zh-CN')}</p>
        </div>
        <div className="answered-pill">{answeredCount} 已答</div>
      </header>

      <nav className="question-nav" aria-label="题号导航">
        {questions.map((question, index) => (
          <button
            key={question.id}
            type="button"
            className={index === currentIndex ? 'question-dot active' : 'question-dot'}
            data-answered={Boolean(answers[question.id]?.trim())}
            onClick={() => setCurrentIndex(index)}
          >
            {index + 1}
          </button>
        ))}
      </nav>

      <section className="question-panel">
        <QuestionContentBlock parts={current.contentParts} />

        {current.question_type === 'choice' ? (
          <div className="choice-list">
            {current.options.map((option) => (
              <label
                key={option.label}
                className={
                  currentAnswer === option.label ? 'choice-option selected' : 'choice-option'
                }
              >
                <input
                  type="radio"
                  name={`visible_${current.id}`}
                  value={option.label}
                  checked={currentAnswer === option.label}
                  onChange={() =>
                    setAnswers((prev) => ({
                      ...prev,
                      [current.id]: option.label,
                    }))
                  }
                />
                <span className="option-label">{option.label}</span>
                <span>{option.text}</span>
              </label>
            ))}
          </div>
        ) : (
          <input
            className="fill-input"
            value={currentAnswer}
            onChange={(event) =>
              setAnswers((prev) => ({
                ...prev,
                [current.id]: event.target.value,
              }))
            }
            placeholder="输入答案"
          />
        )}
      </section>

      <footer className="study-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
          disabled={currentIndex === 0}
        >
          上一题
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
          disabled={currentIndex === questions.length - 1}
        >
          下一题
        </button>
        <SubmitButton />
      </footer>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary-button" disabled={pending}>
      {pending ? '批改中...' : '提交全部'}
    </button>
  );
}
