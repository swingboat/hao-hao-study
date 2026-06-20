'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SessionQuestionView } from '../../../../lib/student-data';
import { QuestionContentBlock } from '../../question-content-block';
import { type MistakeRedoFormState, submitMistakeRedoAction } from './actions';

interface MistakeRedoFormProps {
  question: SessionQuestionView;
}

const INITIAL_STATE: MistakeRedoFormState = {
  status: 'idle',
  message: null,
  isCorrect: null,
  studentAnswer: '',
  resolvedNow: false,
};

export function MistakeRedoForm({ question }: MistakeRedoFormProps) {
  const [state, formAction] = useActionState(submitMistakeRedoAction, INITIAL_STATE);

  return (
    <form action={formAction} className="study-shell">
      <input name="questionId" type="hidden" value={question.id} />

      <section className="question-panel">
        <QuestionContentBlock parts={question.contentParts} />

        {question.question_type === 'choice' ? (
          <div className="choice-list">
            {question.options.map((option) => (
              <label className="choice-option" key={option.label}>
                <input name="answer" type="radio" value={option.label} />
                <span className="option-label">{option.label}</span>
                <span>{option.text}</span>
              </label>
            ))}
          </div>
        ) : (
          <input className="fill-input" name="answer" placeholder="输入答案" />
        )}
      </section>

      <footer className="study-actions">
        <SubmitButton />
      </footer>

      {state.status !== 'idle' ? (
        <section
          className={
            state.isCorrect
              ? 'content-section redo-result correct'
              : 'content-section redo-result wrong'
          }
        >
          <div className="result-head">
            <span>本题批改</span>
            <strong>{state.isCorrect ? '正确' : '还需巩固'}</strong>
          </div>
          {state.message ? <p>{state.message}</p> : null}
          <dl className="answer-grid">
            <div>
              <dt>你的答案</dt>
              <dd>{state.studentAnswer || '未作答'}</dd>
            </div>
            <div>
              <dt>正确答案</dt>
              <dd>{question.answer}</dd>
            </div>
          </dl>
          <div className="solution-block">
            <h2>解析</h2>
            <QuestionContentBlock parts={question.solutionParts} />
          </div>
          <div className="redo-result-actions">
            <a className="secondary-button" href="/study/mistakes">
              返回错题复习
            </a>
            <a className="primary-button" href="/">
              回到今日复习
            </a>
          </div>
        </section>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? '批改中...' : '提交并查看解析'}
    </button>
  );
}
