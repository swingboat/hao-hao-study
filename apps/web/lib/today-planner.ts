import 'server-only';

import { prisma } from '@hao/db';
import type { Grade } from '@hao/db';
import {
  type PlannerResult,
  type QuestionBankSessionPlan,
  planLearningSession,
  toQuestionBankSessionPlan,
} from '@hao/shared';
import { GRADE_LABEL } from '@hao/shared/labels';
import {
  type PlannerKnowledgePointDisplay,
  type PlannerQuestionDetail,
  type PlannerSlotView,
  buildQuestionDetailMap,
  mapQuestionBankForPlanner,
  toPlannerSlotView,
} from './planner-adapter';
import {
  type PlannerPreferenceView,
  buildPlannerConfig,
  resolvePlannerPreference,
} from './planner-preferences';

export const PLANNER_TARGET_COUNT = 8;
export const PLANNER_MINIMUM_COUNT = 3;

export interface TodayPlannerStudent {
  id: string;
  username: string;
  name: string;
  grade: Grade;
  target_exam: string;
  primary_subject_id: string;
  unlocked_kp_ids: string[];
}

export interface TodayPlannerOptions {
  onlyUnattemptedQuestions?: boolean;
  answerableOnly?: boolean;
}

export interface TodayPlannerData {
  student: {
    id: string;
    username: string;
    name: string;
    grade: string;
    gradeLabel: string;
    targetExam: string;
    primarySubjectId: string;
  };
  effectiveUnlockedKpCount: number;
  persistedUnlockedKpCount: number;
  questionBankCount: number;
  filteredQuestionBankCount: number;
  readyQuestionCount: number;
  plannerPreference: PlannerPreferenceView;
  sessionPlan: QuestionBankSessionPlan | null;
  result: PlannerResult;
  slots: PlannerSlotView[];
}

export async function getNikiTodayPlannerData(): Promise<TodayPlannerData | null> {
  const student = await prisma.student.findFirst({
    where: { username: 'niki', soft_deleted_at: null },
    select: {
      id: true,
      username: true,
      name: true,
      grade: true,
      target_exam: true,
      primary_subject_id: true,
      unlocked_kp_ids: true,
    },
  });
  if (!student) return null;

  return getTodayPlannerDataForStudent(student);
}

export async function getTodayPlannerDataForStudent(
  student: TodayPlannerStudent,
  options: TodayPlannerOptions = {},
): Promise<TodayPlannerData> {
  const unlockedKpIds = student.unlocked_kp_ids;

  const knowledgePoints = await prisma.knowledge_point.findMany({
    where: {
      subject_id: student.primary_subject_id,
      id: { in: unlockedKpIds },
    },
    select: { id: true, name: true, subject_id: true, chapter_no: true },
    orderBy: [{ chapter_no: 'asc' }, { created_at: 'asc' }],
  });

  const [preferenceRow, questionRows, masteryRows, mistakeRows, dueReviewRows] = await Promise.all([
    prisma.student_planner_preference.findUnique({
      where: { student_id: student.id },
      select: { mode: true, weights: true },
    }),
    prisma.question.findMany({
      where: {
        primary_kp_id: { in: unlockedKpIds },
        question_type: { in: ['choice', 'fill_in'] },
        ...(options.onlyUnattemptedQuestions
          ? { question_attempts: { none: { student_id: student.id } } }
          : {}),
      },
      select: {
        id: true,
        content: true,
        answer: true,
        solution_text: true,
        primary_kp_id: true,
        kp_ids: true,
        difficulty: true,
        question_type: true,
      },
      orderBy: [{ primary_kp_id: 'asc' }, { created_at: 'asc' }],
      take: 500,
    }),
    prisma.knowledge_point_mastery.findMany({
      where: {
        student_id: student.id,
        kp_id: { in: unlockedKpIds },
      },
      select: { kp_id: true, mastery_score: true },
    }),
    prisma.mistake_book_entry.findMany({
      where: {
        student_id: student.id,
        status: 'open',
        question: { primary_kp_id: { in: unlockedKpIds } },
      },
      select: {
        question_id: true,
        error_count: true,
        question: { select: { primary_kp_id: true } },
      },
      orderBy: [{ error_count: 'desc' }, { created_at: 'asc' }],
      take: 100,
    }),
    prisma.spaced_review.findMany({
      where: {
        student_id: student.id,
        kp_id: { in: unlockedKpIds },
        next_review_at: { lte: new Date() },
      },
      select: { kp_id: true, next_review_at: true },
      orderBy: { next_review_at: 'asc' },
      take: 100,
    }),
  ]);

  const broadQuestionBank = mapQuestionBankForPlanner(questionRows, unlockedKpIds);
  const answerablePrimaryKpIds = new Set(broadQuestionBank.map((question) => question.primaryKpId));
  const plannerUnlockedKpIds = options.answerableOnly
    ? unlockedKpIds.filter((kpId) => answerablePrimaryKpIds.has(kpId))
    : unlockedKpIds;
  const plannerUnlockedSet = new Set(plannerUnlockedKpIds);
  const plannerPreference = resolvePlannerPreference(preferenceRow);
  const plannerKnowledgePoints = knowledgePoints
    .filter((kp) => plannerUnlockedSet.has(kp.id))
    .map((kp) => ({
      id: kp.id,
      subjectId: kp.subject_id,
      chapterNo: kp.chapter_no,
    }));
  const questionBank = mapQuestionBankForPlanner(questionRows, plannerUnlockedKpIds);
  const result = planLearningSession({
    mode: 'daily_mixed',
    count: PLANNER_TARGET_COUNT,
    minimumCount: PLANNER_MINIMUM_COUNT,
    student: {
      id: student.id,
      primarySubjectId: student.primary_subject_id,
      targetExam: student.target_exam,
      unlockedKpIds: plannerUnlockedKpIds,
    },
    knowledgePoints: plannerKnowledgePoints,
    questionBank,
    mastery: masteryRows
      .filter((row) => plannerUnlockedSet.has(row.kp_id))
      .map((row) => ({
        kpId: row.kp_id,
        masteryScore: row.mastery_score,
      })),
    openMistakes: mistakeRows
      .filter((row) => plannerUnlockedSet.has(row.question.primary_kp_id))
      .map((row) => ({
        questionId: row.question_id,
        kpId: row.question.primary_kp_id,
        errorCount: row.error_count,
      })),
    dueReviews: dueReviewRows
      .filter((row) => plannerUnlockedSet.has(row.kp_id))
      .map((row) => ({
        kpId: row.kp_id,
        nextReviewAt: row.next_review_at,
      })),
    plannerConfig: buildPlannerConfig(plannerPreference),
  });

  const sessionPlan = toQuestionBankSessionPlan(result);
  const detailMap = buildQuestionDetailMap(questionRows as PlannerQuestionDetail[]);
  const knowledgePointMap = new Map<string, PlannerKnowledgePointDisplay>(
    knowledgePoints.map((kp) => [kp.id, { name: kp.name, chapterNo: kp.chapter_no }]),
  );

  return {
    student: {
      id: student.id,
      username: student.username,
      name: student.name,
      grade: student.grade,
      gradeLabel: GRADE_LABEL[student.grade],
      targetExam: student.target_exam,
      primarySubjectId: student.primary_subject_id,
    },
    effectiveUnlockedKpCount: plannerUnlockedKpIds.length,
    persistedUnlockedKpCount: student.unlocked_kp_ids.length,
    questionBankCount: questionRows.length,
    filteredQuestionBankCount: questionBank.length,
    readyQuestionCount: sessionPlan.plannedQuestionCount,
    plannerPreference,
    sessionPlan: sessionPlan.isEnoughForSession ? sessionPlan : null,
    result,
    slots: result.slots.map((slot, index) =>
      toPlannerSlotView(slot, detailMap, knowledgePointMap, index),
    ),
  };
}
