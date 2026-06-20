import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTodayTaskSummary } from './today-task-summary.ts';

const forbiddenVisibleTerms = [
  'pool',
  'new_knowledge',
  'mistake_variant',
  'spaced_review',
  'fallback',
  'provider',
  'job',
  'kp_id',
  'question_id',
];

test('summarizes today task with mistake review reasons in student language', () => {
  const summary = buildTodayTaskSummary({
    slots: [
      { kpTitle: '集合的含义', kpSubtitle: '第一章', poolLabel: '错题巩固' },
      { kpTitle: '函数单调性', kpSubtitle: '第二章', poolLabel: '基础巩固' },
    ],
    readyQuestionCount: 2,
    targetQuestionCount: 8,
    canStart: true,
  });

  assert.equal(summary.knowledgePointSummary, '集合的含义、函数单调性');
  assert.deepEqual(summary.chapterLabels, ['第一章', '第二章']);
  assert.ok(summary.reasons.includes('回炉最近错题'));
  assert.equal(summary.estimatedMinutes, 25);
  assert.ok(summary.afterCompletion.some((text) => text.includes('错题')));

  const visibleText = JSON.stringify(summary);
  for (const term of forbiddenVisibleTerms) {
    assert.equal(visibleText.includes(term), false, `${term} should not be visible`);
  }
});

test('summarizes due review and new-practice tasks with distinct reasons', () => {
  assert.deepEqual(
    buildTodayTaskSummary({
      slots: [{ kpTitle: '指数函数', kpSubtitle: '第三章', poolLabel: '复习回顾' }],
      readyQuestionCount: 1,
      targetQuestionCount: 8,
      canStart: true,
    }).reasons,
    ['安排到期复习'],
  );

  assert.deepEqual(
    buildTodayTaskSummary({
      slots: [{ kpTitle: '空间向量', kpSubtitle: '第四章', poolLabel: '基础巩固' }],
      readyQuestionCount: 1,
      targetQuestionCount: 8,
      canStart: true,
    }).reasons,
    ['巩固新学内容'],
  );
});

test('keeps no-content summary positive without exposing inventory shortage', () => {
  const summary = buildTodayTaskSummary({
    slots: [],
    readyQuestionCount: 0,
    targetQuestionCount: 8,
    canStart: false,
  });

  assert.equal(summary.knowledgePointSummary, '今天先保持复习节奏');
  assert.equal(
    summary.positiveEmptyState,
    '今天先整理已学内容，系统会继续为你安排合适的巩固练习。',
  );
  assert.equal(JSON.stringify(summary).includes('题库不足'), false);
});
