import { formatStudentDisplayText } from './display-text';

export type SessionResultKnowledgeStatus = 'needs_work' | 'review';

export interface SessionResultLearningMaterial {
  id: string;
  materialType: string;
  label: string;
  title: string;
  content: string;
  studentSummary?: string | null;
}

export interface SessionResultKnowledgeGroup {
  kpId: string;
  knowledgePointName: string;
  status: SessionResultKnowledgeStatus;
  correctCount: number;
  totalCount: number;
  materials: SessionResultLearningMaterial[];
}

export interface SessionResultMaterialQuestion {
  id: string;
  isCorrect: boolean;
  primaryKpId: string;
  kpIds: readonly string[];
}

export interface SessionResultMaterialKnowledgePoint {
  id: string;
  name: string;
}

export interface SessionResultMaterialRow {
  id: string;
  materialType: string;
  title: string;
  content: string;
  studentSummary?: string | null;
  primaryKpId?: string | null;
  kpIds: readonly string[];
  createdAt: Date;
}

const MATERIAL_LABELS: Record<string, string> = {
  common_mistake: '易错提醒',
  method_card: '解题方法',
  question_type_summary: '题型总结',
  solution_summary: '解析总结',
  concept_explanation: '概念回顾',
  textbook_deep_dive: '教材深挖',
  exam_trend: '考情提示',
  study_advice: '学习建议',
};

const NEEDS_WORK_PRIORITY = [
  'common_mistake',
  'method_card',
  'solution_summary',
  'question_type_summary',
  'concept_explanation',
  'textbook_deep_dive',
  'exam_trend',
  'study_advice',
];

const REVIEW_PRIORITY = [
  'concept_explanation',
  'question_type_summary',
  'method_card',
  'solution_summary',
  'common_mistake',
  'textbook_deep_dive',
  'exam_trend',
  'study_advice',
];

const NEEDS_WORK_MATERIAL_LIMIT = 5;
const REVIEW_MATERIAL_LIMIT = 3;

interface KnowledgePointStats {
  kpId: string;
  knowledgePointName: string;
  correctCount: number;
  totalCount: number;
  firstSeenIndex: number;
}

export function getLearningMaterialLabel(materialType: string): string {
  return MATERIAL_LABELS[materialType] ?? '学习材料';
}

export function collectSessionKnowledgePointIds(
  questions: readonly { primary_kp_id: string; kp_ids?: readonly string[] }[],
  unlockedKpIds: readonly string[],
): string[] {
  const unlocked = new Set(unlockedKpIds);
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const question of questions) {
    for (const kpId of [question.primary_kp_id, ...(question.kp_ids ?? [])]) {
      if (!kpId || !unlocked.has(kpId) || seen.has(kpId)) continue;
      seen.add(kpId);
      ids.push(kpId);
    }
  }

  return ids;
}

export function buildSessionResultKnowledgeGroups(input: {
  questions: readonly SessionResultMaterialQuestion[];
  unlockedKpIds: readonly string[];
  knowledgePoints: readonly SessionResultMaterialKnowledgePoint[];
  materials: readonly SessionResultMaterialRow[];
}): SessionResultKnowledgeGroup[] {
  if (input.questions.length === 0 || input.materials.length === 0) return [];

  const unlocked = new Set(input.unlockedKpIds);
  const kpNameById = new Map(input.knowledgePoints.map((kp) => [kp.id, kp.name]));
  const statsByKp = new Map<string, KnowledgePointStats>();

  input.questions.forEach((question, questionIndex) => {
    const questionKpIds = uniqueKpIds([question.primaryKpId, ...question.kpIds]).filter(
      (kpId) => unlocked.has(kpId) && kpNameById.has(kpId),
    );

    for (const kpId of questionKpIds) {
      const stats = statsByKp.get(kpId) ?? {
        kpId,
        knowledgePointName: kpNameById.get(kpId) ?? '本次知识点',
        correctCount: 0,
        totalCount: 0,
        firstSeenIndex: questionIndex,
      };
      stats.totalCount += 1;
      if (question.isCorrect) stats.correctCount += 1;
      stats.firstSeenIndex = Math.min(stats.firstSeenIndex, questionIndex);
      statsByKp.set(kpId, stats);
    }
  });

  if (statsByKp.size === 0) return [];

  const materialsByKp = new Map<string, SessionResultMaterialRow[]>();
  for (const material of input.materials) {
    for (const kpId of getMatchingMaterialKpIds(material, statsByKp)) {
      const current = materialsByKp.get(kpId) ?? [];
      if (!current.some((item) => item.id === material.id)) {
        current.push(material);
      }
      materialsByKp.set(kpId, current);
    }
  }

  return [...statsByKp.values()]
    .map((stats) => {
      const status: SessionResultKnowledgeStatus =
        stats.correctCount < stats.totalCount ? 'needs_work' : 'review';
      const sortedMaterials = sortMaterialsForStatus(materialsByKp.get(stats.kpId) ?? [], status);
      const limit = status === 'needs_work' ? NEEDS_WORK_MATERIAL_LIMIT : REVIEW_MATERIAL_LIMIT;

      return {
        kpId: stats.kpId,
        knowledgePointName: stats.knowledgePointName,
        status,
        correctCount: stats.correctCount,
        totalCount: stats.totalCount,
        materials: sortedMaterials.slice(0, limit).map(toSessionResultLearningMaterial),
        firstSeenIndex: stats.firstSeenIndex,
      };
    })
    .filter((group) => group.materials.length > 0)
    .sort((a, b) => {
      const statusOrder = statusRank(a.status) - statusRank(b.status);
      if (statusOrder !== 0) return statusOrder;

      const wrongOrder = wrongCount(b) - wrongCount(a);
      if (wrongOrder !== 0) return wrongOrder;

      const volumeOrder = b.totalCount - a.totalCount;
      if (volumeOrder !== 0) return volumeOrder;

      return a.firstSeenIndex - b.firstSeenIndex;
    })
    .map(({ firstSeenIndex: _firstSeenIndex, ...group }) => group);
}

function getMatchingMaterialKpIds(
  material: SessionResultMaterialRow,
  statsByKp: ReadonlyMap<string, KnowledgePointStats>,
): string[] {
  const ids = uniqueKpIds([material.primaryKpId ?? '', ...material.kpIds]);
  return ids.filter((kpId) => statsByKp.has(kpId));
}

function sortMaterialsForStatus(
  materials: readonly SessionResultMaterialRow[],
  status: SessionResultKnowledgeStatus,
): SessionResultMaterialRow[] {
  const priority = status === 'needs_work' ? NEEDS_WORK_PRIORITY : REVIEW_PRIORITY;

  return [...materials].sort((a, b) => {
    const typeOrder =
      materialTypeRank(a.materialType, priority) - materialTypeRank(b.materialType, priority);
    if (typeOrder !== 0) return typeOrder;

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function toSessionResultLearningMaterial(
  material: SessionResultMaterialRow,
): SessionResultLearningMaterial {
  return {
    id: material.id,
    materialType: material.materialType,
    label: getLearningMaterialLabel(material.materialType),
    title: formatStudentDisplayText(material.title),
    content: formatStudentDisplayText(material.content),
    studentSummary: material.studentSummary
      ? formatStudentDisplayText(material.studentSummary)
      : material.studentSummary,
  };
}

function materialTypeRank(materialType: string, priority: readonly string[]): number {
  const index = priority.indexOf(materialType);
  return index === -1 ? priority.length : index;
}

function statusRank(status: SessionResultKnowledgeStatus): number {
  return status === 'needs_work' ? 0 : 1;
}

function wrongCount(group: { correctCount: number; totalCount: number }): number {
  return group.totalCount - group.correctCount;
}

function uniqueKpIds(kpIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kpId of kpIds) {
    if (!kpId || seen.has(kpId)) continue;
    seen.add(kpId);
    result.push(kpId);
  }
  return result;
}
