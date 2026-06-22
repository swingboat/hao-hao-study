import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionResultKnowledgeGroups,
  buildSessionResultReviewPlan,
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

test('builds an action-oriented review plan from weak knowledge points', () => {
  const plan = buildSessionResultReviewPlan({
    correctCount: 2,
    totalCount: 6,
    groups: [
      {
        kpId: 'kp-a',
        knowledgePointName: '充分条件与必要条件',
        status: 'needs_work',
        correctCount: 1,
        totalCount: 2,
        materials: [
          materialView({ id: 'm-1', label: '易错提醒', title: '方向别看反' }),
          materialView({ id: 'm-2', label: '解题方法', title: '从集合角度判断' }),
        ],
      },
      {
        kpId: 'kp-b',
        knowledgePointName: '集合关系',
        status: 'review',
        correctCount: 1,
        totalCount: 1,
        materials: [materialView({ id: 'm-3', label: '概念回顾', title: '子集关系' })],
      },
    ],
  });

  assert.equal(plan?.headline, '先把“充分条件与必要条件”补牢');
  assert.match(plan?.summary ?? '', /答对 2 \/ 6/);
  assert.match(plan?.summary ?? '', /易错提醒和解题方法/);
  assert.deepEqual(
    plan?.focusItems.map((item) => ({
      knowledgePointName: item.knowledgePointName,
      priorityLabel: item.priorityLabel,
      scoreText: item.scoreText,
      recommendedLabels: item.recommendedLabels,
    })),
    [
      {
        knowledgePointName: '充分条件与必要条件',
        priorityLabel: '优先巩固',
        scoreText: '本次 1 / 2',
        recommendedLabels: ['易错提醒', '解题方法'],
      },
      {
        knowledgePointName: '集合关系',
        priorityLabel: '顺手复习',
        scoreText: '本次 1 / 1',
        recommendedLabels: ['概念回顾'],
      },
    ],
  );
});

test('builds a lighter review plan when the related knowledge points are all correct', () => {
  const plan = buildSessionResultReviewPlan({
    correctCount: 3,
    totalCount: 3,
    groups: [
      {
        kpId: 'kp-a',
        knowledgePointName: '等差数列',
        status: 'review',
        correctCount: 2,
        totalCount: 2,
        materials: [
          materialView({ id: 'm-1', label: '概念回顾', title: '通项公式' }),
          materialView({ id: 'm-2', label: '题型总结', title: '求和题型' }),
        ],
      },
    ],
  });

  assert.equal(plan?.headline, '这次整体不错，顺手复习“等差数列”');
  assert.match(plan?.summary ?? '', /答对 3 \/ 3/);
  assert.match(plan?.focusItems[0]?.suggestion ?? '', /固定下来/);
  assert.doesNotMatch(plan?.focusItems[0]?.priorityLabel ?? '', /review|needs_work|_/);
});

test('omits review plan when there are no related knowledge groups', () => {
  assert.equal(
    buildSessionResultReviewPlan({
      correctCount: 0,
      totalCount: 0,
      groups: [],
    }),
    null,
  );
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

function materialView(overrides: {
  id: string;
  label: string;
  title: string;
  materialType?: string;
  content?: string;
  studentSummary?: string | null;
}) {
  return {
    materialType: 'common_mistake',
    content: '这是一段复盘内容。',
    studentSummary: null,
    ...overrides,
  };
}
