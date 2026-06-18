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

export interface PublishedKnowledgePointStagingInput {
  id: string;
  published_id: string | null;
  llm_payload: unknown;
  review_payload?: unknown | null;
}

export interface UpsertTextbookScopeResult {
  textbookId: string;
  chapterCount: number;
  mappingCount: number;
}

export interface BackfilledPublishedTextbookScope {
  uploadId: string;
  textbookId: string;
  title: string;
  volume: string | null;
  chapterCount: number;
  mappingCount: number;
}

export interface BackfillPublishedTextbookScopesResult {
  textbookCount: number;
  chapterCount: number;
  mappingCount: number;
  textbooks: BackfilledPublishedTextbookScope[];
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
  subject: {
    findUnique(args: unknown): Promise<TextbookSubjectInput | null>;
  };
  content_upload: {
    findMany(args: unknown): Promise<TextbookUploadInput[]>;
  };
  llm_parse_staging: {
    findMany(args: unknown): Promise<PublishedKnowledgePointStagingInput[]>;
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
  const pageValues = Array.isArray(pages) ? pages : [pages];
  const rangePages = sourcePageRangeFromRecord(record);
  return normalizePageNumbers([...pageValues, ...rangePages]);
}

export function buildPublishedTextbookKnowledgePointInputs(input: {
  stagings: PublishedKnowledgePointStagingInput[];
  knowledgePointById: Map<string, TextbookKnowledgePointInput>;
}): TextbookKnowledgePointInput[] {
  const seenKpIds = new Set<string>();
  const knowledgePoints: TextbookKnowledgePointInput[] = [];

  for (const staging of input.stagings) {
    const publishedId = staging.published_id?.trim();
    if (!publishedId || seenKpIds.has(publishedId)) continue;

    const knowledgePoint = input.knowledgePointById.get(publishedId);
    if (!knowledgePoint) continue;

    const payload = publishedKnowledgePointPayload(staging);
    knowledgePoints.push({
      id: knowledgePoint.id,
      name: knowledgePoint.name,
      subject_id: knowledgePoint.subject_id,
      chapter_no: chapterNoFromPayload(payload) ?? knowledgePoint.chapter_no,
      chapter_title: chapterTitleFromPayload(payload),
      source_pages: sourcePagesFromKnowledgePointPayload(payload),
    });
    seenKpIds.add(publishedId);
  }

  return knowledgePoints;
}

export function textbookInputFromUpload(input: {
  upload: TextbookUploadInput;
  subject: TextbookSubjectInput;
}): TextbookInput {
  const titleParts = textbookTitlePartsFromUploadName(input.upload.original_name);
  return {
    subject_id: input.subject.id,
    stage: input.subject.stage,
    title: titleParts.title ?? `${input.subject.name ?? input.subject.id}教材`,
    edition: null,
    publisher: null,
    volume: titleParts.volume,
    source_upload_id: input.upload.id,
  };
}

export function textbookTitlePartsFromUploadName(value: string | null | undefined): {
  title: string | null;
  volume: string | null;
} {
  const title = textbookTitleFromUploadName(value);
  return {
    title,
    volume: title ? textbookVolumeFromTitle(title) : null,
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

export async function backfillPublishedTextbookScopes(
  db: TextbookScopeDb,
): Promise<BackfillPublishedTextbookScopesResult> {
  const uploads = await db.content_upload.findMany({
    where: {
      file_type: 'textbook',
      status: 'parsed',
    },
    select: {
      id: true,
      original_name: true,
      created_at: true,
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  const textbooks: BackfilledPublishedTextbookScope[] = [];

  for (const upload of uploads) {
    const result = await backfillPublishedTextbookScopeForUpload(db, upload);
    if (result) textbooks.push(result);
  }

  return {
    textbookCount: textbooks.length,
    chapterCount: textbooks.reduce((total, textbook) => total + textbook.chapterCount, 0),
    mappingCount: textbooks.reduce((total, textbook) => total + textbook.mappingCount, 0),
    textbooks,
  };
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
  const where = {
    subject_id: student.primary_subject_id,
    stage: student.stage,
    knowledge_points: {
      some: {
        kp_id: { in: student.unlocked_kp_ids },
      },
    },
  };
  const select = {
    id: true,
    subject_id: true,
    stage: true,
    title: true,
    edition: true,
    publisher: true,
    volume: true,
    created_at: true,
  };
  const orderBy = [{ created_at: 'asc' }, { title: 'asc' }];

  const realTextbooks = await db.textbook.findMany({
    where: {
      ...where,
      source_upload_id: { not: null },
    },
    select,
    orderBy,
  });
  if (realTextbooks.length > 0) return realTextbooks;

  return db.textbook.findMany({
    where,
    select,
    orderBy,
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

async function backfillPublishedTextbookScopeForUpload(
  db: TextbookScopeDb,
  upload: TextbookUploadInput,
): Promise<BackfilledPublishedTextbookScope | null> {
  const stagings = await db.llm_parse_staging.findMany({
    where: {
      upload_id: upload.id,
      entity_kind: 'knowledge_point',
      published_id: { not: null },
    },
    select: {
      id: true,
      published_id: true,
      llm_payload: true,
      review_payload: true,
      created_at: true,
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  const publishedIds = uniqueNonEmptyStrings(stagings.map((staging) => staging.published_id));
  if (publishedIds.length === 0) return null;

  const publishedKnowledgePoints = await db.knowledge_point.findMany({
    where: { id: { in: publishedIds } },
    select: { id: true, name: true, subject_id: true, chapter_no: true },
  });
  const knowledgePointById = new Map(publishedKnowledgePoints.map((kp) => [kp.id, kp]));
  const knowledgePoints = buildPublishedTextbookKnowledgePointInputs({
    stagings,
    knowledgePointById,
  });
  if (knowledgePoints.length === 0) return null;

  const subjectId =
    knowledgePoints[0]?.subject_id ??
    firstNonNull(
      stagings.map((staging) => subjectIdFromPayload(publishedKnowledgePointPayload(staging))),
    );
  if (!subjectId) return null;

  const subject = await db.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, name: true, stage: true },
  });
  if (!subject) {
    throw new Error(`Missing subject ${subjectId} for textbook upload ${upload.id}`);
  }

  const textbookInput = textbookInputFromUpload({ upload, subject });
  const result = await upsertTextbookScope(db, {
    textbook: textbookInput,
    knowledgePoints,
  });

  return {
    uploadId: upload.id,
    textbookId: result.textbookId,
    title: textbookInput.title,
    volume: textbookInput.volume ?? null,
    chapterCount: result.chapterCount,
    mappingCount: result.mappingCount,
  };
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

function textbookVolumeFromTitle(title: string): string | null {
  const match = title.match(
    /(选择性\s*必修|选择性\s*选修|必修|选修)\s*(第\s*[一二三四五六七八九十\d]+\s*册)/,
  );
  if (!match) return null;

  const series = match[1]?.replace(/\s+/g, '');
  const volumeNo = match[2]?.replace(/\s+/g, '');
  return series && volumeNo ? `${series} ${volumeNo}` : null;
}

function publishedKnowledgePointPayload(staging: PublishedKnowledgePointStagingInput): unknown {
  return staging.review_payload ?? staging.llm_payload;
}

function chapterNoFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  return primitiveText(
    record.chapter_no ?? record.section_no ?? record.chapter_number ?? record.section_number,
  );
}

function chapterTitleFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  const value = record.chapter_title ?? record.section_title ?? record.title;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function subjectIdFromPayload(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  return primitiveText(record._subject_id ?? record.subject_id);
}

function sourcePageRangeFromRecord(record: Record<string, unknown>): unknown[] {
  const explicitRange = record.source_page_range ?? record.page_range;
  if (Array.isArray(explicitRange)) return explicitRange;

  const start = Number(record.source_page_start ?? record.page_start);
  const end = Number(record.source_page_end ?? record.page_end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) return [];

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
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

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(isNonEmptyString)));
}

function firstNonNull<T>(values: Array<T | null | undefined>): T | null {
  return values.find((value): value is T => value !== null && value !== undefined) ?? null;
}

function primitiveText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
