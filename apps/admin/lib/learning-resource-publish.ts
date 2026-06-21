import type {
  Grade,
  LearningMaterialType,
  Prisma,
  SourceDocumentType,
  SourceUnitKind,
  Stage,
} from '@hao/db';

type Tx = Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

const SOURCE_DOCUMENT_TYPES = new Set([
  'textbook',
  'lesson_handout',
  'workbook',
  'question_pack',
  'exam_paper',
  'answer_book',
  'mixed_material',
]);
const SOURCE_UNIT_KINDS = new Set([
  'page',
  'slide',
  'question_region',
  'explanation_region',
  'text_block',
]);
const LEARNING_MATERIAL_TYPES = new Set([
  'concept_explanation',
  'method_card',
  'common_mistake',
  'question_type_summary',
  'exam_trend',
  'textbook_deep_dive',
  'solution_summary',
  'study_advice',
]);
const STAGES = new Set(['primary', 'junior', 'senior']);
const GRADES = new Set(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12']);

export interface SourceRefForPublish {
  page?: number | null;
  slide_no?: number | null;
  question_no?: string | null;
  text_snippet?: string | null;
}

export async function ensurePublishedSourceDocumentForUpload(
  tx: Tx,
  opts: {
    uploadId: string;
    subjectId: string;
    reviewedBy: string;
  },
): Promise<{ sourceDocumentId: string; sourcePayload: JsonRecord }> {
  const staging = await tx.llm_parse_staging.findFirst({
    where: { upload_id: opts.uploadId, entity_kind: 'source_document' },
    orderBy: { created_at: 'asc' },
  });
  if (staging?.published_id) {
    return {
      sourceDocumentId: staging.published_id,
      sourcePayload: asRecord(staging.llm_payload) ?? {},
    };
  }

  const sourcePayload = asRecord(staging?.llm_payload) ?? {
    source_type: 'mixed_material',
    title: '未命名学习资料',
    _subject_id: opts.subjectId,
  };
  const sourceDocument = await tx.source_document.create({
    data: {
      upload_id: opts.uploadId,
      source_type: sourceDocumentType(sourcePayload.source_type),
      title: stringValue(sourcePayload.title) || '未命名学习资料',
      subject_id: stringValue(sourcePayload._subject_id) || opts.subjectId,
      stage: optionalStage(sourcePayload.stage),
      grade: optionalGrade(sourcePayload.grade),
      provider: optionalString(sourcePayload.provider),
      publisher: optionalString(sourcePayload.publisher),
      year: optionalInt(sourcePayload.year),
      season: optionalString(sourcePayload.season),
      exam_name: optionalString(sourcePayload.exam_name),
      paper_name: optionalString(sourcePayload.paper_name),
      region: optionalString(sourcePayload.region),
      lesson_no: optionalString(sourcePayload.lesson_no),
      page_count: optionalInt(sourcePayload.page_count),
      metadata: toJson({ llm_payload: sourcePayload }) as Prisma.InputJsonValue,
    },
  });

  const sourceUnits = normalizeSourceUnits(sourcePayload._source_units);
  if (sourceUnits.length > 0) {
    await tx.source_unit.createMany({
      data: sourceUnits.map((unit) => ({
        source_document_id: sourceDocument.id,
        unit_kind: sourceUnitKind(unit.unit_kind),
        page_no: optionalInt(unit.page_no),
        slide_no: optionalInt(unit.slide_no),
        question_no: optionalString(unit.question_no),
        bbox: Array.isArray(unit.bbox) ? (unit.bbox as Prisma.InputJsonValue) : undefined,
        text_snippet: optionalString(unit.text_snippet),
      })),
    });
  }

  if (staging) {
    await tx.llm_parse_staging.update({
      where: { id: staging.id },
      data: {
        review_status: 'accepted',
        review_payload: sourcePayload as Prisma.InputJsonValue,
        reviewed_by: opts.reviewedBy,
        reviewed_at: new Date(),
        published_id: sourceDocument.id,
      },
    });
  }

  return { sourceDocumentId: sourceDocument.id, sourcePayload };
}

export async function createQuestionSourceForPayload(
  tx: Tx,
  opts: {
    questionId: string;
    sourceDocumentId: string;
    payload: unknown;
  },
): Promise<void> {
  const ref = sourceRefFromPayload(opts.payload);
  const sourceUnit = await findOrCreateSourceUnitForRef(tx, opts.sourceDocumentId, ref);
  await tx.question_source.upsert({
    where: {
      question_id_source_document_id_role: {
        question_id: opts.questionId,
        source_document_id: opts.sourceDocumentId,
        role: 'origin',
      },
    },
    update: {
      source_unit_id: sourceUnit?.id ?? null,
      question_no: ref.question_no ?? null,
      page_no: ref.page ?? null,
    },
    create: {
      question_id: opts.questionId,
      source_document_id: opts.sourceDocumentId,
      source_unit_id: sourceUnit?.id ?? null,
      question_no: ref.question_no ?? null,
      page_no: ref.page ?? null,
      role: 'origin',
    },
  });
}

export async function publishLearningMaterialStaging(
  tx: Tx,
  opts: {
    stagingId: string;
    subjectId: string;
    reviewedBy: string;
  },
): Promise<string> {
  const staging = await tx.llm_parse_staging.findUnique({
    where: { id: opts.stagingId },
    include: { upload: true },
  });
  if (!staging) throw new Error('staging 不存在');
  if (staging.entity_kind !== 'learning_material') {
    throw new Error('该 staging 不是 learning_material');
  }
  const payload = asRecord(staging.llm_payload) ?? {};
  const kpIds = await resolveLearningMaterialKpIds(tx, payload, opts.subjectId);
  if (kpIds.length === 0) {
    throw new Error('学习材料未匹配到正式知识点，请先处理 unmapped 诊断信息');
  }
  const { sourceDocumentId } = await ensurePublishedSourceDocumentForUpload(tx, {
    uploadId: staging.upload_id,
    subjectId: opts.subjectId,
    reviewedBy: opts.reviewedBy,
  });
  const sourceUnit = await findOrCreateSourceUnitForRef(
    tx,
    sourceDocumentId,
    sourceRefFromPayload(payload),
  );

  const material = await tx.learning_material.create({
    data: {
      material_type: learningMaterialType(payload.material_type),
      title: stringValue(payload.title).slice(0, 80) || '未命名学习材料',
      content: stringValue(payload.content).slice(0, 3000),
      student_summary: optionalString(payload.student_summary),
      subject_id: opts.subjectId,
      kp_ids: kpIds,
      primary_kp_id: kpIds[0] ?? null,
      source_document_id: sourceDocumentId,
      source_unit_id: sourceUnit?.id ?? null,
      confidence: optionalFloat(payload.confidence),
    },
  });

  await tx.llm_parse_staging.update({
    where: { id: staging.id },
    data: {
      review_status: 'accepted',
      review_payload: {
        ...payload,
        subject_id: opts.subjectId,
        kp_ids: kpIds,
        primary_kp_id: kpIds[0] ?? null,
        source_document_id: sourceDocumentId,
        source_unit_id: sourceUnit?.id ?? null,
      } as Prisma.InputJsonValue,
      reviewed_by: opts.reviewedBy,
      reviewed_at: new Date(),
      published_id: material.id,
    },
  });

  return material.id;
}

export function sourceRefFromPayload(payload: unknown): SourceRefForPublish {
  const record = asRecord(payload) ?? {};
  const sourceRef = asRecord(record.source_ref);
  const sourceHint = asRecord(record.source_hint);
  return {
    page: optionalInt(sourceRef?.page ?? sourceHint?.page),
    slide_no: optionalInt(sourceRef?.slide_no ?? sourceHint?.slide_no),
    question_no: optionalString(sourceRef?.question_no ?? sourceHint?.question_no),
    text_snippet: optionalString(sourceRef?.text_snippet ?? sourceHint?.text_snippet),
  };
}

async function findOrCreateSourceUnitForRef(
  tx: Tx,
  sourceDocumentId: string,
  ref: SourceRefForPublish,
): Promise<{ id: string } | null> {
  if (!ref.page && !ref.slide_no && !ref.question_no && !ref.text_snippet) return null;
  const existing = await tx.source_unit.findFirst({
    where: {
      source_document_id: sourceDocumentId,
      page_no: ref.page ?? null,
      slide_no: ref.slide_no ?? null,
      question_no: ref.question_no ?? null,
    },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.source_unit.create({
    data: {
      source_document_id: sourceDocumentId,
      unit_kind: ref.question_no ? 'question_region' : ref.slide_no ? 'slide' : 'page',
      page_no: ref.page ?? null,
      slide_no: ref.slide_no ?? null,
      question_no: ref.question_no ?? null,
      text_snippet: ref.text_snippet ?? null,
    },
    select: { id: true },
  });
}

async function resolveLearningMaterialKpIds(
  tx: Tx,
  payload: JsonRecord,
  subjectId: string,
): Promise<string[]> {
  const candidateIds = [
    optionalString(payload._knowledge_point_id),
    ...stringArray(payload.kp_ids),
  ].filter((id): id is string => Boolean(id));
  const uniqueCandidateIds = Array.from(new Set(candidateIds));
  if (uniqueCandidateIds.length > 0) {
    const rows = await tx.knowledge_point.findMany({
      where: { id: { in: uniqueCandidateIds }, subject_id: subjectId },
      select: { id: true },
    });
    if (rows.length > 0) return rows.map((row) => row.id);
  }

  const hints = stringArray(payload.kp_hints);
  if (hints.length === 0) return [];
  const rows = await tx.knowledge_point.findMany({
    where: { subject_id: subjectId, name: { in: hints } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

function normalizeSourceUnits(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item)).filter((item): item is JsonRecord => Boolean(item));
}

function sourceDocumentType(value: unknown): SourceDocumentType {
  const text = stringValue(value);
  return (SOURCE_DOCUMENT_TYPES.has(text) ? text : 'mixed_material') as SourceDocumentType;
}

function sourceUnitKind(value: unknown): SourceUnitKind {
  const text = stringValue(value);
  return (SOURCE_UNIT_KINDS.has(text) ? text : 'page') as SourceUnitKind;
}

function learningMaterialType(value: unknown): LearningMaterialType {
  const text = stringValue(value);
  return (LEARNING_MATERIAL_TYPES.has(text) ? text : 'concept_explanation') as LearningMaterialType;
}

function optionalStage(value: unknown): Stage | null {
  const text = stringValue(value);
  return STAGES.has(text) ? (text as Stage) : null;
}

function optionalGrade(value: unknown): Grade | null {
  const text = stringValue(value);
  return GRADES.has(text) ? (text as Grade) : null;
}

function optionalString(value: unknown): string | null {
  const text = stringValue(value).trim();
  return text || null;
}

function optionalInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function optionalFloat(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter((item) => item.length > 0);
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
