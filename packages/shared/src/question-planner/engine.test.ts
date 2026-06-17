import { describe, expect, it } from 'vitest';

import {
  type LearningSlot,
  type QuestionPlannerInput,
  planLearningSession,
  toQuestionBankSessionPlan,
} from './engine';

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

  it('builds a DB-ready question bank session plan from planner slots', () => {
    const slots: LearningSlot[] = [
      {
        slotId: 'slot-1',
        source: 'question_bank',
        pool: 'spaced_review',
        kpId: 'kp-1',
        targetExam: '高考 2027',
        reason: 'spaced_review_due',
        secondaryReasons: [],
        questionId: 'q-1',
      },
      {
        slotId: 'slot-2',
        source: 'question_bank',
        pool: 'mistake_variant',
        kpId: 'kp-2',
        targetExam: '高考 2027',
        reason: 'open_mistake',
        secondaryReasons: [],
        questionId: 'q-2',
      },
      {
        slotId: 'slot-3',
        source: 'question_bank',
        pool: 'chapter_practice',
        kpId: 'kp-3',
        targetExam: '高考 2027',
        reason: 'chapter_progress',
        secondaryReasons: [],
        questionId: 'q-3',
      },
      {
        slotId: 'slot-4',
        source: 'question_bank',
        pool: 'new_knowledge',
        kpId: 'kp-4',
        targetExam: '高考 2027',
        reason: 'low_mastery_or_unseen',
        secondaryReasons: [],
        questionId: 'q-4',
      },
      {
        slotId: 'slot-5',
        source: 'ai_generated',
        pool: 'new_knowledge',
        kpId: 'kp-5',
        targetExam: '高考 2027',
        reason: 'low_mastery_or_unseen',
        secondaryReasons: [],
        difficultyRange: [1, 2],
        questionType: 'choice',
        fallback: 'retry_then_question_bank',
      },
      {
        slotId: 'slot-6',
        source: 'ai_generated',
        pool: 'feynman_check',
        kpId: 'kp-6',
        targetExam: '高考 2027',
        reason: 'mastery_needs_expression_check',
        secondaryReasons: [],
        activityType: 'feynman_prompt',
        fallback: 'drop_slot',
      },
    ];

    const sessionPlan = toQuestionBankSessionPlan({
      mode: 'daily_mixed',
      requestedCount: 8,
      targetCount: 8,
      minimumCount: 3,
      isEnoughForSession: true,
      allowedKpIds: ['kp-1', 'kp-2', 'kp-3', 'kp-4', 'kp-5', 'kp-6'],
      slots,
      skippedReasons: [],
    });

    expect(sessionPlan).toEqual({
      questionIds: ['q-1', 'q-2', 'q-3', 'q-4'],
      poolSources: ['spaced_repetition', 'error_review', 'new_knowledge', 'new_knowledge'],
      plannedQuestionCount: 4,
      minimumCount: 3,
      isEnoughForSession: true,
      skippedSlotCount: 2,
    });
  });
});
