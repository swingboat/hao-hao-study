import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupportingAcceptPlan } from './supporting-staging-bulk.ts';

test('buildSupportingAcceptPlan only accepts pending source documents and learning materials', () => {
  const plan = buildSupportingAcceptPlan(
    [
      {
        id: 'source-1',
        entity_kind: 'source_document',
        review_status: 'pending',
        llm_payload: { _subject_id: 'math_senior', title: '第 1 讲' },
      },
      {
        id: 'material-1',
        entity_kind: 'learning_material',
        review_status: 'pending',
        llm_payload: { _subject_id: 'math_senior', title: '互异性提醒' },
      },
      {
        id: 'question-1',
        entity_kind: 'question',
        review_status: 'pending',
        llm_payload: { _subject_id: 'math_senior' },
      },
      {
        id: 'material-accepted',
        entity_kind: 'learning_material',
        review_status: 'accepted',
        llm_payload: { _subject_id: 'math_senior' },
      },
    ],
    '',
  );

  assert.deepEqual(plan.items, [
    { id: 'source-1', entityKind: 'source_document', subjectId: 'math_senior' },
    { id: 'material-1', entityKind: 'learning_material', subjectId: 'math_senior' },
  ]);
  assert.deepEqual(plan.skipReasons, []);
});

test('buildSupportingAcceptPlan falls back to the page subject and reports missing subjects', () => {
  const plan = buildSupportingAcceptPlan(
    [
      {
        id: 'source-1',
        entity_kind: 'source_document',
        review_status: 'pending',
        llm_payload: { title: '第 1 讲' },
      },
      {
        id: 'material-1',
        entity_kind: 'learning_material',
        review_status: 'pending',
        llm_payload: { title: '互异性提醒' },
      },
    ],
    '',
  );

  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.skipReasons, [
    '来源资料 source-1 缺少学科',
    '学习材料 material-1 缺少学科',
  ]);

  const fallbackPlan = buildSupportingAcceptPlan(
    [
      {
        id: 'source-1',
        entity_kind: 'source_document',
        review_status: 'pending',
        llm_payload: { title: '第 1 讲' },
      },
    ],
    'math_senior',
  );
  assert.deepEqual(fallbackPlan.items, [
    { id: 'source-1', entityKind: 'source_document', subjectId: 'math_senior' },
  ]);
});
