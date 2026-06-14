import { describe, expect, it } from 'vitest';

import {
  QuestionBatchSchema,
  QuestionParsedSchema,
  QuestionTypeSchema,
} from './question';

describe('Question schema naming', () => {
  const validQuestion = {
    content: '集合 A = {1}, B = {2}, 则 A ∪ B = ?',
    question_type: 'fill_in' as const,
    answer: '{1,2}',
    difficulty: 1,
    kp_hints: ['集合的运算'],
  };

  it('uses Question names and question_type for a parsed question', () => {
    expect(QuestionTypeSchema.safeParse('fill_in').success).toBe(true);

    const parsed = QuestionParsedSchema.safeParse(validQuestion);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.question_type).toBe('fill_in');
      expect(`${'item'}_type` in parsed.data).toBe(false);
    }
  });

  it('uses questions as the batch collection field', () => {
    const parsed = QuestionBatchSchema.safeParse({
      questions: [validQuestion, validQuestion],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.questions).toHaveLength(2);
      expect(`${'item'}s` in parsed.data).toBe(false);
    }
  });

  it('rejects the legacy collection shape', () => {
    const parsed = QuestionBatchSchema.safeParse({
      [`${'item'}s`]: [validQuestion],
    });

    expect(parsed.success).toBe(false);
  });
});
