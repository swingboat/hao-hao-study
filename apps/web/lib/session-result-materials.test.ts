import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionResultKnowledgeGroups,
  getLearningMaterialLabel,
} from './session-result-materials.ts';

const now = new Date('2026-06-21T08:00:00Z');

test('keeps only materials related to current unlocked session knowledge points', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [{ id: 'q-1', isCorrect: false, primaryKpId: 'kp-a', kpIds: ['kp-a', 'kp-b'] }],
    unlockedKpIds: ['kp-a', 'kp-b'],
    knowledgePoints: [
      { id: 'kp-a', name: '集合的含义' },
      { id: 'kp-b', name: '集合间的关系' },
    ],
    materials: [
      material({ id: 'm-a', primaryKpId: 'kp-a', title: '集合易错点' }),
      material({ id: 'm-b', primaryKpId: null, kpIds: ['kp-b'], title: '关系方法卡' }),
      material({
        id: 'm-locked',
        primaryKpId: 'kp-locked',
        kpIds: ['kp-locked'],
        title: '未解锁内容',
      }),
    ],
  });

  assert.deepEqual(
    groups.map((group) => ({
      knowledgePointName: group.knowledgePointName,
      materialIds: group.materials.map((item) => item.id),
    })),
    [
      { knowledgePointName: '集合的含义', materialIds: ['m-a'] },
      { knowledgePointName: '集合间的关系', materialIds: ['m-b'] },
    ],
  );
});

test('places knowledge points from wrong attempts before review-only knowledge points', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [
      { id: 'q-1', isCorrect: true, primaryKpId: 'kp-a', kpIds: ['kp-a'] },
      { id: 'q-2', isCorrect: false, primaryKpId: 'kp-b', kpIds: ['kp-b'] },
    ],
    unlockedKpIds: ['kp-a', 'kp-b'],
    knowledgePoints: [
      { id: 'kp-a', name: '答对的知识点' },
      { id: 'kp-b', name: '需要巩固的知识点' },
    ],
    materials: [
      material({ id: 'm-a', primaryKpId: 'kp-a' }),
      material({ id: 'm-b', primaryKpId: 'kp-b' }),
    ],
  });

  assert.equal(groups[0]?.kpId, 'kp-b');
  assert.equal(groups[0]?.status, 'needs_work');
  assert.equal(groups[0]?.correctCount, 0);
  assert.equal(groups[0]?.totalCount, 1);
  assert.equal(groups[1]?.kpId, 'kp-a');
  assert.equal(groups[1]?.status, 'review');
});

test('maps material type values to student-facing Chinese labels', () => {
  assert.equal(getLearningMaterialLabel('common_mistake'), '易错提醒');
  assert.equal(getLearningMaterialLabel('method_card'), '解题方法');
  assert.equal(getLearningMaterialLabel('question_type_summary'), '题型总结');
  assert.equal(getLearningMaterialLabel('solution_summary'), '解析总结');
  assert.equal(getLearningMaterialLabel('concept_explanation'), '概念回顾');
  assert.equal(getLearningMaterialLabel('textbook_deep_dive'), '教材深挖');
  assert.equal(getLearningMaterialLabel('exam_trend'), '考情提示');
  assert.equal(getLearningMaterialLabel('study_advice'), '学习建议');
  assert.equal(getLearningMaterialLabel('unknown_type'), '学习材料');
});

test('limits each needs-work knowledge point to five prioritized materials', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [{ id: 'q-1', isCorrect: false, primaryKpId: 'kp-a', kpIds: ['kp-a'] }],
    unlockedKpIds: ['kp-a'],
    knowledgePoints: [{ id: 'kp-a', name: '函数单调性' }],
    materials: [
      material({ id: 'advice', primaryKpId: 'kp-a', materialType: 'study_advice' }),
      material({ id: 'trend', primaryKpId: 'kp-a', materialType: 'exam_trend' }),
      material({ id: 'deep', primaryKpId: 'kp-a', materialType: 'textbook_deep_dive' }),
      material({ id: 'concept', primaryKpId: 'kp-a', materialType: 'concept_explanation' }),
      material({ id: 'summary', primaryKpId: 'kp-a', materialType: 'solution_summary' }),
      material({ id: 'method', primaryKpId: 'kp-a', materialType: 'method_card' }),
      material({ id: 'mistake', primaryKpId: 'kp-a', materialType: 'common_mistake' }),
    ],
  });

  assert.deepEqual(
    groups[0]?.materials.map((item) => item.id),
    ['mistake', 'method', 'summary', 'concept', 'deep'],
  );
});

test('uses lighter review material ordering and limit for all-correct knowledge points', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [{ id: 'q-1', isCorrect: true, primaryKpId: 'kp-a', kpIds: ['kp-a'] }],
    unlockedKpIds: ['kp-a'],
    knowledgePoints: [{ id: 'kp-a', name: '等差数列' }],
    materials: [
      material({ id: 'mistake', primaryKpId: 'kp-a', materialType: 'common_mistake' }),
      material({ id: 'method', primaryKpId: 'kp-a', materialType: 'method_card' }),
      material({ id: 'type', primaryKpId: 'kp-a', materialType: 'question_type_summary' }),
      material({ id: 'concept', primaryKpId: 'kp-a', materialType: 'concept_explanation' }),
    ],
  });

  assert.equal(groups[0]?.status, 'review');
  assert.deepEqual(
    groups[0]?.materials.map((item) => item.id),
    ['concept', 'type', 'method'],
  );
});

test('returns an empty list when there are no related materials', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [{ id: 'q-1', isCorrect: true, primaryKpId: 'kp-a', kpIds: ['kp-a'] }],
    unlockedKpIds: ['kp-a'],
    knowledgePoints: [{ id: 'kp-a', name: '集合运算' }],
    materials: [],
  });

  assert.deepEqual(groups, []);
});

test('formats returned material text and never uses raw enum values as labels', () => {
  const groups = buildSessionResultKnowledgeGroups({
    questions: [{ id: 'q-1', isCorrect: false, primaryKpId: 'kp-a', kpIds: ['kp-a'] }],
    unlockedKpIds: ['kp-a'],
    knowledgePoints: [{ id: 'kp-a', name: '二次函数' }],
    materials: [
      material({
        id: 'm-1',
        primaryKpId: 'kp-a',
        materialType: 'common_mistake',
        title: '不要忽略定义域',
        content: '先看定义域，再讨论 $x^2$ 的变化。',
        studentSummary: '$x$ 的范围先确定。',
      }),
    ],
  });

  const item = groups[0]?.materials[0];
  assert.equal(item?.label, '易错提醒');
  assert.notEqual(item?.label, item?.materialType);
  assert.doesNotMatch(item?.label ?? '', /_/);
  assert.match(item?.content ?? '', /x/);
  assert.match(item?.studentSummary ?? '', /x/);
});

function material(overrides: {
  id: string;
  materialType?: string;
  title?: string;
  content?: string;
  studentSummary?: string | null;
  primaryKpId?: string | null;
  kpIds?: string[];
  createdAt?: Date;
}) {
  return {
    materialType: 'common_mistake',
    title: '学习材料',
    content: '这是一段复盘内容。',
    studentSummary: null,
    primaryKpId: 'kp-a',
    kpIds: ['kp-a'],
    createdAt: now,
    ...overrides,
  };
}
