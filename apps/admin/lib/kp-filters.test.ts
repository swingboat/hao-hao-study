import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTextbookFilter } from './kp-filters.ts';

const groups = [
  {
    canonicalId: 'senior-book',
    originalName: '高中数学.pdf',
    createdAt: new Date('2026-06-11T00:00:00.000Z'),
    subjectId: 'math_senior',
    uploadIds: ['senior-book', 'senior-book-old'],
  },
  {
    canonicalId: 'junior-book',
    originalName: '初中数学.pdf',
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    subjectId: 'math_junior',
    uploadIds: ['junior-book'],
  },
];

test('resolveTextbookFilter hides textbook options until a subject is selected', () => {
  const result = resolveTextbookFilter('', '', groups);

  assert.deepEqual(result.textbooks, []);
  assert.equal(result.currentGroup, undefined);
});

test('resolveTextbookFilter only resolves textbooks inside the selected subject', () => {
  const result = resolveTextbookFilter('math_senior', 'junior-book', groups);

  assert.deepEqual(
    result.textbooks.map((group) => group.canonicalId),
    ['senior-book'],
  );
  assert.equal(result.currentGroup, undefined);
});

test('resolveTextbookFilter accepts upload ids from the selected textbook group', () => {
  const result = resolveTextbookFilter('math_senior', 'senior-book-old', groups);

  assert.equal(result.currentGroup?.canonicalId, 'senior-book');
});
