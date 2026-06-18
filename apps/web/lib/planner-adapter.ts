import type { QuestionType } from '@hao/db';
import type { LearningSlot, PlannerQuestion, PlannerQuestionType, SlotPool } from '@hao/shared';

export interface PlannerQuestionRow {
  id: string;
  primary_kp_id: string;
  kp_ids: string[];
  difficulty: number;
  question_type: QuestionType | string;
}

export interface PlannerQuestionDetail extends PlannerQuestionRow {
  content: string;
  answer: string;
  solution_text: string;
}

export interface PlannerKnowledgePointDisplay {
  name: string;
  chapterNo: string | null;
}

export interface PlannerQuestionDisplay extends PlannerQuestionDetail {
  questionTypeLabel: string;
  difficultyLabel: string;
}

export interface PlannerSlotView {
  slotId: string;
  indexLabel: string;
  poolLabel: string;
  kpId: string;
  kpTitle: string;
  kpSubtitle: string | null;
  sourceLabel: string;
  reason: string;
  secondaryReasonLabels: string[];
  question: PlannerQuestionDisplay | null;
  aiPlaceholder: {
    difficultyRange?: [number, number];
    difficultyLabel?: string;
    questionType?: PlannerQuestionType;
    questionTypeLabel?: string;
    activityType?: 'feynman_prompt';
  } | null;
}

const POOL_LABELS: Record<SlotPool, string> = {
  spaced_review: '艾宾浩斯复习',
  mistake_variant: '错题变式',
  chapter_practice: '教材进度练习',
  new_knowledge: '新知识练习',
  feynman_check: '费曼复述检查',
};

const PLANNER_QUESTION_TYPES = new Set<string>(['choice', 'fill_in']);

export function mapQuestionBankForPlanner(
  questions: readonly PlannerQuestionRow[],
  allowedKpIds: readonly string[],
): PlannerQuestion[] {
  const allowed = new Set(allowedKpIds);

  return questions.flatMap((question) => {
    const questionType = mapQuestionType(question.question_type);
    if (!questionType) return [];
    if (!allowed.has(question.primary_kp_id)) return [];
    if (!question.kp_ids.every((kpId) => allowed.has(kpId))) return [];

    return [
      {
        id: question.id,
        primaryKpId: question.primary_kp_id,
        kpIds: question.kp_ids,
        difficulty: question.difficulty,
        questionType,
      },
    ];
  });
}

export function buildQuestionDetailMap(
  questions: readonly PlannerQuestionDetail[],
): Map<string, PlannerQuestionDetail> {
  return new Map(questions.map((question) => [question.id, question]));
}

export function toPlannerSlotView(
  slot: LearningSlot,
  questionById: Map<string, PlannerQuestionDetail>,
  knowledgePointById = new Map<string, PlannerKnowledgePointDisplay>(),
  index = 0,
): PlannerSlotView {
  const questionRow =
    slot.source === 'question_bank' ? (questionById.get(slot.questionId) ?? null) : null;
  const question = questionRow
    ? {
        ...questionRow,
        questionTypeLabel: questionTypeLabel(questionRow.question_type),
        difficultyLabel: difficultyLabel(questionRow.difficulty),
      }
    : null;
  const kp = knowledgePointById.get(slot.kpId);

  return {
    slotId: slot.slotId,
    indexLabel: String(index + 1),
    poolLabel: poolLabel(slot.pool),
    kpId: slot.kpId,
    kpTitle: kp?.name ?? '这个知识点',
    kpSubtitle: kp?.chapterNo ?? null,
    sourceLabel: sourceLabel(slot),
    reason: slot.reason,
    secondaryReasonLabels: slot.secondaryReasons.map(poolLabel),
    question,
    aiPlaceholder: slot.source === 'ai_generated' ? aiPlaceholder(slot) : null,
  };
}

export function poolLabel(pool: SlotPool): string {
  return POOL_LABELS[pool];
}

export function questionTypeLabel(
  questionType: QuestionType | PlannerQuestionType | string,
): string {
  if (questionType === 'choice') return '选择题';
  if (questionType === 'fill_in') return '填空题';
  return '练习题';
}

export function difficultyLabel(difficulty: number): string {
  if (difficulty <= 2) return '基础';
  if (difficulty === 3) return '中等';
  return '提高';
}

function mapQuestionType(questionType: QuestionType | string): PlannerQuestionType | null {
  return PLANNER_QUESTION_TYPES.has(questionType) ? (questionType as PlannerQuestionType) : null;
}

function sourceLabel(slot: LearningSlot): string {
  if (slot.pool === 'feynman_check') return '复述练习';
  return slot.source === 'question_bank' ? '可直接练习' : '练习方向';
}

function aiPlaceholder(slot: Extract<LearningSlot, { source: 'ai_generated' }>) {
  if ('activityType' in slot) {
    return {
      activityType: slot.activityType,
    };
  }

  return {
    difficultyRange: slot.difficultyRange,
    difficultyLabel: difficultyRangeLabel(slot.difficultyRange),
    questionType: slot.questionType,
    questionTypeLabel: questionTypeLabel(slot.questionType),
  };
}

function difficultyRangeLabel(range: [number, number]): string {
  const [min, max] = range;
  const minLabel = difficultyLabel(min);
  const maxLabel = difficultyLabel(max);
  if (minLabel === maxLabel) return minLabel;
  return `${minLabel}到${maxLabel}`;
}
