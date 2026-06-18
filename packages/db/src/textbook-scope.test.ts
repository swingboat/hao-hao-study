import assert from 'node:assert/strict';

import {
  DEFAULT_MATH_SENIOR_TEXTBOOK,
  buildTextbookScopePlan,
  sourcePagesFromKnowledgePointPayload,
} from './textbook-scope';

const plan = buildTextbookScopePlan({
  textbookId: DEFAULT_MATH_SENIOR_TEXTBOOK.id,
  knowledgePoints: [
    { id: 'kp-3', name: '未分章知识点', subject_id: 'math_senior', chapter_no: null },
    { id: 'kp-2', name: '函数概念', subject_id: 'math_senior', chapter_no: '2.1' },
    { id: 'kp-1', name: '集合含义', subject_id: 'math_senior', chapter_no: '1.1' },
    { id: 'kp-4', name: '集合表示', subject_id: 'math_senior', chapter_no: '1.1' },
  ],
});

assert.deepEqual(
  plan.chapters.map((chapter) => ({
    chapter_no: chapter.chapter_no,
    title: chapter.title,
    sort_order: chapter.sort_order,
  })),
  [
    { chapter_no: '1.1', title: '1.1', sort_order: 1 },
    { chapter_no: '2.1', title: '2.1', sort_order: 2 },
    { chapter_no: '未分章节', title: '未分章节', sort_order: 3 },
  ],
);

assert.deepEqual(
  plan.mappings.map((mapping) => ({
    kp_id: mapping.kp_id,
    chapter_no: mapping.chapter_no,
    sort_order: mapping.sort_order,
  })),
  [
    { kp_id: 'kp-1', chapter_no: '1.1', sort_order: 1 },
    { kp_id: 'kp-4', chapter_no: '1.1', sort_order: 2 },
    { kp_id: 'kp-2', chapter_no: '2.1', sort_order: 3 },
    { kp_id: 'kp-3', chapter_no: '未分章节', sort_order: 4 },
  ],
);

assert.deepEqual(
  sourcePagesFromKnowledgePointPayload({
    source_pages: [3, '2', 2, 0, -1, Number.NaN, 3],
  }),
  [2, 3],
);
