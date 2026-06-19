import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertAdminKnowledgePointTextbookMapping } from './kp-textbook-mapping.ts';

test('upsertAdminKnowledgePointTextbookMapping forwards published KP context with source pages', async () => {
  const db = { tag: 'tx' };
  const calls: unknown[] = [];

  const result = await upsertAdminKnowledgePointTextbookMapping({
    db,
    upload: {
      id: 'upload-1',
      original_name: '必修一.pdf',
    },
    subject: {
      id: 'math_senior',
      name: '高中数学',
      stage: 'senior',
    },
    knowledgePoint: {
      id: 'kp-1',
      name: '函数的概念',
      subject_id: 'math_senior',
      chapter_no: '2.1',
    },
    reviewPayload: {
      name: '函数的概念',
      subject_id: 'math_senior',
      chapter_no: '2.1',
    },
    llmPayload: {
      name: '函数概念',
      chapter_title: '函数',
      source_pages: [12, 13],
      page_number: 12,
    },
    async upsertMapping(callDb, input) {
      calls.push({ db: callDb, input });
      return { textbookId: 'textbook-1', chapterCount: 1, mappingCount: 1 };
    },
  });

  assert.deepEqual(result, { textbookId: 'textbook-1', chapterCount: 1, mappingCount: 1 });
  assert.deepEqual(calls, [
    {
      db,
      input: {
        upload: {
          id: 'upload-1',
          original_name: '必修一.pdf',
        },
        subject: {
          id: 'math_senior',
          name: '高中数学',
          stage: 'senior',
        },
        knowledgePoint: {
          id: 'kp-1',
          name: '函数的概念',
          subject_id: 'math_senior',
          chapter_no: '2.1',
        },
        payload: {
          name: '函数的概念',
          chapter_title: '函数',
          source_pages: [12, 13],
          page_number: 12,
          subject_id: 'math_senior',
          chapter_no: '2.1',
        },
      },
    },
  ]);
});
