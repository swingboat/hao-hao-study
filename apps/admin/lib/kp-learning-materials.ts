export const MATERIAL_TYPE_ORDER = [
  'concept_explanation',
  'method_card',
  'common_mistake',
  'question_type_summary',
  'exam_trend',
  'textbook_deep_dive',
  'solution_summary',
  'study_advice',
] as const;

export type LearningMaterialTypeKey = (typeof MATERIAL_TYPE_ORDER)[number];

export const MATERIAL_TYPE_LABELS: Record<LearningMaterialTypeKey, string> = {
  concept_explanation: '概念说明',
  method_card: '解题方法',
  common_mistake: '易错提醒',
  question_type_summary: '题型总结',
  exam_trend: '考情分析',
  textbook_deep_dive: '教材深挖',
  solution_summary: '解析总结',
  study_advice: '学习建议',
};

export interface KpLearningMaterialRecord {
  id: string;
  material_type: string;
  title: string;
  content: string;
  student_summary: string | null;
  confidence: number | null;
  created_at: Date;
  source_document: { title: string } | null;
  source_unit: {
    page_no: number | null;
    slide_no?: number | null;
    question_no: string | null;
    text_snippet: string | null;
  } | null;
}

export interface KpLearningMaterialView {
  id: string;
  title: string;
  content: string;
  studentSummary: string | null;
  confidence: number | null;
  sourceLabel: string;
  textSnippet: string | null;
}

export interface KpLearningMaterialGroup {
  type: LearningMaterialTypeKey;
  label: string;
  items: KpLearningMaterialView[];
}

export function groupLearningMaterialsByType(
  materials: KpLearningMaterialRecord[],
): KpLearningMaterialGroup[] {
  const buckets = new Map<LearningMaterialTypeKey, KpLearningMaterialView[]>();
  for (const material of materials) {
    if (!isLearningMaterialType(material.material_type)) continue;
    const bucket = buckets.get(material.material_type) ?? [];
    bucket.push({
      id: material.id,
      title: material.title,
      content: material.content,
      studentSummary: material.student_summary,
      confidence: material.confidence,
      sourceLabel: sourceLabel(material),
      textSnippet: material.source_unit?.text_snippet ?? null,
    });
    buckets.set(material.material_type, bucket);
  }

  return MATERIAL_TYPE_ORDER.flatMap((type) => {
    const items = buckets.get(type);
    return items && items.length > 0 ? [{ type, label: MATERIAL_TYPE_LABELS[type], items }] : [];
  });
}

function isLearningMaterialType(value: string): value is LearningMaterialTypeKey {
  return MATERIAL_TYPE_ORDER.includes(value as LearningMaterialTypeKey);
}

function sourceLabel(material: KpLearningMaterialRecord): string {
  const parts: string[] = [];
  if (material.source_document?.title) parts.push(material.source_document.title);
  const unit = material.source_unit;
  if (unit?.page_no) parts.push(`p${unit.page_no}`);
  if (unit?.slide_no) parts.push(`slide ${unit.slide_no}`);
  if (unit?.question_no) parts.push(unit.question_no);
  return parts.join(' · ');
}
