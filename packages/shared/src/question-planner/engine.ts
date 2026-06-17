export type PlannerMode = 'daily_mixed' | 'chapter_focus' | 'mistake_focus';
export type PlannerQuestionType = 'choice' | 'fill_in';

export type SlotPool =
  | 'chapter_practice'
  | 'mistake_variant'
  | 'spaced_review'
  | 'feynman_check'
  | 'new_knowledge';

export interface PlannerStudent {
  id: string;
  primarySubjectId: string;
  targetExam: string;
  unlockedKpIds: string[];
  coldStartMode?: boolean;
}

export interface PlannerKnowledgePoint {
  id: string;
  subjectId: string;
  chapterNo?: string | null;
}

export interface PlannerMastery {
  kpId: string;
  masteryScore: number;
}

export interface PlannerMistake {
  questionId: string;
  kpId: string;
  errorCount?: number;
}

export interface PlannerDueReview {
  kpId: string;
  nextReviewAt: string | Date;
}

export interface PlannerQuestion {
  id: string;
  primaryKpId: string;
  kpIds: string[];
  difficulty: number;
  questionType: PlannerQuestionType;
}

export interface QuestionPlannerInput {
  student: PlannerStudent;
  mode?: PlannerMode;
  count?: number;
  minimumCount?: number;
  chapterNo?: string;
  kpIds?: string[];
  sourceQuestionIds?: string[];
  difficulty?: number | readonly [number, number];
  questionTypes?: PlannerQuestionType[];
  now?: string | Date;
  knowledgePoints: PlannerKnowledgePoint[];
  mastery?: PlannerMastery[];
  openMistakes?: PlannerMistake[];
  dueReviews?: PlannerDueReview[];
  questionBank?: PlannerQuestion[];
}

interface BaseSlot {
  slotId: string;
  pool: SlotPool;
  kpId: string;
  targetExam: string;
  reason: string;
  secondaryReasons: SlotPool[];
}

export type BankQuestionSlot = BaseSlot & {
  source: 'question_bank';
  questionId: string;
};

export type AiQuestionSlot = BaseSlot & {
  source: 'ai_generated';
  difficultyRange: [number, number];
  questionType: PlannerQuestionType;
  sourceQuestionId?: string;
  fallback: 'retry_then_question_bank' | 'drop_slot';
};

export type FeynmanPromptSlot = BaseSlot & {
  source: 'ai_generated';
  activityType: 'feynman_prompt';
  fallback: 'drop_slot';
};

export type LearningSlot = BankQuestionSlot | AiQuestionSlot | FeynmanPromptSlot;

export interface PlannerResult {
  mode: PlannerMode;
  requestedCount: number;
  targetCount: number;
  minimumCount: number;
  isEnoughForSession: boolean;
  allowedKpIds: string[];
  slots: LearningSlot[];
  skippedReasons: string[];
}

export type LearningSessionPoolSource = 'error_review' | 'spaced_repetition' | 'new_knowledge';

export interface QuestionBankSessionPlan {
  questionIds: string[];
  poolSources: LearningSessionPoolSource[];
  plannedQuestionCount: number;
  minimumCount: number;
  isEnoughForSession: boolean;
  skippedSlotCount: number;
}

type WeightedPool = 'progress' | 'mistake_variant' | 'spaced_review';

interface Candidate {
  pool: SlotPool;
  kpId: string;
  score: number;
  reason: string;
  sourceQuestionId?: string;
  secondaryReasons?: SlotPool[];
}

const DEFAULT_COUNT = 8;
const MAX_COUNT = 15;
const DEFAULT_MINIMUM_COUNT = 3;

const POOL_PRIORITY: Record<SlotPool, number> = {
  spaced_review: 100,
  mistake_variant: 90,
  chapter_practice: 70,
  new_knowledge: 60,
  feynman_check: 50,
};

const MODE_WEIGHTS: Record<PlannerMode, Record<WeightedPool, number>> = {
  daily_mixed: {
    progress: 0.4,
    mistake_variant: 0.3,
    spaced_review: 0.3,
  },
  chapter_focus: {
    progress: 0.7,
    spaced_review: 0.2,
    mistake_variant: 0.1,
  },
  mistake_focus: {
    mistake_variant: 0.7,
    spaced_review: 0.2,
    progress: 0.1,
  },
};

const SESSION_POOL_SOURCE_BY_SLOT_POOL: Record<SlotPool, LearningSessionPoolSource> = {
  mistake_variant: 'error_review',
  spaced_review: 'spaced_repetition',
  chapter_practice: 'new_knowledge',
  new_knowledge: 'new_knowledge',
  feynman_check: 'new_knowledge',
};

export function planLearningSession(input: QuestionPlannerInput): PlannerResult {
  const mode = input.mode ?? 'daily_mixed';
  const targetCount = clampInt(input.count ?? DEFAULT_COUNT, 1, MAX_COUNT);
  const minimumCount = clampInt(input.minimumCount ?? DEFAULT_MINIMUM_COUNT, 1, targetCount);
  const now = input.now ? new Date(input.now) : new Date();
  const questionTypes =
    input.questionTypes && input.questionTypes.length > 0
      ? unique(input.questionTypes)
      : (['choice', 'fill_in'] as PlannerQuestionType[]);
  const allowedKps = allowedKnowledgePoints(input);
  const allowedKpIds = allowedKps.map((kp) => kp.id);
  const allowedKpSet = new Set(allowedKpIds);

  if (allowedKps.length === 0) {
    return {
      mode,
      requestedCount: input.count ?? DEFAULT_COUNT,
      targetCount,
      minimumCount,
      isEnoughForSession: false,
      allowedKpIds,
      slots: [],
      skippedReasons: ['no_allowed_kps'],
    };
  }

  const masteryByKp = new Map(
    (input.mastery ?? []).map((m) => [m.kpId, clampNumber(m.masteryScore)]),
  );
  const questionBank = (input.questionBank ?? []).filter((question) =>
    isQuestionWithinKpBoundary(question, allowedKpSet),
  );
  const candidatesByPool = deduplicateCandidatesByKp(
    buildCandidates({
      input,
      allowedKps,
      masteryByKp,
      allowedKpSet,
      now,
    }),
  );
  const progressPool: SlotPool = input.chapterNo ? 'chapter_practice' : 'new_knowledge';
  const poolBudgets = allocateBudgets(targetCount, mode, progressPool);
  const slots: LearningSlot[] = [];
  const usedKpIds = new Set<string>();

  for (const pool of orderedPoolsForBudgets(poolBudgets)) {
    addSlotsFromPool({
      budget: poolBudgets[pool] ?? 0,
      slots,
      usedKpIds,
      candidates: candidatesByPool[pool],
      input,
      masteryByKp,
      questionBank,
      questionTypes,
      allowedKpSet,
      targetCount,
    });
  }

  if (slots.length < targetCount) {
    const remainingCandidates = orderedCandidatePools(candidatesByPool)
      .flatMap((pool) => candidatesByPool[pool])
      .filter((candidate) => !usedKpIds.has(candidate.kpId));

    for (const candidate of remainingCandidates) {
      if (slots.length >= targetCount) break;
      if (!canUseCandidate(candidate, slots, usedKpIds)) continue;
      const slot = candidateToSlot({
        candidate,
        input,
        masteryByKp,
        questionBank,
        questionTypes,
        allowedKpSet,
        sequence: slots.length + 1,
      });
      slots.push(slot);
      usedKpIds.add(candidate.kpId);
    }
  }

  return {
    mode,
    requestedCount: input.count ?? DEFAULT_COUNT,
    targetCount,
    minimumCount,
    isEnoughForSession: slots.length >= minimumCount,
    allowedKpIds,
    slots,
    skippedReasons: slots.length === 0 ? ['no_candidate_slots'] : [],
  };
}

export function toQuestionBankSessionPlan(result: PlannerResult): QuestionBankSessionPlan {
  const questionBankSlots = result.slots.filter(
    (slot): slot is BankQuestionSlot => slot.source === 'question_bank',
  );

  return {
    questionIds: questionBankSlots.map((slot) => slot.questionId),
    poolSources: questionBankSlots.map((slot) => SESSION_POOL_SOURCE_BY_SLOT_POOL[slot.pool]),
    plannedQuestionCount: questionBankSlots.length,
    minimumCount: result.minimumCount,
    isEnoughForSession: questionBankSlots.length >= result.minimumCount,
    skippedSlotCount: result.slots.length - questionBankSlots.length,
  };
}

function allowedKnowledgePoints(input: QuestionPlannerInput): PlannerKnowledgePoint[] {
  const unlocked = new Set(input.student.unlockedKpIds);
  const requested = input.kpIds ? new Set(input.kpIds) : null;

  return input.knowledgePoints.filter((kp) => {
    if (kp.subjectId !== input.student.primarySubjectId) return false;
    if (!unlocked.has(kp.id)) return false;
    if (requested && !requested.has(kp.id)) return false;
    return true;
  });
}

function buildCandidates({
  input,
  allowedKps,
  masteryByKp,
  allowedKpSet,
  now,
}: {
  input: QuestionPlannerInput;
  allowedKps: PlannerKnowledgePoint[];
  masteryByKp: Map<string, number>;
  allowedKpSet: Set<string>;
  now: Date;
}): Record<SlotPool, Candidate[]> {
  const byPool: Record<SlotPool, Candidate[]> = {
    spaced_review: [],
    mistake_variant: [],
    chapter_practice: [],
    new_knowledge: [],
    feynman_check: [],
  };

  for (const review of input.dueReviews ?? []) {
    if (!allowedKpSet.has(review.kpId)) continue;
    const nextReviewAt = new Date(review.nextReviewAt);
    if (Number.isNaN(nextReviewAt.getTime()) || nextReviewAt.getTime() > now.getTime()) continue;
    const overdueDays = Math.max(0, (now.getTime() - nextReviewAt.getTime()) / 86_400_000);
    byPool.spaced_review.push({
      pool: 'spaced_review',
      kpId: review.kpId,
      score: overdueDays,
      reason: 'spaced_review_due',
    });
  }

  for (const mistake of input.openMistakes ?? []) {
    if (!allowedKpSet.has(mistake.kpId)) continue;
    if (input.sourceQuestionIds && !input.sourceQuestionIds.includes(mistake.questionId)) continue;
    byPool.mistake_variant.push({
      pool: 'mistake_variant',
      kpId: mistake.kpId,
      score: mistake.errorCount ?? 1,
      sourceQuestionId: mistake.questionId,
      reason: 'open_mistake',
    });
  }

  for (const [index, kp] of allowedKps.entries()) {
    const mastery = masteryByKp.get(kp.id) ?? 0;
    const progressScore = (1 - mastery) * 100 - index / 100;

    if (input.chapterNo && kp.chapterNo === input.chapterNo && mastery < 0.85) {
      byPool.chapter_practice.push({
        pool: 'chapter_practice',
        kpId: kp.id,
        score: progressScore,
        reason: 'chapter_progress',
      });
    }

    if (mastery < 0.5) {
      byPool.new_knowledge.push({
        pool: 'new_knowledge',
        kpId: kp.id,
        score: progressScore,
        reason: 'low_mastery_or_unseen',
      });
    }

    if (mastery >= 0.5 && mastery < 0.85) {
      byPool.feynman_check.push({
        pool: 'feynman_check',
        kpId: kp.id,
        score: mastery,
        reason: 'mastery_needs_expression_check',
      });
    }
  }

  return Object.fromEntries(
    Object.entries(byPool).map(([pool, candidates]) => [
      pool,
      candidates.sort((a, b) => b.score - a.score || compareKpIds(a.kpId, b.kpId)),
    ]),
  ) as Record<SlotPool, Candidate[]>;
}

function allocateBudgets(
  targetCount: number,
  mode: PlannerMode,
  progressPool: SlotPool,
): Partial<Record<SlotPool, number>> {
  const weights = MODE_WEIGHTS[mode];
  const poolWeights: Partial<Record<SlotPool, number>> = {
    [progressPool]: weights.progress,
    mistake_variant: weights.mistake_variant,
    spaced_review: weights.spaced_review,
  };
  const entries = Object.entries(poolWeights) as Array<[SlotPool, number]>;
  const budgets: Partial<Record<SlotPool, number>> = {};
  let assigned = 0;

  for (const [pool, weight] of entries) {
    const count = Math.floor(targetCount * weight);
    budgets[pool] = count;
    assigned += count;
  }

  let remaining = targetCount - assigned;
  const remainderOrder = entries
    .slice()
    .sort((a, b) => b[1] - a[1] || POOL_PRIORITY[b[0]] - POOL_PRIORITY[a[0]]);
  let index = 0;
  while (remaining > 0 && remainderOrder.length > 0) {
    const [pool] = remainderOrder[index % remainderOrder.length] as [SlotPool, number];
    budgets[pool] = (budgets[pool] ?? 0) + 1;
    remaining -= 1;
    index += 1;
  }

  return budgets;
}

function orderedPoolsForBudgets(poolBudgets: Partial<Record<SlotPool, number>>): SlotPool[] {
  return (Object.keys(poolBudgets) as SlotPool[]).sort(
    (a, b) => POOL_PRIORITY[b] - POOL_PRIORITY[a],
  );
}

function orderedCandidatePools(candidatesByPool: Record<SlotPool, Candidate[]>): SlotPool[] {
  return (Object.keys(candidatesByPool) as SlotPool[]).sort(
    (a, b) => POOL_PRIORITY[b] - POOL_PRIORITY[a],
  );
}

function deduplicateCandidatesByKp(
  candidatesByPool: Record<SlotPool, Candidate[]>,
): Record<SlotPool, Candidate[]> {
  const byKp = new Map<string, Candidate[]>();

  for (const pool of orderedCandidatePools(candidatesByPool)) {
    for (const candidate of candidatesByPool[pool]) {
      const existing = byKp.get(candidate.kpId);
      if (existing) {
        existing.push(candidate);
      } else {
        byKp.set(candidate.kpId, [candidate]);
      }
    }
  }

  const deduped: Record<SlotPool, Candidate[]> = {
    spaced_review: [],
    mistake_variant: [],
    chapter_practice: [],
    new_knowledge: [],
    feynman_check: [],
  };

  for (const candidates of byKp.values()) {
    const primary = candidates.slice().sort(compareCandidates)[0];
    if (!primary) continue;

    const secondaryReasons = unique(candidates.map((candidate) => candidate.pool))
      .filter((pool) => pool !== primary.pool)
      .sort((a, b) => POOL_PRIORITY[b] - POOL_PRIORITY[a]);

    deduped[primary.pool].push({
      ...primary,
      secondaryReasons,
    });
  }

  return Object.fromEntries(
    Object.entries(deduped).map(([pool, candidates]) => [
      pool,
      candidates.sort((a, b) => b.score - a.score || compareKpIds(a.kpId, b.kpId)),
    ]),
  ) as Record<SlotPool, Candidate[]>;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    POOL_PRIORITY[b.pool] - POOL_PRIORITY[a.pool] ||
    b.score - a.score ||
    compareKpIds(a.kpId, b.kpId)
  );
}

function addSlotsFromPool({
  budget,
  slots,
  usedKpIds,
  candidates,
  input,
  masteryByKp,
  questionBank,
  questionTypes,
  allowedKpSet,
  targetCount,
}: {
  budget: number;
  slots: LearningSlot[];
  usedKpIds: Set<string>;
  candidates: Candidate[];
  input: QuestionPlannerInput;
  masteryByKp: Map<string, number>;
  questionBank: PlannerQuestion[];
  questionTypes: PlannerQuestionType[];
  allowedKpSet: Set<string>;
  targetCount: number;
}) {
  let added = 0;
  for (const candidate of candidates) {
    if (added >= budget || slots.length >= targetCount) return;
    if (!canUseCandidate(candidate, slots, usedKpIds)) continue;
    const slot = candidateToSlot({
      candidate,
      input,
      masteryByKp,
      questionBank,
      questionTypes,
      allowedKpSet,
      sequence: slots.length + 1,
    });
    slots.push(slot);
    usedKpIds.add(candidate.kpId);
    added += 1;
  }
}

function canUseCandidate(
  candidate: Candidate,
  slots: LearningSlot[],
  usedKpIds: Set<string>,
): boolean {
  if (usedKpIds.has(candidate.kpId)) return false;
  if (candidate.pool === 'feynman_check') {
    return !slots.some((slot) => slot.pool === 'feynman_check');
  }
  return true;
}

function candidateToSlot({
  candidate,
  input,
  masteryByKp,
  questionBank,
  questionTypes,
  allowedKpSet,
  sequence,
}: {
  candidate: Candidate;
  input: QuestionPlannerInput;
  masteryByKp: Map<string, number>;
  questionBank: PlannerQuestion[];
  questionTypes: PlannerQuestionType[];
  allowedKpSet: Set<string>;
  sequence: number;
}): LearningSlot {
  if (candidate.pool === 'feynman_check') {
    return {
      slotId: `slot-${sequence}`,
      pool: candidate.pool,
      kpId: candidate.kpId,
      targetExam: input.student.targetExam,
      reason: candidate.reason,
      secondaryReasons: candidate.secondaryReasons ?? [],
      source: 'ai_generated',
      activityType: 'feynman_prompt',
      fallback: 'drop_slot',
    };
  }

  const mastery = masteryByKp.get(candidate.kpId) ?? 0;
  const difficultyRange = resolveDifficultyRange(mastery, input.difficulty);
  const question = chooseQuestion({
    kpId: candidate.kpId,
    sourceQuestionId: candidate.sourceQuestionId,
    questionBank,
    questionTypes,
    difficultyRange,
    allowedKpSet,
  });

  if (question) {
    return {
      slotId: `slot-${sequence}`,
      pool: candidate.pool,
      kpId: candidate.kpId,
      targetExam: input.student.targetExam,
      reason: candidate.reason,
      secondaryReasons: candidate.secondaryReasons ?? [],
      source: 'question_bank',
      questionId: question.id,
    };
  }

  return {
    slotId: `slot-${sequence}`,
    pool: candidate.pool,
    kpId: candidate.kpId,
    targetExam: input.student.targetExam,
    reason: candidate.reason,
    secondaryReasons: candidate.secondaryReasons ?? [],
    source: 'ai_generated',
    difficultyRange,
    questionType: questionTypes[0] ?? 'choice',
    sourceQuestionId: candidate.sourceQuestionId,
    fallback: 'retry_then_question_bank',
  };
}

function chooseQuestion({
  kpId,
  sourceQuestionId,
  questionBank,
  questionTypes,
  difficultyRange,
  allowedKpSet,
}: {
  kpId: string;
  sourceQuestionId?: string;
  questionBank: PlannerQuestion[];
  questionTypes: PlannerQuestionType[];
  difficultyRange: [number, number];
  allowedKpSet: Set<string>;
}): PlannerQuestion | null {
  const candidates = questionBank.filter(
    (question) =>
      question.primaryKpId === kpId &&
      questionTypes.includes(question.questionType) &&
      isQuestionWithinKpBoundary(question, allowedKpSet),
  );

  if (sourceQuestionId) {
    const sourceQuestion = candidates.find((question) => question.id === sourceQuestionId);
    if (sourceQuestion) return sourceQuestion;
  }

  if (candidates.length === 0) return null;

  const [minDifficulty, maxDifficulty] = difficultyRange;
  const center = (minDifficulty + maxDifficulty) / 2;
  return (
    candidates.slice().sort((a, b) => {
      const aInRange = a.difficulty >= minDifficulty && a.difficulty <= maxDifficulty;
      const bInRange = b.difficulty >= minDifficulty && b.difficulty <= maxDifficulty;
      if (aInRange !== bInRange) return aInRange ? -1 : 1;
      return Math.abs(a.difficulty - center) - Math.abs(b.difficulty - center);
    })[0] ?? null
  );
}

function resolveDifficultyRange(
  mastery: number,
  requested?: number | readonly [number, number],
): [number, number] {
  const base: [number, number] =
    mastery < 0.2 ? [1, 2] : mastery < 0.5 ? [2, 3] : mastery < 0.85 ? [3, 4] : [4, 5];

  if (requested == null) return base;

  const requestedRange = Array.isArray(requested)
    ? ([requested[0], requested[1]] as [number, number])
    : ([requested, requested] as [number, number]);
  const normalized: [number, number] =
    requestedRange[0] <= requestedRange[1]
      ? requestedRange
      : [requestedRange[1], requestedRange[0]];
  const intersection: [number, number] = [
    Math.max(base[0], normalized[0]),
    Math.min(base[1], normalized[1]),
  ];
  return intersection[0] <= intersection[1] ? intersection : normalized;
}

function isQuestionWithinKpBoundary(question: PlannerQuestion, allowedKpSet: Set<string>): boolean {
  return question.kpIds.every((kpId) => allowedKpSet.has(kpId));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function compareKpIds(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}
