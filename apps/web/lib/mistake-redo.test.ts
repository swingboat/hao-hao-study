import assert from 'node:assert/strict';
import test from 'node:test';
import { nextMistakeReviewState } from './mistake-redo.ts';

test('keeps an incorrectly redone mistake open and resets the streak', () => {
  assert.deepEqual(
    nextMistakeReviewState({
      errorCount: 2,
      consecutiveCorrectCount: 1,
      isCorrect: false,
    }),
    {
      status: 'open',
      errorCount: 3,
      consecutiveCorrectCount: 0,
      resolvedNow: false,
    },
  );
});

test('requires two consecutive correct redos before resolving a mistake', () => {
  assert.deepEqual(
    nextMistakeReviewState({
      errorCount: 2,
      consecutiveCorrectCount: 0,
      isCorrect: true,
    }),
    {
      status: 'open',
      errorCount: 2,
      consecutiveCorrectCount: 1,
      resolvedNow: false,
    },
  );

  assert.deepEqual(
    nextMistakeReviewState({
      errorCount: 2,
      consecutiveCorrectCount: 1,
      isCorrect: true,
    }),
    {
      status: 'resolved',
      errorCount: 2,
      consecutiveCorrectCount: 2,
      resolvedNow: true,
    },
  );
});
