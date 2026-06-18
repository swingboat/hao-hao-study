import assert from 'node:assert/strict';

import {
  DEFAULT_MATH_SENIOR_TEXTBOOK,
  type TextbookScopeDb,
  buildPublishedTextbookKnowledgePointInputs,
  buildTextbookScopePlan,
  getTextbooksForStudentScope,
  sourcePagesFromKnowledgePointPayload,
  textbookInputFromUpload,
} from './textbook-scope';

const plan = buildTextbookScopePlan({
  textbookId: DEFAULT_MATH_SENIOR_TEXTBOOK.id,
  knowledgePoints: [
    { id: 'kp-3', name: '未分章知识点', subject_id: 'math_senior', chapter_no: null },
    { id: 'kp-2', name: '函数概念', subject_id: 'math_senior', chapter_no: '2.1' },
    { id: 'kp-1', name: '集合含义', subject_id: 'math_senior', chapter_no: '1.1' },
    { id: 'kp-4', name: '集合表示', subject_id: 'math_senior', chapter_no: '1.1' },
    { id: 'kp-5', name: '数列拓展', subject_id: 'math_senior', chapter_no: '第四章' },
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
    { chapter_no: '4', title: '4', sort_order: 3 },
    { chapter_no: '未分章节', title: '未分章节', sort_order: 4 },
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
    { kp_id: 'kp-5', chapter_no: '4', sort_order: 4 },
    { kp_id: 'kp-3', chapter_no: '未分章节', sort_order: 5 },
  ],
);

assert.deepEqual(
  sourcePagesFromKnowledgePointPayload({
    source_pages: [3, '2', 2, 0, -1, Number.NaN, 3],
  }),
  [2, 3],
);

assert.deepEqual(
  textbookInputFromUpload({
    upload: { id: 'upload-1', original_name: '高中数学 选择性必修第二册.pdf' },
    subject: { id: 'math_senior', name: '高中数学', stage: 'senior' },
  }),
  {
    subject_id: 'math_senior',
    stage: 'senior',
    title: '高中数学 选择性必修第二册',
    edition: null,
    publisher: null,
    volume: '选择性必修 第二册',
    source_upload_id: 'upload-1',
  },
);

assert.deepEqual(
  buildPublishedTextbookKnowledgePointInputs({
    stagings: [
      {
        id: 'staging-1',
        published_id: 'kp-1',
        llm_payload: {
          chapter_no: '1.1',
          chapter_title: '集合',
          source_pages: [2, '3', 3],
        },
        review_payload: null,
      },
      {
        id: 'staging-2',
        published_id: 'missing-kp',
        llm_payload: { chapter_no: '1.2' },
        review_payload: null,
      },
      {
        id: 'staging-3',
        published_id: 'kp-2',
        llm_payload: { chapter_no: '2.1' },
        review_payload: {
          chapter_no: '2.2',
          chapter_title: '函数',
          source_page: 8,
        },
      },
      {
        id: 'staging-4',
        published_id: 'kp-3',
        llm_payload: {
          chapter_no: '第五章',
          source_pages: [12],
        },
        review_payload: {
          chapter_no: '第四章',
          subject_id: 'math_senior',
        },
      },
    ],
    knowledgePointById: new Map([
      ['kp-1', { id: 'kp-1', name: '集合含义', subject_id: 'math_senior', chapter_no: '1.0' }],
      ['kp-2', { id: 'kp-2', name: '函数概念', subject_id: 'math_senior', chapter_no: '2.0' }],
      ['kp-3', { id: 'kp-3', name: '数列拓展', subject_id: 'math_senior', chapter_no: null }],
    ]),
  }),
  [
    {
      id: 'kp-1',
      name: '集合含义',
      subject_id: 'math_senior',
      chapter_no: '1.1',
      chapter_title: '集合',
      source_pages: [2, 3],
    },
    {
      id: 'kp-2',
      name: '函数概念',
      subject_id: 'math_senior',
      chapter_no: '2.2',
      chapter_title: '函数',
      source_pages: [8],
    },
    {
      id: 'kp-3',
      name: '数列拓展',
      subject_id: 'math_senior',
      chapter_no: '4',
      chapter_title: null,
      source_pages: [],
    },
  ],
);

const realTextbookQueries: unknown[] = [];
const realTextbooks = [{ id: 'real-textbook', title: '高中数学 必修第一册' }];
const realOnlyDb = {
  textbook: {
    findMany: async (args: unknown) => {
      realTextbookQueries.push(args);
      return realTextbooks;
    },
  },
} as unknown as TextbookScopeDb;

assert.deepEqual(
  await getTextbooksForStudentScope(realOnlyDb, {
    primary_subject_id: 'math_senior',
    stage: 'senior',
    unlocked_kp_ids: ['kp-1'],
  }),
  realTextbooks,
);
assert.equal(realTextbookQueries.length, 1);
assert.deepEqual(
  (realTextbookQueries[0] as { where: { source_upload_id: unknown } }).where.source_upload_id,
  { not: null },
);

let fallbackQueryCount = 0;
const fallbackTextbooks = [{ id: DEFAULT_MATH_SENIOR_TEXTBOOK.id, title: '高中数学默认教材' }];
const fallbackDb = {
  textbook: {
    findMany: async () => {
      fallbackQueryCount += 1;
      return fallbackQueryCount === 1 ? [] : fallbackTextbooks;
    },
  },
} as unknown as TextbookScopeDb;

assert.deepEqual(
  await getTextbooksForStudentScope(fallbackDb, {
    primary_subject_id: 'math_senior',
    stage: 'senior',
    unlocked_kp_ids: ['kp-1'],
  }),
  fallbackTextbooks,
);
assert.equal(fallbackQueryCount, 2);
