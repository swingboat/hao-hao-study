import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSessionHistory } from './session-history.ts';

test('summarizes completed session history for display', () => {
  const startedAt = new Date('2026-06-17T10:00:00.000Z');
  const endedAt = new Date('2026-06-17T10:20:00.000Z');

  const summary = summarizeSessionHistory({
    id: 'session-1',
    started_at: startedAt,
    ended_at: endedAt,
    question_ids: ['q1', 'q2', 'q3'],
    question_attempts: [{ is_correct: true }, { is_correct: false }, { is_correct: true }],
  });

  assert.deepEqual(summary, {
    id: 'session-1',
    started_at: startedAt,
    ended_at: endedAt,
    questionCount: 3,
    answeredCount: 3,
    correctCount: 2,
    accuracyPercent: 67,
  });
});

test('uses attempts as the denominator when historical question ids are absent', () => {
  const summary = summarizeSessionHistory({
    id: 'session-2',
    started_at: new Date('2026-06-17T10:00:00.000Z'),
    ended_at: null,
    question_ids: [],
    question_attempts: [{ is_correct: false }],
  });

  assert.equal(summary.questionCount, 1);
  assert.equal(summary.accuracyPercent, 0);
});
