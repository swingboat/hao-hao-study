import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionSubmitPath, readSubmittedAnswers } from './session-submit-path.ts';

test('builds a stable POST URL for study session submission', () => {
  assert.equal(
    buildSessionSubmitPath('a515c12d-7feb-46ad-a1ae-6865ec05bf40'),
    '/study/a515c12d-7feb-46ad-a1ae-6865ec05bf40/submit',
  );
});

test('reads submitted answers from FormData without exposing transport fields', () => {
  const formData = new FormData();
  formData.set('sessionId', 'session-1');
  formData.set('answer_q-1', ' A ');
  formData.set('answer_q-2', '42');

  assert.deepEqual(
    readSubmittedAnswers(formData),
    new Map([
      ['q-1', 'A'],
      ['q-2', '42'],
    ]),
  );
});
