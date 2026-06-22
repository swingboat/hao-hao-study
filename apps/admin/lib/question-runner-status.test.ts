import assert from 'node:assert/strict';
import test from 'node:test';
import { learningResourceParseJobOutcome } from './question-runner-status.ts';

test('learningResourceParseJobOutcome treats fallback page results with staging rows as succeeded', () => {
  const outcome = learningResourceParseJobOutcome(
    {
      ok: true,
      diagnostics: {
        parse_error: 'Bad escaped character in JSON at position 18130',
        validation_error: null,
        fallback_used: 'page_results',
      },
    },
    90,
  );

  assert.deepEqual(outcome, { status: 'succeeded', errorMessage: null });
});

test('learningResourceParseJobOutcome fails parse errors with no reviewable staging rows', () => {
  const outcome = learningResourceParseJobOutcome(
    {
      ok: true,
      diagnostics: {
        parse_error: 'No JSON object found in model output.',
        validation_error: null,
        fallback_used: null,
      },
    },
    0,
  );

  assert.deepEqual(outcome, {
    status: 'failed',
    errorMessage: 'No JSON object found in model output.',
  });
});
