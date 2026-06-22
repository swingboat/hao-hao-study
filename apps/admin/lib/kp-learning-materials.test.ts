import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MATERIAL_TYPE_LABELS,
  groupLearningMaterialsByType,
} from './kp-learning-materials.ts';

test('groupLearningMaterialsByType orders published materials by learning category', () => {
  const grouped = groupLearningMaterialsByType([
    material({
      id: 'm-2',
      material_type: 'method_card',
      title: '集合题先看元素',
      source_unit: { page_no: 3, question_no: '例 2', text_snippet: '先看元素' },
    }),
    material({
      id: 'm-1',
      material_type: 'concept_explanation',
      title: '集合定义',
      source_document: { title: '集合讲义第 1 讲' },
      source_unit: { page_no: 1, text_snippet: '集合是确定对象的整体' },
    }),
    material({
      id: 'm-3',
      material_type: 'study_advice',
      title: '复习建议',
      source_document: { title: '集合讲义第 1 讲' },
      source_unit: { page_no: 5 },
    }),
  ]);

  assert.deepEqual(
    grouped.map((group) => group.type),
    ['concept_explanation', 'method_card', 'study_advice'],
  );
  assert.equal(grouped[0]?.label, MATERIAL_TYPE_LABELS.concept_explanation);
  assert.equal(grouped[0]?.items[0]?.title, '集合定义');
  assert.equal(grouped[0]?.items[0]?.sourceLabel, '集合讲义第 1 讲 · p1');
  assert.equal(grouped[1]?.items[0]?.sourceLabel, 'p3 · 例 2');
  assert.equal(grouped[1]?.items[0]?.textSnippet, '先看元素');
});

function material(overrides: Record<string, unknown>) {
  return {
    id: 'm',
    material_type: 'concept_explanation',
    title: '标题',
    content: '正文',
    student_summary: null,
    confidence: null,
    source_document: null,
    source_unit: null,
    created_at: new Date('2026-06-21T00:00:00Z'),
    ...overrides,
  };
}
