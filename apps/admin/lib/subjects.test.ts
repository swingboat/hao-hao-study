import assert from 'node:assert/strict';
import test from 'node:test';
import { sortSubjectsByStage } from './subjects.ts';

test('sortSubjectsByStage orders primary before junior before senior', () => {
  const subjects = [
    { id: 'math_senior', name: '高中数学', stage: 'senior' },
    { id: 'math_primary', name: '小学数学', stage: 'primary' },
    { id: 'math_junior', name: '初中数学', stage: 'junior' },
  ];

  assert.deepEqual(
    sortSubjectsByStage(subjects).map((subject) => subject.id),
    ['math_primary', 'math_junior', 'math_senior'],
  );
  assert.deepEqual(
    subjects.map((subject) => subject.id),
    ['math_senior', 'math_primary', 'math_junior'],
  );
});
