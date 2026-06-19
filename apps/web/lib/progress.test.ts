import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLearningProgress,
  filterProgressItems,
  groupProgressItemsByChapter,
  progressStatusLabel,
  resolveActiveTextbook,
  sortProgressItems,
  textbookOptionLabel,
} from './progress.ts';

const baseKnowledgePoints = [
  { id: 'kp-a', name: '集合的概念', chapter_no: '1.1' },
  { id: 'kp-b', name: '函数的单调性', chapter_no: '2.1' },
  { id: 'kp-c', name: '指数函数', chapter_no: '3.1' },
  { id: 'kp-d', name: '空间向量', chapter_no: '4.1' },
  { id: 'kp-e', name: '概率初步', chapter_no: '5.1' },
];

test('builds student-facing progress statuses and summary counts', () => {
  const progress = buildLearningProgress({
    knowledgePoints: baseKnowledgePoints,
    masteryRows: [
      { kp_id: 'kp-a', mastery_score: 0.9, peak_mastery_score: 0.9 },
      { kp_id: 'kp-b', mastery_score: 0.62, peak_mastery_score: 0.7 },
      { kp_id: 'kp-c', mastery_score: 0.3, peak_mastery_score: 0.4 },
      { kp_id: 'kp-d', mastery_score: 0.1, peak_mastery_score: 0.6 },
    ],
    attemptRows: [
      { kp_id: 'kp-a', answered_at: new Date('2026-06-01T08:00:00Z') },
      { kp_id: 'kp-c', answered_at: new Date('2026-06-02T08:00:00Z') },
      { kp_id: 'kp-c', answered_at: new Date('2026-06-03T08:00:00Z') },
    ],
    openMistakeRows: [{ kp_id: 'kp-b' }],
    dueReviewRows: [{ kp_id: 'kp-c', next_review_at: new Date('2026-06-10T08:00:00Z') }],
  });

  assert.deepEqual(progress.summary, {
    unlockedCount: 5,
    startedCount: 4,
    masteredCount: 1,
    needsWorkCount: 3,
  });
  assert.deepEqual(
    progress.items.map((item) => [
      item.name,
      progressStatusLabel(item.status),
      item.progressPercent,
    ]),
    [
      ['集合的概念', '已掌握', 90],
      ['函数的单调性', '学习中', 62],
      ['指数函数', '需要加强', 30],
      ['空间向量', '曾掌握后回落', 10],
      ['概率初步', '未开始', 0],
    ],
  );
});

test('filters regressed and open-mistake knowledge points into needs-work view', () => {
  const progress = buildLearningProgress({
    knowledgePoints: baseKnowledgePoints.slice(0, 4),
    masteryRows: [
      { kp_id: 'kp-a', mastery_score: 0.9, peak_mastery_score: 0.9 },
      { kp_id: 'kp-b', mastery_score: 0.62, peak_mastery_score: 0.7 },
      { kp_id: 'kp-c', mastery_score: 0.3, peak_mastery_score: 0.4 },
      { kp_id: 'kp-d', mastery_score: 0.1, peak_mastery_score: 0.6 },
    ],
    attemptRows: [],
    openMistakeRows: [{ kp_id: 'kp-b' }],
    dueReviewRows: [],
  });

  assert.deepEqual(
    filterProgressItems(progress.items, 'needs_work').map((item) => item.id),
    ['kp-b', 'kp-c', 'kp-d'],
  );
});

test('sorts urgent progress items before comfortable ones without exposing internal ids', () => {
  const progress = buildLearningProgress({
    knowledgePoints: baseKnowledgePoints,
    masteryRows: [
      { kp_id: 'kp-a', mastery_score: 0.9, peak_mastery_score: 0.9 },
      { kp_id: 'kp-b', mastery_score: 0.62, peak_mastery_score: 0.7 },
      { kp_id: 'kp-c', mastery_score: 0.3, peak_mastery_score: 0.4 },
      { kp_id: 'kp-d', mastery_score: 0.1, peak_mastery_score: 0.6 },
    ],
    attemptRows: [],
    openMistakeRows: [{ kp_id: 'kp-b' }],
    dueReviewRows: [{ kp_id: 'kp-a', next_review_at: new Date('2026-06-10T08:00:00Z') }],
  });

  assert.deepEqual(
    sortProgressItems(progress.items).map((item) => item.name),
    ['空间向量', '指数函数', '集合的概念', '函数的单调性', '概率初步'],
  );
});

test('defaults textbook selection to the first available textbook', () => {
  const textbooks = [
    {
      id: 'textbook-a',
      title: '高中数学默认教材',
      publisher: null,
      edition: null,
      volume: null,
    },
    {
      id: 'textbook-b',
      title: '高中数学选择性必修',
      publisher: '人民教育出版社',
      edition: null,
      volume: '第一册',
    },
  ];

  assert.deepEqual(resolveActiveTextbook(textbooks, undefined), {
    textbook: textbooks[0],
    index: 0,
  });
  assert.deepEqual(resolveActiveTextbook(textbooks, '1'), {
    textbook: textbooks[1],
    index: 1,
  });
  assert.deepEqual(resolveActiveTextbook(textbooks, '99'), {
    textbook: textbooks[0],
    index: 0,
  });
  assert.equal(resolveActiveTextbook([], '0'), null);
});

test('builds student-facing textbook labels without internal identifiers', () => {
  assert.equal(
    textbookOptionLabel({
      id: 'textbook-b',
      title: '高中数学选择性必修',
      publisher: '人民教育出版社',
      edition: null,
      volume: '第一册',
    }),
    '高中数学选择性必修 · 第一册 · 人民教育出版社',
  );
});

test('groups progress items by chapter and section for collapsible progress view', () => {
  const progress = buildLearningProgress({
    knowledgePoints: [
      { id: 'kp-a', name: 'Z 需要加强知识点', chapter_no: '1.1' },
      { id: 'kp-b', name: '子集与真子集', chapter_no: '1.2' },
      { id: 'kp-c', name: '函数的单调性', chapter_no: '2.1' },
      { id: 'kp-d', name: 'A 未开始知识点', chapter_no: '1.1' },
    ],
    masteryRows: [
      { kp_id: 'kp-a', mastery_score: 0.2, peak_mastery_score: 0.3 },
      { kp_id: 'kp-c', mastery_score: 0.9, peak_mastery_score: 0.9 },
    ],
    attemptRows: [],
    openMistakeRows: [{ kp_id: 'kp-b' }],
    dueReviewRows: [],
  });

  const groups = groupProgressItemsByChapter(progress.items);

  assert.deepEqual(
    groups.map((group) => ({
      label: group.label,
      itemCount: group.itemCount,
      needsWorkCount: group.needsWorkCount,
      defaultOpen: group.defaultOpen,
      sections: group.sections.map((section) => ({
        label: section.label,
        itemCount: section.itemCount,
        defaultOpen: section.defaultOpen,
        names: section.items.map((item) => item.name),
      })),
    })),
    [
      {
        label: '第 1 章',
        itemCount: 3,
        needsWorkCount: 2,
        defaultOpen: true,
        sections: [
          {
            label: '1.1',
            itemCount: 2,
            defaultOpen: true,
            names: ['Z 需要加强知识点', 'A 未开始知识点'],
          },
          {
            label: '1.2',
            itemCount: 1,
            defaultOpen: true,
            names: ['子集与真子集'],
          },
        ],
      },
      {
        label: '第 2 章',
        itemCount: 1,
        needsWorkCount: 0,
        defaultOpen: false,
        sections: [
          {
            label: '2.1',
            itemCount: 1,
            defaultOpen: false,
            names: ['函数的单调性'],
          },
        ],
      },
    ],
  );
});
