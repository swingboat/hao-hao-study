import {
  type TextbookStage,
  type UpsertPublishedKnowledgePointTextbookMappingInput,
  type UpsertTextbookScopeResult,
  upsertPublishedKnowledgePointTextbookMapping,
} from '@hao/db';

type TextbookMappingDb = Parameters<typeof upsertPublishedKnowledgePointTextbookMapping>[0];
type UpsertTextbookMapping = (
  db: TextbookMappingDb,
  input: UpsertPublishedKnowledgePointTextbookMappingInput,
) => Promise<UpsertTextbookScopeResult>;

interface AdminTextbookMappingUpload {
  id: string;
  original_name?: string | null;
}

interface AdminTextbookMappingSubject {
  id: string;
  name?: string | null;
  stage: string;
}

interface AdminTextbookMappingKnowledgePoint {
  id: string;
  name: string;
  subject_id: string;
  chapter_no: string | null;
}

export interface UpsertAdminKnowledgePointTextbookMappingInput {
  db: unknown;
  upload: AdminTextbookMappingUpload;
  subject: AdminTextbookMappingSubject;
  knowledgePoint: AdminTextbookMappingKnowledgePoint;
  reviewPayload?: unknown;
  llmPayload?: unknown;
  upsertMapping?: UpsertTextbookMapping;
}

export async function upsertAdminKnowledgePointTextbookMapping({
  db,
  upload,
  subject,
  knowledgePoint,
  reviewPayload,
  llmPayload,
  upsertMapping = upsertPublishedKnowledgePointTextbookMapping,
}: UpsertAdminKnowledgePointTextbookMappingInput): Promise<UpsertTextbookScopeResult> {
  return upsertMapping(db as TextbookMappingDb, {
    upload: {
      id: upload.id,
      original_name: upload.original_name ?? null,
    },
    subject: {
      id: subject.id,
      name: subject.name ?? null,
      stage: toTextbookStage(subject.stage),
    },
    knowledgePoint,
    payload: mergeMappingPayload(reviewPayload, llmPayload),
  });
}

function mergeMappingPayload(reviewPayload: unknown, llmPayload: unknown): unknown {
  if (isRecord(llmPayload) && isRecord(reviewPayload)) {
    return { ...llmPayload, ...reviewPayload };
  }
  return reviewPayload ?? llmPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toTextbookStage(stage: string): TextbookStage {
  if (stage === 'primary' || stage === 'junior' || stage === 'senior') {
    return stage;
  }
  throw new Error(`unsupported subject stage: ${stage}`);
}
