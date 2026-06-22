type SupportingEntityKind = 'source_document' | 'learning_material';

export interface SupportingStagingForBulk {
  id: string;
  entity_kind: string;
  review_status: string;
  llm_payload: unknown;
}

export interface SupportingAcceptPlanItem {
  id: string;
  entityKind: SupportingEntityKind;
  subjectId: string;
}

export interface SupportingAcceptPlan {
  items: SupportingAcceptPlanItem[];
  skipReasons: string[];
}

const SUPPORTING_ENTITY_KINDS = new Set<string>(['source_document', 'learning_material']);

export function buildSupportingAcceptPlan(
  stagings: readonly SupportingStagingForBulk[],
  fallbackSubjectId: string,
): SupportingAcceptPlan {
  const items: SupportingAcceptPlanItem[] = [];
  const skipReasons: string[] = [];
  const fallback = fallbackSubjectId.trim();

  for (const staging of stagings) {
    if (staging.review_status !== 'pending') continue;
    if (!SUPPORTING_ENTITY_KINDS.has(staging.entity_kind)) continue;

    const entityKind = staging.entity_kind as SupportingEntityKind;
    const payload = asRecord(staging.llm_payload);
    const subjectId = stringValue(payload?._subject_id).trim() || fallback;
    if (!subjectId) {
      skipReasons.push(`${entityKindLabel(entityKind)} ${staging.id} 缺少学科`);
      continue;
    }

    items.push({ id: staging.id, entityKind, subjectId });
  }

  items.sort((left, right) => entityKindOrder(left.entityKind) - entityKindOrder(right.entityKind));
  return { items, skipReasons };
}

function entityKindOrder(kind: SupportingEntityKind): number {
  return kind === 'source_document' ? 0 : 1;
}

function entityKindLabel(kind: SupportingEntityKind): string {
  return kind === 'source_document' ? '来源资料' : '学习材料';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
