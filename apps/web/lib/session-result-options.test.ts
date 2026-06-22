import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionResultChoiceOptions } from './session-result-options.ts';

test('builds result-page choice options with student and correct answer markers', () => {
  const options = buildSessionResultChoiceOptions({
    questionType: 'choice',
    options: [
      { label: 'A', text: '选项一' },
      { label: 'B', text: '选项二' },
      { label: 'C', text: '选项三' },
      { label: 'D', text: '选项四' },
    ],
    studentAnswer: ' c ',
    correctAnswer: 'D',
  });

  assert.deepEqual(
    options.map((option) => ({
      label: option.label,
      isStudentAnswer: option.isStudentAnswer,
      isCorrectAnswer: option.isCorrectAnswer,
    })),
    [
      { label: 'A', isStudentAnswer: false, isCorrectAnswer: false },
      { label: 'B', isStudentAnswer: false, isCorrectAnswer: false },
      { label: 'C', isStudentAnswer: true, isCorrectAnswer: false },
      { label: 'D', isStudentAnswer: false, isCorrectAnswer: true },
    ],
  );
});

test('keeps multi-select choice markers normalized for result display', () => {
  const options = buildSessionResultChoiceOptions({
    questionType: 'choice',
    options: [
      { label: 'A', text: '选项一' },
      { label: 'B', text: '选项二' },
      { label: 'C', text: '选项三' },
    ],
    studentAnswer: 'b、a',
    correctAnswer: 'AB',
  });

  assert.deepEqual(
    options
      .filter((option) => option.isStudentAnswer || option.isCorrectAnswer)
      .map((option) => [option.label, option.isStudentAnswer, option.isCorrectAnswer]),
    [
      ['A', true, true],
      ['B', true, true],
    ],
  );
});

test('does not build option rows for non-choice result questions', () => {
  assert.deepEqual(
    buildSessionResultChoiceOptions({
      questionType: 'fill_in',
      options: [{ label: 'A', text: '选项一' }],
      studentAnswer: 'A',
      correctAnswer: 'A',
    }),
    [],
  );
});
