import assert from 'node:assert/strict';
import test from 'node:test';
import {
  difficultyLabel,
  mapQuestionBankForPlanner,
  poolLabel,
  questionTypeLabel,
  toPlannerSlotView,
} from './planner-adapter.ts';

test('maps only choice and fill-in questions within the allowed KP boundary', () => {
  const questions = mapQuestionBankForPlanner(
    [
      {
        id: 'q-choice',
        primary_kp_id: 'kp-1',
        kp_ids: ['kp-1', 'kp-2'],
        difficulty: 2,
        question_type: 'choice',
      },
      {
        id: 'q-locked',
        primary_kp_id: 'kp-1',
        kp_ids: ['kp-1', 'kp-locked'],
        difficulty: 2,
        question_type: 'choice',
      },
      {
        id: 'q-other-type',
        primary_kp_id: 'kp-1',
        kp_ids: ['kp-1'],
        difficulty: 2,
        question_type: 'essay',
      },
    ],
    ['kp-1', 'kp-2'],
  );

  assert.deepEqual(questions, [
    {
      id: 'q-choice',
      primaryKpId: 'kp-1',
      kpIds: ['kp-1', 'kp-2'],
      difficulty: 2,
      questionType: 'choice',
    },
  ]);
});

test('renders question bank and AI slots with planner pool labels', () => {
  assert.equal(poolLabel('spaced_review'), '复习回顾');
  assert.equal(poolLabel('feynman_check'), '表达检查');
  assert.equal(questionTypeLabel('fill_in'), '填空题');
  assert.equal(difficultyLabel(3), '中等');

  const bankSlot = toPlannerSlotView(
    {
      slotId: 'slot-1',
      pool: 'new_knowledge',
      kpId: 'kp-1',
      targetExam: '高考 2027',
      reason: 'low_mastery_or_unseen',
      secondaryReasons: ['spaced_review'],
      source: 'question_bank',
      questionId: 'q-1',
    },
    new Map([
      [
        'q-1',
        {
          id: 'q-1',
          content: '函数题',
          answer: 'A',
          solution_text: '代入即可',
          difficulty: 2,
          question_type: 'choice',
          primary_kp_id: 'kp-1',
          kp_ids: ['kp-1'],
        },
      ],
    ]),
    new Map([['kp-1', { name: '集合的含义', chapterNo: '第一章' }]]),
  );

  assert.equal(bankSlot.sourceLabel, '可直接练习');
  assert.equal(bankSlot.kpTitle, '集合的含义');
  assert.equal(bankSlot.kpSubtitle, '第一章');
  assert.equal(bankSlot.question?.content, '函数题');
  assert.equal(bankSlot.question?.questionTypeLabel, '选择题');
  assert.equal(bankSlot.question?.difficultyLabel, '基础');
  assert.deepEqual(bankSlot.secondaryReasonLabels, ['复习回顾']);

  const feynmanSlot = toPlannerSlotView(
    {
      slotId: 'slot-2',
      pool: 'feynman_check',
      kpId: 'kp-2',
      targetExam: '高考 2027',
      reason: 'mastery_needs_expression_check',
      secondaryReasons: [],
      source: 'ai_generated',
      activityType: 'feynman_prompt',
      fallback: 'drop_slot',
    },
    new Map(),
    new Map([['kp-2', { name: '函数单调性', chapterNo: null }]]),
  );

  assert.equal(feynmanSlot.sourceLabel, '表达练习');
  assert.equal(feynmanSlot.kpTitle, '函数单调性');
  assert.equal(feynmanSlot.aiPlaceholder?.activityType, 'feynman_prompt');

  const directionSlot = toPlannerSlotView(
    {
      slotId: 'slot-3',
      pool: 'new_knowledge',
      kpId: 'kp-3',
      targetExam: '高考 2027',
      reason: 'low_mastery_or_unseen',
      secondaryReasons: [],
      source: 'ai_generated',
      difficultyRange: [1, 2],
      questionType: 'choice',
      fallback: 'drop_slot',
    },
    new Map(),
    new Map([['kp-3', { name: '集合表示法', chapterNo: null }]]),
  );

  assert.equal(directionSlot.sourceLabel, '练习方向');
  assert.equal(directionSlot.aiPlaceholder?.difficultyLabel, '基础');
});
