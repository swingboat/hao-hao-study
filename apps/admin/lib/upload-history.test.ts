import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUploadHistoryDeletePlan } from './upload-history-plan.ts';

test('buildUploadHistoryDeletePlan deletes storage when no other upload references the file', () => {
  const plan = buildUploadHistoryDeletePlan(
    { id: 'u1', file_uri: 'uploads/a.pdf', purpose: 'knowledge_point' },
    'knowledge_point',
    0,
  );

  assert.deepEqual(plan, {
    ok: true,
    uploadId: 'u1',
    fileUri: 'uploads/a.pdf',
    deleteStorageObject: true,
  });
});

test('buildUploadHistoryDeletePlan keeps storage when another upload references the same file', () => {
  const plan = buildUploadHistoryDeletePlan(
    { id: 'u1', file_uri: 'uploads/a.pdf', purpose: 'question' },
    'question',
    1,
  );

  assert.deepEqual(plan, {
    ok: true,
    uploadId: 'u1',
    fileUri: 'uploads/a.pdf',
    deleteStorageObject: false,
  });
});

test('buildUploadHistoryDeletePlan rejects uploads from another purpose', () => {
  const plan = buildUploadHistoryDeletePlan(
    { id: 'u1', file_uri: 'uploads/a.pdf', purpose: 'question' },
    'knowledge_point',
    0,
  );

  assert.deepEqual(plan, {
    ok: false,
    reason: 'wrong_purpose',
  });
});
