import { type Grade, Prisma, type Stage, prisma } from '@hao/db';
import {
  type SessionReviewAdvice,
  type SessionReviewAdviceResult,
  generateSessionReviewAdvice,
} from '@hao/llm';
import { formatStudentDisplayText } from './display-text';
import { withUnlockedPrimaryKpFilter } from './learning-rules';
import {
  type SessionResultKnowledgeGroup,
  type SessionResultReviewPlan,
  buildSessionResultKnowledgeGroups,
  buildSessionResultReviewPlan,
  collectSessionKnowledgePointIds,
  getLearningMaterialLabel,
} from './session-result-materials';

const PROVIDER_ENV_KEY = 'HAO_SESSION_REVIEW_PROVIDER_ID';
const SUMMARY_LIMIT = 120;
const MATERIAL_SUMMARY_LIMIT = 180;

export interface SessionReviewAdviceAttemptInput {
  questionSummary: string;
  solutionSummary: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  knowledgePointNames: string[];
}

export interface SessionReviewAdviceMaterialInput {
  materialType: string;
  label: string;
  title: string;
  summary: string;
}

export interface SessionReviewAdviceKnowledgeGroupInput {
  knowledgePointName: string;
  status: string;
  correctCount: number;
  totalCount: number;
  materials: SessionReviewAdviceMaterialInput[];
}

export interface SessionReviewAdviceMasteryInput {
  knowledgePointName: string;
  masteryScore: number | null;
  peakMasteryScore: number | null;
  lastAttemptedAt: Date | null;
  openMistakeCount: number;
  totalErrorCount: number;
}

export interface SessionReviewAdviceContext {
  sessionId: string;
  studentId: string;
  subjectId: string;
  student: {
    grade: Grade | string;
    stage: Stage | string;
    targetExam: string;
  };
  session: {
    correctCount: number;
    totalCount: number;
    isMistakeReview: boolean;
    completedAt: Date | null;
  };
  attempts: SessionReviewAdviceAttemptInput[];
  knowledgeGroups: SessionReviewAdviceKnowledgeGroupInput[];
  mastery: SessionReviewAdviceMasteryInput[];
  deterministicPlan: SessionResultReviewPlan;
}

export interface SessionReviewAdviceInputSnapshot {
  [key: string]: unknown;
  student: {
    grade: string;
    stage: string;
    targetExam: string;
  };
  session: {
    correctCount: number;
    totalCount: number;
    isMistakeReview: boolean;
    completedAt: string | null;
  };
  attempts: SessionReviewAdviceAttemptInput[];
  knowledgeGroups: SessionReviewAdviceKnowledgeGroupInput[];
  mastery: Array<
    Omit<SessionReviewAdviceMasteryInput, 'lastAttemptedAt'> & {
      lastAttemptedAt: string | null;
    }
  >;
  deterministicPlan: {
    headline: string;
    summary: string;
    steps: string[];
    focusItems: Array<Omit<SessionResultReviewPlan['focusItems'][number], 'kpId'>>;
  };
}

export interface SessionReviewAdviceUpsertPayload {
  sessionId: string;
  studentId: string;
  subjectId: string;
  status: 'generated' | 'failed';
  advice: SessionReviewAdvice | null;
  inputSnapshot: SessionReviewAdviceInputSnapshot;
  deterministicPlan: SessionResultReviewPlan;
  llmMetadata: Record<string, unknown> | null;
  diagnostics: Record<string, unknown> | null;
  qualityFlags: string[];
  errorMessage: string | null;
  generatedAt: Date | null;
}

export interface GenerateAndPersistDeps {
  generate: (options: {
    providerId: string;
    input: SessionReviewAdviceInputSnapshot;
  }) => Promise<SessionReviewAdviceResult>;
  upsert: (payload: SessionReviewAdviceUpsertPayload) => Promise<void>;
  now?: () => Date;
}

export interface SessionResultReviewPlanView extends SessionResultReviewPlan {
  source: 'persisted' | 'deterministic';
}

export interface SessionReviewAdviceReadDelegate {
  findUnique(args: {
    where: { session_id: string };
    select: { status: true; advice: true };
  }): Promise<{ status: string; advice: unknown } | null>;
}

interface SessionReviewAdviceWriteDelegate extends SessionReviewAdviceReadDelegate {
  upsert(args: unknown): Promise<unknown>;
}

export function getSessionReviewAdviceDelegate(
  db: unknown = prisma,
): SessionReviewAdviceWriteDelegate | null {
  const delegate = (db as { session_review_advice?: unknown }).session_review_advice;
  if (!delegate || typeof delegate !== 'object') return null;

  const candidate = delegate as Partial<SessionReviewAdviceWriteDelegate>;
  if (typeof candidate.findUnique !== 'function') return null;
  if (typeof candidate.upsert !== 'function') return null;
  return candidate as SessionReviewAdviceWriteDelegate;
}

export async function readPersistedSessionReviewAdvice(
  sessionId: string,
  delegate: SessionReviewAdviceReadDelegate | null = getSessionReviewAdviceDelegate(),
): Promise<SessionReviewAdvice | null> {
  if (!delegate) return null;

  try {
    const row = await delegate.findUnique({
      where: { session_id: sessionId },
      select: { status: true, advice: true },
    });
    return row?.status === 'generated' && row.advice ? (row.advice as SessionReviewAdvice) : null;
  } catch (error) {
    if (isSessionReviewAdviceTableUnavailable(error)) return null;
    throw error;
  }
}

export function buildSessionReviewAdviceInput(
  context: SessionReviewAdviceContext,
): SessionReviewAdviceInputSnapshot {
  return {
    student: {
      grade: String(context.student.grade),
      stage: String(context.student.stage),
      targetExam: formatStudentDisplayText(context.student.targetExam || '高考'),
    },
    session: {
      correctCount: context.session.correctCount,
      totalCount: context.session.totalCount,
      isMistakeReview: context.session.isMistakeReview,
      completedAt: context.session.completedAt?.toISOString() ?? null,
    },
    attempts: context.attempts.map((attempt) => ({
      questionSummary: truncateText(attempt.questionSummary, SUMMARY_LIMIT),
      solutionSummary: truncateText(attempt.solutionSummary, SUMMARY_LIMIT),
      studentAnswer: truncateText(attempt.studentAnswer || '未作答', 80),
      correctAnswer: truncateText(attempt.correctAnswer, 80),
      isCorrect: attempt.isCorrect,
      knowledgePointNames: [...attempt.knowledgePointNames],
    })),
    knowledgeGroups: context.knowledgeGroups.map((group) => ({
      knowledgePointName: group.knowledgePointName,
      status: group.status,
      correctCount: group.correctCount,
      totalCount: group.totalCount,
      materials: group.materials.slice(0, 4).map((material) => ({
        materialType: material.materialType,
        label: material.label,
        title: truncateText(material.title, 80),
        summary: truncateText(material.summary, MATERIAL_SUMMARY_LIMIT),
      })),
    })),
    mastery: context.mastery.map((row) => ({
      knowledgePointName: row.knowledgePointName,
      masteryScore: row.masteryScore,
      peakMasteryScore: row.peakMasteryScore,
      lastAttemptedAt: row.lastAttemptedAt?.toISOString() ?? null,
      openMistakeCount: row.openMistakeCount,
      totalErrorCount: row.totalErrorCount,
    })),
    deterministicPlan: sanitizeDeterministicPlanForLlm(context.deterministicPlan),
  };
}

export async function generateAndPersistSessionReviewAdviceFromContext({
  context,
  providerId,
  generate,
  upsert,
  now = () => new Date(),
}: {
  context: SessionReviewAdviceContext;
  providerId: string | null | undefined;
} & GenerateAndPersistDeps): Promise<{ status: 'generated' | 'failed' }> {
  const inputSnapshot = buildSessionReviewAdviceInput(context);

  if (!providerId) {
    await upsertFailedAdvice({
      context,
      inputSnapshot,
      upsert,
      errorMessage: `${PROVIDER_ENV_KEY} is not configured`,
      diagnostics: { reason: 'provider_missing', env: PROVIDER_ENV_KEY },
    });
    return { status: 'failed' };
  }

  try {
    const result = await generate({ providerId, input: inputSnapshot });
    if (result.advice && result.status !== 'failed') {
      const generatedAt = now();
      await upsert({
        sessionId: context.sessionId,
        studentId: context.studentId,
        subjectId: context.subjectId,
        status: 'generated',
        advice: result.advice,
        inputSnapshot,
        deterministicPlan: context.deterministicPlan,
        llmMetadata: {
          llm: result.llm,
          usage: result.usage ?? null,
          latency_ms: result.latency_ms ?? null,
          status: result.status,
        },
        diagnostics: result.diagnostics,
        qualityFlags: result.advice.qualityFlags ?? [],
        errorMessage: null,
        generatedAt,
      });
      return { status: 'generated' };
    }

    await upsertFailedAdvice({
      context,
      inputSnapshot,
      upsert,
      errorMessage: 'Session review advice generation returned no advice',
      diagnostics: result.diagnostics,
    });
    return { status: 'failed' };
  } catch (error) {
    await upsertFailedAdvice({
      context,
      inputSnapshot,
      upsert,
      errorMessage: error instanceof Error ? error.message : String(error),
      diagnostics: { reason: 'llm_error' },
    });
    return { status: 'failed' };
  }
}

export function selectSessionResultReviewPlan({
  persistedAdvice,
  deterministicPlan,
  knowledgeGroups,
}: {
  persistedAdvice: SessionReviewAdvice | null;
  deterministicPlan: SessionResultReviewPlan | null;
  knowledgeGroups: readonly SessionResultKnowledgeGroup[];
}): SessionResultReviewPlanView | null {
  if (persistedAdvice) {
    return {
      source: 'persisted',
      headline: persistedAdvice.headline,
      summary: persistedAdvice.summary,
      steps: persistedAdvice.nextSteps,
      encouragement: persistedAdvice.encouragement,
      focusItems: persistedAdvice.focusItems.slice(0, 3).map((item) => {
        const group = knowledgeGroups.find(
          (candidate) => candidate.knowledgePointName === item.knowledgePointName,
        );
        return {
          kpId: group?.kpId ?? item.knowledgePointName,
          knowledgePointName: item.knowledgePointName,
          priorityLabel: item.priorityLabel,
          scoreText: group ? `本次 ${group.correctCount} / ${group.totalCount}` : '',
          suggestion: item.suggestedAction,
          reason: item.reason,
          recommendedLabels: item.recommendedMaterialTypes
            .map((type) => getLearningMaterialLabel(type))
            .filter((label, index, labels) => labels.indexOf(label) === index),
        };
      }),
    };
  }

  return deterministicPlan ? { ...deterministicPlan, source: 'deterministic' } : null;
}

export async function generateAndPersistSessionReviewAdviceForSession(
  student: {
    id: string;
    grade: Grade;
    stage: Stage;
    target_exam: string;
    primary_subject_id: string;
    unlocked_kp_ids: string[];
  },
  sessionId: string,
): Promise<void> {
  const reviewAdviceDelegate = getSessionReviewAdviceDelegate();
  if (!reviewAdviceDelegate) return;

  const existing = await readSessionReviewAdviceStatus(sessionId, reviewAdviceDelegate);
  if (existing === 'table_unavailable') return;
  if (existing?.status === 'generated') return;

  const context = await loadSessionReviewAdviceContext(student, sessionId);
  if (!context) return;

  await generateAndPersistSessionReviewAdviceFromContext({
    context,
    providerId: process.env[PROVIDER_ENV_KEY],
    generate: ({ providerId, input }) => generateSessionReviewAdvice({ providerId, input }),
    upsert: (payload) => upsertSessionReviewAdvice(payload, reviewAdviceDelegate),
  });
}

async function upsertFailedAdvice({
  context,
  inputSnapshot,
  upsert,
  errorMessage,
  diagnostics,
}: {
  context: SessionReviewAdviceContext;
  inputSnapshot: SessionReviewAdviceInputSnapshot;
  upsert: (payload: SessionReviewAdviceUpsertPayload) => Promise<void>;
  errorMessage: string;
  diagnostics: Record<string, unknown> | null;
}): Promise<void> {
  await upsert({
    sessionId: context.sessionId,
    studentId: context.studentId,
    subjectId: context.subjectId,
    status: 'failed',
    advice: null,
    inputSnapshot,
    deterministicPlan: context.deterministicPlan,
    llmMetadata: null,
    diagnostics,
    qualityFlags: [],
    errorMessage,
    generatedAt: null,
  });
}

async function upsertSessionReviewAdvice(
  payload: SessionReviewAdviceUpsertPayload,
  delegate: SessionReviewAdviceWriteDelegate | null = getSessionReviewAdviceDelegate(),
): Promise<void> {
  if (!delegate) return;

  const adviceJson =
    payload.advice === null ? Prisma.JsonNull : (payload.advice as Prisma.InputJsonValue);
  const data = {
    student_id: payload.studentId,
    subject_id: payload.subjectId,
    status: payload.status,
    advice: adviceJson,
    input_snapshot: payload.inputSnapshot as unknown as Prisma.InputJsonValue,
    deterministic_plan: payload.deterministicPlan as unknown as Prisma.InputJsonValue,
    llm_metadata:
      payload.llmMetadata === null
        ? Prisma.JsonNull
        : (payload.llmMetadata as Prisma.InputJsonValue),
    diagnostics:
      payload.diagnostics === null
        ? Prisma.JsonNull
        : (payload.diagnostics as Prisma.InputJsonValue),
    quality_flags: payload.qualityFlags,
    error_message: payload.errorMessage,
    generated_at: payload.generatedAt,
  };

  await delegate
    .upsert({
      where: { session_id: payload.sessionId },
      create: {
        session_id: payload.sessionId,
        ...data,
      },
      update: data,
    })
    .catch((error) => {
      if (isSessionReviewAdviceTableUnavailable(error)) return;
      throw error;
    });
}

async function readSessionReviewAdviceStatus(
  sessionId: string,
  delegate: SessionReviewAdviceReadDelegate,
): Promise<{ status: string; advice: unknown } | 'table_unavailable' | null> {
  try {
    return await delegate.findUnique({
      where: { session_id: sessionId },
      select: { status: true, advice: true },
    });
  } catch (error) {
    if (isSessionReviewAdviceTableUnavailable(error)) return 'table_unavailable';
    throw error;
  }
}

function isSessionReviewAdviceTableUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2021') return true;

  const message = error instanceof Error ? error.message : String(error);
  return (
    /session_review_advice/i.test(message) &&
    /does not exist|not exist|doesn't exist/i.test(message)
  );
}

async function loadSessionReviewAdviceContext(
  student: {
    id: string;
    grade: Grade;
    stage: Stage;
    target_exam: string;
    primary_subject_id: string;
    unlocked_kp_ids: string[];
  },
  sessionId: string,
): Promise<SessionReviewAdviceContext | null> {
  const session = await prisma.learning_session.findFirst({
    where: { id: sessionId, student_id: student.id, status: 'completed' },
    select: {
      id: true,
      ended_at: true,
      pool_sources: true,
      question_attempts: {
        orderBy: { answered_at: 'asc' },
        select: {
          question_id: true,
          student_answer: true,
          is_correct: true,
        },
      },
    },
  });
  if (!session) return null;

  const questionIds = session.question_attempts.map((attempt) => attempt.question_id);
  const questions = await prisma.question.findMany({
    where: {
      id: { in: questionIds },
      ...withUnlockedPrimaryKpFilter(student.unlocked_kp_ids),
    },
    select: {
      id: true,
      content: true,
      answer: true,
      solution_text: true,
      primary_kp_id: true,
      kp_ids: true,
    },
  });
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const orderedAttempts = session.question_attempts.flatMap((attempt) => {
    const question = questionById.get(attempt.question_id);
    return question ? [{ ...attempt, question }] : [];
  });

  const sessionKpIds = collectSessionKnowledgePointIds(
    orderedAttempts.map((attempt) => attempt.question),
    student.unlocked_kp_ids,
  );
  const [knowledgePoints, learningMaterials, masteryRows, mistakeRows] = await Promise.all([
    sessionKpIds.length
      ? prisma.knowledge_point.findMany({
          where: { id: { in: sessionKpIds }, subject_id: student.primary_subject_id },
          select: { id: true, name: true },
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
    sessionKpIds.length
      ? prisma.knowledge_point_mastery.findMany({
          where: { student_id: student.id, kp_id: { in: sessionKpIds } },
          select: {
            kp_id: true,
            mastery_score: true,
            peak_mastery_score: true,
            last_attempted_at: true,
          },
        })
      : Promise.resolve([]),
    prisma.mistake_book_entry.findMany({
      where: { student_id: student.id, question_id: { in: questionIds } },
      select: {
        question_id: true,
        status: true,
        error_count: true,
        question: { select: { primary_kp_id: true } },
      },
    }),
  ]);

  const relatedKnowledgeGroups = buildSessionResultKnowledgeGroups({
    questions: orderedAttempts.map((attempt) => ({
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
  const correctCount = orderedAttempts.filter((attempt) => attempt.is_correct).length;
  const totalCount = orderedAttempts.length;
  const deterministicPlan = buildSessionResultReviewPlan({
    correctCount,
    totalCount,
    groups: relatedKnowledgeGroups,
  });
  if (!deterministicPlan) return null;

  const kpNameById = new Map(knowledgePoints.map((kp) => [kp.id, kp.name]));
  const groupByName = new Map(
    relatedKnowledgeGroups.map((group) => [group.knowledgePointName, group]),
  );
  const masteryByKp = new Map(masteryRows.map((row) => [row.kp_id, row]));
  const mistakeStatsByKp = buildMistakeStatsByKp(mistakeRows);

  return {
    sessionId: session.id,
    studentId: student.id,
    subjectId: student.primary_subject_id,
    student: {
      grade: student.grade,
      stage: student.stage,
      targetExam: student.target_exam,
    },
    session: {
      correctCount,
      totalCount,
      isMistakeReview: session.pool_sources.includes('error_review'),
      completedAt: session.ended_at,
    },
    attempts: orderedAttempts.map((attempt) => ({
      questionSummary: truncateText(
        formatStudentDisplayText(attempt.question.content),
        SUMMARY_LIMIT,
      ),
      solutionSummary: truncateText(
        formatStudentDisplayText(attempt.question.solution_text),
        SUMMARY_LIMIT,
      ),
      studentAnswer: formatStudentDisplayText(attempt.student_answer || '未作答'),
      correctAnswer: formatStudentDisplayText(attempt.question.answer),
      isCorrect: attempt.is_correct,
      knowledgePointNames: attempt.question.kp_ids.flatMap((kpId) => kpNameById.get(kpId) ?? []),
    })),
    knowledgeGroups: relatedKnowledgeGroups.map((group) => ({
      knowledgePointName: group.knowledgePointName,
      status: group.status,
      correctCount: group.correctCount,
      totalCount: group.totalCount,
      materials: group.materials.slice(0, 4).map((material) => ({
        materialType: material.materialType,
        label: material.label,
        title: material.title,
        summary: material.studentSummary || material.content,
      })),
    })),
    mastery: relatedKnowledgeGroups.map((group) => {
      const kpId = groupByName.get(group.knowledgePointName)?.kpId ?? '';
      const mastery = masteryByKp.get(kpId);
      const mistakeStats = mistakeStatsByKp.get(kpId) ?? {
        openMistakeCount: 0,
        totalErrorCount: 0,
      };
      return {
        knowledgePointName: group.knowledgePointName,
        masteryScore: mastery?.mastery_score ?? null,
        peakMasteryScore: mastery?.peak_mastery_score ?? null,
        lastAttemptedAt: mastery?.last_attempted_at ?? null,
        openMistakeCount: mistakeStats.openMistakeCount,
        totalErrorCount: mistakeStats.totalErrorCount,
      };
    }),
    deterministicPlan,
  };
}

function buildMistakeStatsByKp(
  rows: Array<{
    status: string;
    error_count: number;
    question: { primary_kp_id: string };
  }>,
): Map<string, { openMistakeCount: number; totalErrorCount: number }> {
  const stats = new Map<string, { openMistakeCount: number; totalErrorCount: number }>();
  for (const row of rows) {
    const kpId = row.question.primary_kp_id;
    const current = stats.get(kpId) ?? { openMistakeCount: 0, totalErrorCount: 0 };
    current.totalErrorCount += row.error_count;
    if (row.status === 'open') current.openMistakeCount += 1;
    stats.set(kpId, current);
  }
  return stats;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = formatStudentDisplayText(value).replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function sanitizeDeterministicPlanForLlm(
  plan: SessionResultReviewPlan,
): SessionReviewAdviceInputSnapshot['deterministicPlan'] {
  return {
    headline: plan.headline,
    summary: plan.summary,
    steps: [...plan.steps],
    focusItems: plan.focusItems.map(({ kpId: _kpId, ...item }) => item),
  };
}
