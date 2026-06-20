import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedMistakeFeedback } from './session-result-feedback.ts';

test('marks attempts that resolved historical mistakes during this session', () => {
  const feedback = buildResolvedMistakeFeedback({
    attempts: [
      { questionId: 'q-1', isCorrect: true },
      { questionId: 'q-2', isCorrect: false },
      { questionId: 'q-3', isCorrect: true },
    ],
    resolvedQuestionIds: ['q-3'],
  });

  assert.deepEqual(feedback, {
    resolvedCount: 1,
    resolvedQuestionIds: new Set(['q-3']),
    headline: '本次攻克 1 道历史错题',
  });
});

test('omits resolved-mistake headline when nothing was resolved', () => {
  assert.deepEqual(
    buildResolvedMistakeFeedback({
      attempts: [{ questionId: 'q-1', isCorrect: true }],
      resolvedQuestionIds: [],
    }),
    {
      resolvedCount: 0,
      resolvedQuestionIds: new Set<string>(),
      headline: null,
    },
  );
});
