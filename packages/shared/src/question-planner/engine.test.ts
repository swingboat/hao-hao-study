import { describe, expect, it } from 'vitest';

import { type QuestionPlannerInput, planLearningSession } from './engine';

const STUDENT = {
  id: 'student-1',
  primarySubjectId: 'math_senior',
  targetExam: '高考 2027',
  unlockedKpIds: ['kp-1', 'kp-2', 'kp-3', 'kp-4', 'kp-5', 'kp-6', 'kp-7', 'kp-8'],
};

function baseInput(overrides: Partial<QuestionPlannerInput> = {}): QuestionPlannerInput {
  const knowledgePoints = STUDENT.unlockedKpIds.map((id, index) => ({
    id,
    subjectId: 'math_senior',
    chapterNo: index < 4 ? '2.1' : '2.2',
  }));

  return {
    student: STUDENT,
    count: 8,
    knowledgePoints,
    mastery: [],
    openMistakes: [],
    dueReviews: [],
    questionBank: knowledgePoints.map((kp, index) => ({
      id: `q-${index + 1}`,
      primaryKpId: kp.id,
      kpIds: [kp.id],
      difficulty: index < 4 ? 2 : 1,
      questionType: index % 2 === 0 ? 'choice' : 'fill_in',
    })),
    ...overrides,
  };
}

describe('planLearningSession', () => {
  it('allocates daily mixed slots with progress, mistakes, and spaced review budgets', () => {
    const result = planLearningSession(
      baseInput({
        dueReviews: [
          { kpId: 'kp-1', nextReviewAt: '2026-06-14T00:00:00.000Z' },
          { kpId: 'kp-2', nextReviewAt: '2026-06-15T00:00:00.000Z' },
        ],
        openMistakes: [
          { questionId: 'q-3', kpId: 'kp-3', errorCount: 3 },
          { questionId: 'q-4', kpId: 'kp-4', errorCount: 1 },
        ],
        now: '2026-06-16T00:00:00.000Z',
      }),
    );

    expect(result.slots).toHaveLength(8);
    expect(result.slots.map((slot) => slot.pool)).toEqual([
      'spaced_review',
      'spaced_review',
      'mistake_variant',
      'mistake_variant',
      'new_knowledge',
      'new_knowledge',
      'new_knowledge',
      'new_knowledge',
    ]);
    expect(result.slots.every((slot) => slot.source === 'question_bank')).toBe(true);
    expect(new Set(result.slots.map((slot) => slot.kpId)).size).toBe(8);
  });

  it('deduplicates a KP by keeping the highest-priority pool', () => {
    const result = planLearningSession(
      baseInput({
        count: 4,
        dueReviews: [{ kpId: 'kp-1', nextReviewAt: '2026-06-15T00:00:00.000Z' }],
        openMistakes: [{ questionId: 'q-1', kpId: 'kp-1', errorCount: 5 }],
        now: '2026-06-16T00:00:00.000Z',
      }),
    );

    const kpOneSlots = result.slots.filter((slot) => slot.kpId === 'kp-1');
    expect(kpOneSlots).toHaveLength(1);
    expect(kpOneSlots[0]?.pool).toBe('spaced_review');
    expect(kpOneSlots[0]?.secondaryReasons).toEqual(['mistake_variant', 'new_knowledge']);
  });

  it('keeps the highest-priority pool even when mode budgets prefer another pool', () => {
    const result = planLearningSession(
      baseInput({
        mode: 'mistake_focus',
        count: 1,
        dueReviews: [{ kpId: 'kp-1', nextReviewAt: '2026-06-15T00:00:00.000Z' }],
        openMistakes: [{ questionId: 'q-1', kpId: 'kp-1', errorCount: 5 }],
        now: '2026-06-16T00:00:00.000Z',
      }),
    );

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.pool).toBe('spaced_review');
    expect(result.slots[0]?.secondaryReasons).toEqual(['mistake_variant', 'new_knowledge']);
  });

  it('never plans slots outside the student unlocked KP boundary', () => {
    const result = planLearningSession(
      baseInput({
        student: {
          ...STUDENT,
          unlockedKpIds: ['kp-1'],
        },
        kpIds: ['kp-1', 'locked-kp'],
        knowledgePoints: [
          { id: 'kp-1', subjectId: 'math_senior', chapterNo: '2.1' },
          { id: 'locked-kp', subjectId: 'math_senior', chapterNo: '2.1' },
        ],
        questionBank: [
          {
            id: 'q-1',
            primaryKpId: 'kp-1',
            kpIds: ['kp-1'],
            difficulty: 1,
            questionType: 'choice',
          },
          {
            id: 'q-locked',
            primaryKpId: 'locked-kp',
            kpIds: ['locked-kp'],
            difficulty: 1,
            questionType: 'choice',
          },
        ],
      }),
    );

    expect(result.slots.map((slot) => slot.kpId)).toEqual(['kp-1']);
  });

  it('marks a slot as AI generated when the question bank has no matching question', () => {
    const result = planLearningSession(
      baseInput({
        count: 1,
        knowledgePoints: [{ id: 'kp-1', subjectId: 'math_senior', chapterNo: '2.1' }],
        questionBank: [],
      }),
    );

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toMatchObject({
      source: 'ai_generated',
      pool: 'new_knowledge',
      kpId: 'kp-1',
      difficultyRange: [1, 2],
      fallback: 'retry_then_question_bank',
    });
  });

  it('limits feynman check fallback slots to one per session', () => {
    const result = planLearningSession(
      baseInput({
        count: 4,
        knowledgePoints: ['kp-1', 'kp-2', 'kp-3', 'kp-4'].map((id) => ({
          id,
          subjectId: 'math_senior',
          chapterNo: '2.1',
        })),
        mastery: ['kp-1', 'kp-2', 'kp-3', 'kp-4'].map((kpId) => ({
          kpId,
          masteryScore: 0.7,
        })),
        openMistakes: [],
        dueReviews: [],
        questionBank: [],
      }),
    );

    expect(result.slots.filter((slot) => slot.pool === 'feynman_check')).toHaveLength(1);
  });
});
