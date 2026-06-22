import 'server-only';

import { prisma } from '@hao/db';
import type { Grade, QuestionType, Stage } from '@hao/db';
import { GRADE_LABEL, STAGE_LABEL } from '@hao/shared/labels';
import { FIGURE_CROP_PROCESSOR, FIGURE_CROP_VERSION, createStore } from '@hao/storage';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { STUDENT_SESSION_COOKIE, verifyStudentSession } from './auth';
import { formatStudentDisplayText } from './display-text';
import { buildFigureAssetRequests } from './figure-assets';
import { getMasteryBand, withUnlockedPrimaryKpFilter } from './learning-rules';
import {
  type QuestionContentPart,
  type QuestionFigureInput,
  buildQuestionContentParts,
  questionContentPartsToPlainText,
} from './question-content';
import { type SessionHistorySummary, summarizeSessionHistory } from './session-history';
import { buildResolvedMistakeFeedback } from './session-result-feedback';
import {
  type SessionResultKnowledgeGroup,
  buildSessionResultKnowledgeGroups,
  buildSessionResultReviewPlan,
  collectSessionKnowledgePointIds,
} from './session-result-materials';
import {
  type SessionResultReviewPlanView,
  readPersistedSessionReviewAdvice,
  selectSessionResultReviewPlan,
} from './session-review-advice';

export interface CurrentStudent {
  id: string;
  username: string;
  name: string;
  grade: Grade;
  stage: Stage;
  target_exam: string;
  primary_subject_id: string;
  parent_consent_at: Date | null;
  unlocked_kp_ids: string[];
}

export interface DashboardData {
  student: CurrentStudent & {
    gradeLabel: string;
    stageLabel: string;
  };
  unlockedKpCount: number;
  availableQuestionCount: number;
  completedSessionsThisWeek: number;
  masteryCounts: Record<'not_started' | 'needs_work' | 'learning' | 'mastered', number>;
}

export interface QuestionOptionView {
  label: string;
  text: string;
}

interface QuestionMetadata {
  options: QuestionOptionView[];
  figures: QuestionFigureInput[];
}

export interface SessionQuestionView {
  id: string;
  content: string;
  contentParts: QuestionContentPart[];
  answer: string;
  solution_text: string;
  solutionParts: QuestionContentPart[];
  question_type: QuestionType;
  difficulty: number;
  primary_kp_id: string;
  kp_ids: string[];
  options: QuestionOptionView[];
}

export interface AnswerSessionData {
  id: string;
  started_at: Date;
  questions: SessionQuestionView[];
}

export interface SessionResultData {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  attempts: Array<{
    id: string;
    question_id: string;
    student_answer: string;
    is_correct: boolean;
    mistakeResolved: boolean;
    question: SessionQuestionView;
  }>;
  resolvedMistakeCount: number;
  resolvedMistakeHeadline: string | null;
  reviewPlan: SessionResultReviewPlanView | null;
  relatedKnowledgeGroups: SessionResultKnowledgeGroup[];
}

export interface SessionHistoryData {
  sessions: SessionHistorySummary[];
}

export async function getCurrentStudent(): Promise<CurrentStudent | null> {
  const jar = await cookies();
  const session = verifyStudentSession(jar.get(STUDENT_SESSION_COOKIE)?.value);
  if (!session) return null;

  return prisma.student.findFirst({
    where: { id: session.sid, soft_deleted_at: null },
    select: {
      id: true,
      username: true,
      name: true,
      grade: true,
      stage: true,
      target_exam: true,
      primary_subject_id: true,
      parent_consent_at: true,
      unlocked_kp_ids: true,
    },
  });
}

export async function requireCurrentStudent(): Promise<CurrentStudent> {
  const student = await getCurrentStudent();
  if (!student) redirect('/login');
  if (!student.parent_consent_at) {
    redirect('/login?error=consent_required');
  }
  return student;
}

export async function getDashboardData(student: CurrentStudent): Promise<DashboardData> {
  const unlockedKpIds = student.unlocked_kp_ids;
  const weekStart = startOfWeek(new Date());

  const [unlockedKps, availableQuestionCount, completedSessionsThisWeek, masteryRows] =
    await Promise.all([
      unlockedKpIds.length
        ? prisma.knowledge_point.findMany({
            where: { id: { in: unlockedKpIds }, subject_id: student.primary_subject_id },
            select: { id: true },
          })
        : Promise.resolve([]),
      unlockedKpIds.length
        ? prisma.question.count({
            where: {
              ...withUnlockedPrimaryKpFilter(unlockedKpIds),
              question_attempts: { none: { student_id: student.id } },
            },
          })
        : Promise.resolve(0),
      prisma.learning_session.count({
        where: {
          student_id: student.id,
          status: 'completed',
          ended_at: { gte: weekStart },
        },
      }),
      unlockedKpIds.length
        ? prisma.knowledge_point_mastery.findMany({
            where: {
              student_id: student.id,
              kp_id: { in: unlockedKpIds },
            },
            select: { kp_id: true, mastery_score: true },
          })
        : Promise.resolve([]),
    ]);

  const masteryByKp = new Map(masteryRows.map((row) => [row.kp_id, row.mastery_score]));
  const masteryCounts: DashboardData['masteryCounts'] = {
    not_started: 0,
    needs_work: 0,
    learning: 0,
    mastered: 0,
  };

  for (const kp of unlockedKps) {
    const score = masteryByKp.get(kp.id);
    const band = score === undefined ? 'not_started' : getMasteryBand(score);
    masteryCounts[band] += 1;
  }

  return {
    student: {
      ...student,
      gradeLabel: GRADE_LABEL[student.grade],
      stageLabel: STAGE_LABEL[student.stage],
    },
    unlockedKpCount: unlockedKps.length,
    availableQuestionCount,
    completedSessionsThisWeek,
    masteryCounts,
  };
}

export async function getAnswerSessionData(
  student: CurrentStudent,
  sessionId: string,
): Promise<AnswerSessionData | null> {
  const session = await prisma.learning_session.findFirst({
    where: { id: sessionId, student_id: student.id, status: 'in_progress' },
    select: { id: true, started_at: true, question_ids: true },
  });
  if (!session) return null;

  const questions = await getQuestionsForStudent(student, session.question_ids);
  return {
    id: session.id,
    started_at: session.started_at,
    questions,
  };
}

export async function getSessionResultData(
  student: CurrentStudent,
  sessionId: string,
): Promise<SessionResultData | null> {
  const session = await prisma.learning_session.findFirst({
    where: { id: sessionId, student_id: student.id, status: 'completed' },
    select: {
      id: true,
      started_at: true,
      ended_at: true,
      question_attempts: {
        orderBy: { answered_at: 'asc' },
        select: {
          id: true,
          student_answer: true,
          is_correct: true,
          question_id: true,
        },
      },
    },
  });
  if (!session) return null;

  const questions = await getQuestionsForStudent(
    student,
    session.question_attempts.map((attempt) => attempt.question_id),
  );
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const sessionKpIds = collectSessionKnowledgePointIds(questions, student.unlocked_kp_ids);
  const endedAt = session.ended_at ?? new Date();
  const [resolvedMistakes, knowledgePoints, learningMaterials, persistedAdvice] = await Promise.all(
    [
      prisma.mistake_book_entry.findMany({
        where: {
          student_id: student.id,
          question_id: { in: session.question_attempts.map((attempt) => attempt.question_id) },
          status: 'resolved',
          resolved_at: {
            gte: session.started_at,
            lte: endedAt,
          },
        },
        select: {
          question_id: true,
        },
      }),
      sessionKpIds.length
        ? prisma.knowledge_point.findMany({
            where: {
              id: { in: sessionKpIds },
              subject_id: student.primary_subject_id,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([]),
      sessionKpIds.length
        ? prisma.learning_material.findMany({
            where: {
              subject_id: student.primary_subject_id,
              OR: [{ primary_kp_id: { in: sessionKpIds } }, { kp_ids: { hasSome: sessionKpIds } }],
            },
            select: {
              id: true,
              material_type: true,
              title: true,
              content: true,
              student_summary: true,
              primary_kp_id: true,
              kp_ids: true,
              created_at: true,
            },
            orderBy: [{ created_at: 'desc' }],
          })
        : Promise.resolve([]),
      readPersistedSessionReviewAdvice(session.id),
    ],
  );
  const feedback = buildResolvedMistakeFeedback({
    attempts: session.question_attempts.map((attempt) => ({
      questionId: attempt.question_id,
      isCorrect: attempt.is_correct,
    })),
    resolvedQuestionIds: resolvedMistakes.map((mistake) => mistake.question_id),
  });
  const attempts = session.question_attempts.flatMap((attempt) => {
    const question = questionById.get(attempt.question_id);
    if (!question) return [];
    return [
      {
        ...attempt,
        mistakeResolved: feedback.resolvedQuestionIds.has(attempt.question_id),
        question,
      },
    ];
  });
  const relatedKnowledgeGroups = buildSessionResultKnowledgeGroups({
    questions: attempts.map((attempt) => ({
      id: attempt.question.id,
      isCorrect: attempt.is_correct,
      primaryKpId: attempt.question.primary_kp_id,
      kpIds: attempt.question.kp_ids,
    })),
    unlockedKpIds: student.unlocked_kp_ids,
    knowledgePoints,
    materials: learningMaterials.map((material) => ({
      id: material.id,
      materialType: material.material_type,
      title: material.title,
      content: material.content,
      studentSummary: material.student_summary,
      primaryKpId: material.primary_kp_id,
      kpIds: material.kp_ids,
      createdAt: material.created_at,
    })),
  });
  const deterministicPlan = buildSessionResultReviewPlan({
    correctCount: attempts.filter((attempt) => attempt.is_correct).length,
    totalCount: attempts.length,
    groups: relatedKnowledgeGroups,
  });
  const reviewPlan = selectSessionResultReviewPlan({
    persistedAdvice,
    deterministicPlan,
    knowledgeGroups: relatedKnowledgeGroups,
  });

  return {
    id: session.id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    attempts,
    resolvedMistakeCount: feedback.resolvedCount,
    resolvedMistakeHeadline: feedback.headline,
    reviewPlan,
    relatedKnowledgeGroups,
  };
}

export async function getSessionHistoryData(student: CurrentStudent): Promise<SessionHistoryData> {
  const sessions = await prisma.learning_session.findMany({
    where: {
      student_id: student.id,
      status: 'completed',
    },
    orderBy: { ended_at: 'desc' },
    take: 20,
    select: {
      id: true,
      started_at: true,
      ended_at: true,
      question_ids: true,
      question_attempts: {
        select: { is_correct: true },
      },
    },
  });

  return {
    sessions: sessions.map(summarizeSessionHistory),
  };
}

export async function getQuestionsForStudent(
  student: CurrentStudent,
  questionIds: readonly string[],
): Promise<SessionQuestionView[]> {
  if (questionIds.length === 0 || student.unlocked_kp_ids.length === 0) return [];

  const questions = await prisma.question.findMany({
    where: {
      id: { in: [...questionIds] },
      ...withUnlockedPrimaryKpFilter(student.unlocked_kp_ids),
    },
    select: {
      id: true,
      content: true,
      answer: true,
      solution_text: true,
      question_type: true,
      difficulty: true,
      primary_kp_id: true,
      kp_ids: true,
    },
  });
  const metadataByQuestionId = await getMetadataByQuestionId(questionIds);
  const order = new Map(questionIds.map((id, index) => [id, index]));

  return questions
    .map((question) => {
      const metadata = metadataByQuestionId.get(question.id);
      const figures = metadata?.figures ?? [];
      const contentParts = buildQuestionContentParts(question.content, figures);
      const solutionParts = buildQuestionContentParts(
        question.solution_text || '暂无解析',
        figures,
      );

      return {
        ...question,
        content: questionContentPartsToPlainText(contentParts),
        contentParts,
        answer: formatStudentDisplayText(question.answer),
        solution_text: questionContentPartsToPlainText(solutionParts),
        solutionParts,
        options: (metadata?.options ?? fallbackOptions(question.question_type)).map((option) => ({
          ...option,
          text: formatStudentDisplayText(option.text),
        })),
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

async function getMetadataByQuestionId(
  questionIds: readonly string[],
): Promise<Map<string, QuestionMetadata>> {
  if (questionIds.length === 0) return new Map();

  const stagings = await prisma.llm_parse_staging.findMany({
    where: { published_id: { in: [...questionIds] }, entity_kind: 'question' },
    select: { published_id: true, review_payload: true, llm_payload: true },
  });

  const metadataByQuestionId = new Map<string, QuestionMetadata>();
  for (const staging of stagings) {
    if (!staging.published_id) continue;
    const options = readOptions(staging.review_payload);
    const figures = readFigures(staging.review_payload, staging.llm_payload);
    if (options.length > 0 || figures.length > 0) {
      metadataByQuestionId.set(staging.published_id, { options, figures });
    }
  }
  await attachFigureAssetUrls(metadataByQuestionId);
  return metadataByQuestionId;
}

async function attachFigureAssetUrls(
  metadataByQuestionId: Map<string, QuestionMetadata>,
): Promise<void> {
  const requests = buildFigureAssetRequests(metadataByQuestionId);
  if (requests.length === 0) return;

  const assetKeys = [...new Set(requests.map((request) => request.assetKey))];
  const rows = await prisma.derived_asset.findMany({
    where: {
      processor: FIGURE_CROP_PROCESSOR,
      version: FIGURE_CROP_VERSION,
      asset_key: { in: assetKeys },
    },
    select: {
      asset_key: true,
      storage_path: true,
    },
  });
  if (rows.length === 0) return;

  const store = createStore();
  const urlByAssetKey = new Map<string, string>();
  for (const row of rows) {
    urlByAssetKey.set(row.asset_key, await store.presignedGetUrl(row.storage_path));
  }

  for (const request of requests) {
    const imageUrl = urlByAssetKey.get(request.assetKey);
    if (!imageUrl) continue;

    const metadata = metadataByQuestionId.get(request.questionId);
    if (!metadata) continue;

    metadata.figures = metadata.figures.map((figure) =>
      figure.id === request.figureId ? { ...figure, imageUrl } : figure,
    );
  }
}

function readOptions(payload: unknown): QuestionOptionView[] {
  if (!payload || typeof payload !== 'object' || !('options' in payload)) return [];
  const options = (payload as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];

  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const label = (option as { label?: unknown }).label;
    const text = (option as { text?: unknown }).text;
    if (typeof label !== 'string' || typeof text !== 'string') return [];
    return [{ label, text }];
  });
}

function readFigures(...payloads: unknown[]): QuestionFigureInput[] {
  const figuresById = new Map<string, QuestionFigureInput>();

  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object' || !('figures' in payload)) continue;
    const figures = (payload as { figures?: unknown }).figures;
    if (!Array.isArray(figures)) continue;

    for (const figure of figures) {
      if (!figure || typeof figure !== 'object') continue;
      const id = (figure as { id?: unknown }).id;
      if (typeof id !== 'string' || !id) continue;

      const description =
        readOptionalString((figure as { description?: unknown }).description) ??
        readOptionalString((figure as { figure_description?: unknown }).figure_description) ??
        readOptionalString((figure as { alt?: unknown }).alt);
      const imageUrl = readOptionalString((figure as { imageUrl?: unknown }).imageUrl);

      figuresById.set(id, {
        id,
        description,
        imageUrl,
      });
    }
  }

  return [...figuresById.values()];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function fallbackOptions(questionType: QuestionType): QuestionOptionView[] {
  if (questionType !== 'choice') return [];
  return ['A', 'B', 'C', 'D'].map((label) => ({ label, text: label }));
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}
