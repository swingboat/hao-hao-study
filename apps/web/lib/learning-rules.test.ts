import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMasteryDelta,
  getMasteryDelta,
  isAnswerCorrect,
  selectNewPoolQuestions,
  withUnlockedPrimaryKpFilter,
} from './learning-rules.ts';

test('choice answers ignore order, whitespace, and case', () => {
  assert.equal(isAnswerCorrect(' b a ', 'AB', 'choice'), true);
  assert.equal(isAnswerCorrect('AC', 'AB', 'choice'), false);
});

test('fill-in answers normalize full-width punctuation and whitespace', () => {
  assert.equal(isAnswerCorrect(' １，２ ', '1,2', 'fill_in'), true);
  assert.equal(isAnswerCorrect('1;3', '1;2', 'fill_in'), false);
});

test('mastery deltas follow the v0.1 difficulty table and clamp to [0, 1]', () => {
  assert.equal(getMasteryDelta(1, true), 0.05);
  assert.equal(getMasteryDelta(2, false), -0.15);
  assert.equal(getMasteryDelta(3, true), 0.1);
  assert.equal(getMasteryDelta(3, false), -0.08);
  assert.equal(getMasteryDelta(5, true), 0.15);
  assert.equal(getMasteryDelta(4, false), -0.03);
  assert.equal(applyMasteryDelta(0.98, 0.15), 1);
  assert.equal(applyMasteryDelta(0.02, -0.15), 0);
});

test('unlocked filter uses primary_kp_id membership only', () => {
  assert.deepEqual(withUnlockedPrimaryKpFilter(['kp-a', 'kp-b']), {
    primary_kp_id: { in: ['kp-a', 'kp-b'] },
  });
});

test('new pool selection never leaks locked KP and keeps one question per KP', () => {
  const selected = selectNewPoolQuestions(
    [
      { id: 'q-locked', primary_kp_id: 'kp-locked', difficulty: 1, created_at: new Date(1) },
      { id: 'q-a-1', primary_kp_id: 'kp-a', difficulty: 2, created_at: new Date(1) },
      { id: 'q-a-2', primary_kp_id: 'kp-a', difficulty: 1, created_at: new Date(2) },
      { id: 'q-b-1', primary_kp_id: 'kp-b', difficulty: 3, created_at: new Date(3) },
    ],
    ['kp-a', 'kp-b'],
    15,
  );

  assert.deepEqual(
    selected.map((q) => q.id),
    ['q-a-1', 'q-b-1'],
  );
});
