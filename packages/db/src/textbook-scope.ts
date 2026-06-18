export type TextbookStage = 'primary' | 'junior' | 'senior';

export const UNASSIGNED_TEXTBOOK_CHAPTER_NO = '未分章节';

export const DEFAULT_MATH_SENIOR_TEXTBOOK = {
  id: '00000000-0000-4000-8000-000000000101',
  subject_id: 'math_senior',
  stage: 'senior' as const,
  title: '高中数学默认教材',
  edition: null,
  publisher: null,
  volume: null,
  source_upload_id: null,
};

export interface TextbookKnowledgePointInput {
  id: string;
  name: string;
  subject_id: string;
  chapter_no: string | null;
  chapter_title?: string | null;
  source_pages?: number[];
}

export interface TextbookInput {
  id?: string;
  subject_id: string;
  stage: TextbookStage;
  title: string;
  edition?: string | null;
  publisher?: string | null;
  volume?: string | null;
  source_upload_id?: string | null;
}

export interface TextbookUploadInput {
  id: string;
  original_name?: string | null;
}

export interface TextbookSubjectInput {
  id: string;
  name?: string | null;
  stage: TextbookStage;
}

export interface TextbookScopePlanChapter {
  textbook_id: string;
  chapter_no: string;
  title: string;
  sort_order: number;
}

export interface TextbookScopePlanMapping {
  textbook_id: string;
  chapter_no: string;
  kp_id: string;
  sort_order: number;
  source_pages: number[];
}

export interface TextbookScopePlan {
  chapters: TextbookScopePlanChapter[];
  mappings: TextbookScopePlanMapping[];
}

export interface UpsertTextbookScopeInput {
  textbook: TextbookInput;
  knowledgePoints: TextbookKnowledgePointInput[];
}

export interface UpsertPublishedKnowledgePointTextbookMappingInput {
  upload: TextbookUploadInput;
  subject: TextbookSubjectInput;
  knowledgePoint: {
    id: string;
    name: string;
    subject_id: string;
    chapter_no: string | null;
  };
  payload?: unknown;
  sortOrder?: number;
}

export interface UpsertTextbookScopeResult {
  textbookId: string;
  chapterCount: number;
  mappingCount: number;
}

export interface StudentTextbookScope {
  primary_subject_id: string;
  stage: TextbookStage;
  unlocked_kp_ids: string[];
}

export interface TextbookScopeDb {
  knowledge_point: {
    findMany(args: unknown): Promise<TextbookKnowledgePointInput[]>;
  };
  textbook: {
    findMany(args: unknown): Promise<unknown[]>;
    upsert(args: unknown): Promise<{ id: string }>;
  };
  textbook_chapter: {
    count(args: unknown): Promise<number>;
    upsert(args: unknown): Promise<{ id: string; chapter_no: string }>;
  };
  textbook_knowledge_point: {
    findMany(args: unknown): Promise<unknown[]>;
    count(args: unknown): Promise<number>;
    upsert(args: unknown): Promise<unknown>;
  };
}

const chapterNoCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function buildTextbookScopePlan({
  textbookId,
  knowledgePoints,
}: {
  textbookId: string;
  knowledgePoints: TextbookKnowledgePointInput[];
}): TextbookScopePlan {
  const orderedKps = knowledgePoints
    .map((kp, index) => ({ kp, index }))
    .sort(
      (left, right) =>
        compareChapterNo(
          normalizeChapterNo(left.kp.chapter_no),
          normalizeChapterNo(right.kp.chapter_no),
        ) || left.index - right.index,
    )
    .map(({ kp }) => kp);
  const chapterByNo = new Map<string, TextbookScopePlanChapter>();
  const mappings: TextbookScopePlanMapping[] = [];

  for (const kp of orderedKps) {
    const chapterNo = normalizeChapterNo(kp.chapter_no);
    if (!chapterByNo.has(chapterNo)) {
      chapterByNo.set(chapterNo, {
        textbook_id: textbookId,
        chapter_no: chapterNo,
        title: normalizeChapterTitle(kp.chapter_title, chapterNo),
        sort_order: chapterByNo.size + 1,
      });
    }
    mappings.push({
      textbook_id: textbookId,
      chapter_no: chapterNo,
      kp_id: kp.id,
      sort_order: mappings.length + 1,
      source_pages: normalizePageNumbers(kp.source_pages ?? []),
    });
  }

  return {
    chapters: Array.from(chapterByNo.values()),
    mappings,
  };
}

export function sourcePagesFromKnowledgePointPayload(payload: unknown): number[] {
  const record = asRecord(payload);
  if (!record) return [];
  const pages =
    record.source_pages ??
    record.pages ??
    record.source_page ??
    record.page_number ??
    record.page ??
    [];
  return normalizePageNumbers(Array.isArray(pages) ? pages : [pages]);
}

export function textbookInputFromUpload(input: {
  upload: TextbookUploadInput;
  subject: TextbookSubjectInput;
}): TextbookInput {
  return {
    subject_id: input.subject.id,
    stage: input.subject.stage,
    title:
      textbookTitleFromUploadName(input.upload.original_name) ??
      `${input.subject.name ?? input.subject.id}教材`,
    edition: null,
    publisher: null,
    volume: null,
    source_upload_id: input.upload.id,
  };
}

export async function upsertDefaultMathSeniorTextbookScope(
  db: TextbookScopeDb,
): Promise<UpsertTextbookScopeResult> {
  const knowledgePoints = await db.knowledge_point.findMany({
    where: { subject_id: DEFAULT_MATH_SENIOR_TEXTBOOK.subject_id },
    select: { id: true, name: true, subject_id: true, chapter_no: true },
    orderBy: [{ chapter_no: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });

  return upsertTextbookScope(db, {
    textbook: DEFAULT_MATH_SENIOR_TEXTBOOK,
    knowledgePoints,
  });
}

export async function upsertTextbookScope(
  db: TextbookScopeDb,
  input: UpsertTextbookScopeInput,
): Promise<UpsertTextbookScopeResult> {
  const textbook = await db.textbook.upsert({
    where: textbookWhereUnique(input.textbook),
    update: textbookWriteData(input.textbook),
    create: textbookWriteData(input.textbook),
  });
  const plan = buildTextbookScopePlan({
    textbookId: textbook.id,
    knowledgePoints: input.knowledgePoints,
  });
  const chapterIdByNo = new Map<string, string>();

  for (const chapter of plan.chapters) {
    const row = await db.textbook_chapter.upsert({
      where: {
        textbook_id_chapter_no: {
          textbook_id: textbook.id,
          chapter_no: chapter.chapter_no,
        },
      },
      update: {
        title: chapter.title,
        sort_order: chapter.sort_order,
      },
      create: {
        textbook_id: textbook.id,
        chapter_no: chapter.chapter_no,
        title: chapter.title,
        sort_order: chapter.sort_order,
      },
    });
    chapterIdByNo.set(row.chapter_no, row.id);
  }

  for (const mapping of plan.mappings) {
    await db.textbook_knowledge_point.upsert({
      where: {
        textbook_id_kp_id: {
          textbook_id: textbook.id,
          kp_id: mapping.kp_id,
        },
      },
      update: {
        chapter_id: chapterIdByNo.get(mapping.chapter_no) ?? null,
        sort_order: mapping.sort_order,
        source_pages: mapping.source_pages,
      },
      create: {
        textbook_id: textbook.id,
        chapter_id: chapterIdByNo.get(mapping.chapter_no) ?? null,
        kp_id: mapping.kp_id,
        sort_order: mapping.sort_order,
        source_pages: mapping.source_pages,
      },
    });
  }

  return {
    textbookId: textbook.id,
    chapterCount: plan.chapters.length,
    mappingCount: plan.mappings.length,
  };
}

export async function upsertPublishedKnowledgePointTextbookMapping(
  db: TextbookScopeDb,
  input: UpsertPublishedKnowledgePointTextbookMappingInput,
): Promise<UpsertTextbookScopeResult> {
  const textbook = await db.textbook.upsert({
    where: { source_upload_id: input.upload.id },
    update: textbookWriteData(textbookInputFromUpload(input)),
    create: textbookWriteData(textbookInputFromUpload(input)),
  });
  const chapterNo = normalizeChapterNo(input.knowledgePoint.chapter_no);
  const chapterTitle = chapterTitleFromPayload(input.payload) ?? chapterNo;
  const chapter = await db.textbook_chapter.upsert({
    where: {
      textbook_id_chapter_no: {
        textbook_id: textbook.id,
        chapter_no: chapterNo,
      },
    },
    update: { title: chapterTitle },
    create: {
      textbook_id: textbook.id,
      chapter_no: chapterNo,
      title: chapterTitle,
      sort_order: (await db.textbook_chapter.count({ where: { textbook_id: textbook.id } })) + 1,
    },
  });
  const sortOrder =
    input.sortOrder ??
    (await db.textbook_knowledge_point.count({ where: { textbook_id: textbook.id } })) + 1;
  await db.textbook_knowledge_point.upsert({
    where: {
      textbook_id_kp_id: {
        textbook_id: textbook.id,
        kp_id: input.knowledgePoint.id,
      },
    },
    update: {
      chapter_id: chapter.id,
      sort_order: sortOrder,
      source_pages: sourcePagesFromKnowledgePointPayload(input.payload),
    },
    create: {
      textbook_id: textbook.id,
      chapter_id: chapter.id,
      kp_id: input.knowledgePoint.id,
      sort_order: sortOrder,
      source_pages: sourcePagesFromKnowledgePointPayload(input.payload),
    },
  });

  return { textbookId: textbook.id, chapterCount: 1, mappingCount: 1 };
}

export async function getTextbooksForStudentScope(
  db: TextbookScopeDb,
  student: StudentTextbookScope,
): Promise<unknown[]> {
  if (student.unlocked_kp_ids.length === 0) return [];
  return db.textbook.findMany({
    where: {
      subject_id: student.primary_subject_id,
      stage: student.stage,
      knowledge_points: {
        some: {
          kp_id: { in: student.unlocked_kp_ids },
        },
      },
    },
    select: {
      id: true,
      subject_id: true,
      stage: true,
      title: true,
      edition: true,
      publisher: true,
      volume: true,
      created_at: true,
    },
    orderBy: [{ created_at: 'asc' }, { title: 'asc' }],
  });
}

export async function getTextbookProgressScope(
  db: TextbookScopeDb,
  input: { textbookId: string; unlockedKpIds: string[] },
): Promise<unknown[]> {
  if (input.unlockedKpIds.length === 0) return [];
  return db.textbook_knowledge_point.findMany({
    where: {
      textbook_id: input.textbookId,
      kp_id: { in: input.unlockedKpIds },
    },
    select: {
      kp_id: true,
      sort_order: true,
      source_pages: true,
      chapter: {
        select: {
          id: true,
          chapter_no: true,
          title: true,
          sort_order: true,
        },
      },
      knowledge_point: {
        select: {
          id: true,
          name: true,
          subject_id: true,
          chapter_no: true,
        },
      },
    },
    orderBy: [{ sort_order: 'asc' }],
  });
}

function textbookWhereUnique(textbook: TextbookInput) {
  if (textbook.id) return { id: textbook.id };
  if (textbook.source_upload_id) return { source_upload_id: textbook.source_upload_id };
  throw new Error('textbook.id or textbook.source_upload_id is required for upsert');
}

function textbookWriteData(textbook: TextbookInput) {
  return {
    ...(textbook.id ? { id: textbook.id } : {}),
    subject_id: textbook.subject_id,
    stage: textbook.stage,
    title: textbook.title,
    edition: textbook.edition ?? null,
    publisher: textbook.publisher ?? null,
    volume: textbook.volume ?? null,
    source_upload_id: textbook.source_upload_id ?? null,
  };
}

function textbookTitleFromUploadName(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.replace(/\.(pdf|docx?|png|jpe?g)$/i, '').trim() || text;
}

function chapterTitleFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  const value = record.chapter_title ?? record.section_title ?? record.title;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeChapterNo(value: string | null | undefined): string {
  const text = value?.trim();
  return text || UNASSIGNED_TEXTBOOK_CHAPTER_NO;
}

function normalizeChapterTitle(value: string | null | undefined, chapterNo: string): string {
  const text = value?.trim();
  return text || chapterNo;
}

function compareChapterNo(left: string, right: string): number {
  if (left === right) return 0;
  if (left === UNASSIGNED_TEXTBOOK_CHAPTER_NO) return 1;
  if (right === UNASSIGNED_TEXTBOOK_CHAPTER_NO) return -1;
  return chapterNoCollator.compare(left, right);
}

function normalizePageNumbers(values: unknown[]): number[] {
  return Array.from(
    new Set(
      values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0),
    ),
  ).sort((left, right) => left - right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
