export interface TodayTaskSummarySlot {
  kpTitle: string;
  kpSubtitle: string | null;
  poolLabel: string;
}

export interface TodayTaskSummaryInput {
  slots: readonly TodayTaskSummarySlot[];
  readyQuestionCount: number;
  targetQuestionCount: number;
  canStart: boolean;
}

export interface TodayTaskSummary {
  knowledgePointSummary: string;
  chapterLabels: string[];
  reasons: string[];
  estimatedMinutes: number;
  afterCompletion: string[];
  positiveEmptyState: string | null;
}

const EMPTY_KP_SUMMARY = '今天先保持复习节奏';
const POSITIVE_EMPTY_STATE = '今天先整理已学内容，系统会继续为你安排合适的巩固练习。';

export function buildTodayTaskSummary(input: TodayTaskSummaryInput): TodayTaskSummary {
  const kpTitles = uniqueNonEmpty(input.slots.map((slot) => slot.kpTitle));
  const chapterLabels = uniqueNonEmpty(input.slots.map((slot) => slot.kpSubtitle));
  const reasons = buildReasons(input.slots);

  return {
    knowledgePointSummary:
      kpTitles.length > 0 ? summarizeKnowledgePoints(kpTitles) : EMPTY_KP_SUMMARY,
    chapterLabels,
    reasons: reasons.length > 0 ? reasons : ['巩固新学内容'],
    estimatedMinutes: 25,
    afterCompletion: ['立即看解析', '错题进入后续巩固', '进度页同步更新'],
    positiveEmptyState: input.canStart ? null : POSITIVE_EMPTY_STATE,
  };
}

function buildReasons(slots: readonly TodayTaskSummarySlot[]): string[] {
  const labels = slots.map((slot) => slot.poolLabel);
  const reasons: string[] = [];

  if (labels.some((label) => label.includes('错题'))) {
    reasons.push('回炉最近错题');
  }
  if (labels.some((label) => label.includes('复习'))) {
    reasons.push('安排到期复习');
  }
  if (labels.some((label) => label.includes('基础') || label.includes('新学'))) {
    reasons.push('巩固新学内容');
  }

  return reasons;
}

function summarizeKnowledgePoints(names: readonly string[]): string {
  if (names.length <= 3) return names.join('、');
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 个知识点`;
}

function uniqueNonEmpty(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}
