import assert from 'node:assert/strict';
import test from 'node:test';
import { questionTypeLabel } from './question-type-label.ts';

test('questionTypeLabel maps internal question type values to admin-facing labels', () => {
  assert.equal(questionTypeLabel('choice'), '选择题');
  assert.equal(questionTypeLabel('fill_in'), '填空题');
});

test('questionTypeLabel keeps unknown values readable without exposing empty text', () => {
  assert.equal(questionTypeLabel('essay'), 'essay');
  assert.equal(questionTypeLabel(null), '未识别题型');
});
