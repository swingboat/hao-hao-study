import type { LearningResourceAnalysisParserResult } from '@hao/llm';
import { stripDuplicatedChoiceOptionsFromContent } from './question-content.ts';

export type TokenUsage = { input: number; output: number } | null;

type JsonRecord = Record<string, unknown>;

const LEARNING_MATERIAL_THREAD_FIELDS = [
  ['concept_explanations', 'concept_explanation'],
  ['method_cards', 'method_card'],
  ['common_mistakes', 'common_mistake'],
  ['question_type_summaries', 'question_type_summary'],
  ['exam_trends', 'exam_trend'],
  ['textbook_deep_dives', 'textbook_deep_dive'],
  ['solution_summaries', 'solution_summary'],
  ['study_advice', 'study_advice'],
] as const;

export interface LearningResourceStagingPayloads {
  sourceDocuments: JsonRecord[];
  learningMaterials: JsonRecord[];
  questions: JsonRecord[];
  knowledgePoints: JsonRecord[];
}

export function tokenUsageFromEducationUsage(usage: unknown): TokenUsage {
  const record = asRecord(usage);
  if (!record) return null;
  const pageTotal = numberOrNull(record.page_total_tokens);
  const finalTotal = numberOrNull(record.final_total_tokens);
  const total = numberOrNull(record.total_tokens);
  if (pageTotal == null && finalTotal == null && total == null) return null;
  return {
    input: pageTotal ?? 0,
    output: finalTotal ?? Math.max(0, (total ?? 0) - (pageTotal ?? 0)),
  };
}

export function tokenUsageTotal(
  usage: TokenUsage,
): { input: number; output: number; total: number } | null {
  if (!usage) return null;
  return { input: usage.input, output: usage.output, total: usage.input + usage.output };
}

export function knowledgePointToStagingPayload(point: unknown, subjectId: string): JsonRecord {
  const record = asRecord(point) ?? {};
  const name = stringValue(record.name).trim();
  const chapterNo = firstNonEmptyString(
    record.section_number,
    record.chapter_number,
    record.chapter_no,
    record.number,
  );
  const chapterTitle = firstNonEmptyString(
    record.section_title,
    record.chapter_title,
    record.title,
  );
  return {
    ...record,
    name,
    chapter_no: chapterNo,
    chapter_title: chapterTitle,
    brief: firstNonEmptyString(record.description, record.brief) ?? '',
    _subject_id: subjectId,
  };
}

export function questionToStagingPayload(question: unknown, subjectId: string): JsonRecord {
  const record = asRecord(question) ?? {};
  const options = normalizeOptions(record.options);
  const content = stripDuplicatedChoiceOptionsFromContent(questionContent(record), options);
  const related = normalizeRelatedKnowledgePoints(
    record.related_knowledge_points ?? record.kp_hints,
  );
  const sourceRef = normalizeSourceRef(record.source_ref);
  const sourcePages = normalizeNumberArray(record.source_pages ?? record.pages);
  const sourcePage = sourceRef?.page ?? sourcePages[0] ?? null;
  const questionNo = firstNonEmptyString(
    sourceRef?.question_no,
    record.number,
    record.question_no,
    record.id,
  );
  return {
    content,
    question_type: inferQuestionType(record.type ?? record.question_type, options),
    options,
    answer: questionAnswer(record),
    solution_text:
      firstNonEmptyString(record.analysis, record.solution_text, record.solution) ??
      subQuestionJoinedField(record.sub_questions, [
        'analysis',
        'solution_text',
        'solution',
        'explanation',
      ]),
    difficulty: numberOrNull(record.difficulty) ?? 3,
    kp_hints: related.map((kp) => kp.name).filter((name): name is string => Boolean(name)),
    quality_status:
      firstNonEmptyString(record.quality_status) ??
      (questionAnswer(record).trim() ? 'needs_human_review' : 'missing_answer'),
    source_ref: sourceRef,
    source_hint: {
      page: sourcePage,
      question_no: questionNo,
    },
    figures: Array.isArray(record.figures) ? record.figures : [],
    related_knowledge_points: related,
    _subject_id: subjectId,
    _common_question_id: firstNonEmptyString(record.id),
    _common_question_type: firstNonEmptyString(record.type),
  };
}

export function learningResourceToStagingPayloads(
  result: LearningResourceAnalysisParserResult,
  subjectId: string,
): LearningResourceStagingPayloads {
  const sourceUnits = sourceUnitsFromLearningResource(result);
  const sourceDocument = {
    ...(asRecord(result.source_document) ?? {}),
    _subject_id: subjectId,
    _source_units: sourceUnits,
  };
  const learningMaterials: JsonRecord[] = [];
  const questions: JsonRecord[] = [];
  const knowledgePoints: JsonRecord[] = [];

  for (const thread of result.knowledge_threads ?? []) {
    const threadRecord = asRecord(thread) ?? {};
    const kp = asRecord(threadRecord.knowledge_point) ?? {};
    const kpName = firstNonEmptyString(kp.name);
    const kpId = firstNonEmptyString(kp.id);

    for (const [field, materialType] of LEARNING_MATERIAL_THREAD_FIELDS) {
      const items = Array.isArray(threadRecord[field]) ? threadRecord[field] : [];
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        learningMaterials.push({
          ...record,
          material_type: materialType,
          kp_hints: uniqueStrings([...(stringArray(record.kp_hints) ?? []), kpName]),
          source_ref: normalizeSourceRef(record.source_ref),
          _subject_id: subjectId,
          _knowledge_point_id: kpId,
          _knowledge_point_name: kpName,
          _knowledge_point: kp,
        });
      }
    }

    const threadQuestions = Array.isArray(threadRecord.questions) ? threadRecord.questions : [];
    for (const question of threadQuestions) {
      questions.push({
        ...questionToStagingPayload(question, subjectId),
        _knowledge_point_id: kpId,
        _knowledge_point_name: kpName,
        _knowledge_point: kp,
      });
    }
  }

  for (const item of result.unmapped_items ?? []) {
    if (item.item_type !== 'knowledge_point') continue;
    knowledgePoints.push({
      name: firstNonEmptyString(item.title) ?? '未命名知识点',
      brief: firstNonEmptyString(item.content) ?? '',
      source_ref: normalizeSourceRef(item.source_ref),
      kp_hints: stringArray(item.suggested_kp_hints) ?? [],
      _subject_id: subjectId,
      _unmapped_reason: item.reason,
      _unmapped_item: item as unknown as JsonRecord,
    });
  }

  return {
    sourceDocuments: [sourceDocument],
    learningMaterials,
    questions,
    knowledgePoints,
  };
}

export function questionContentKey(payload: { content?: unknown }): string {
  return stringValue(payload.content).replace(/\s+/g, '').slice(0, 60);
}

export function questionNoFromPayload(payload: { source_hint?: { question_no?: string | null } }):
  | string
  | null {
  return payload.source_hint?.question_no?.trim() || null;
}

export function knowledgeRowsForQuestionContext(
  rows: Array<{ id: string; name: string; chapter_no: string | null }>,
): JsonRecord[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    chapter_title: row.chapter_no ?? undefined,
  }));
}

export function analysisFileTypeFromName(
  name: string | null | undefined,
  mimeType?: string | null,
): 'pdf' | 'word' | 'image' {
  const lower = String(name ?? '').toLowerCase();
  const mime = String(mimeType ?? '').toLowerCase();
  if (
    mime.startsWith('image/') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp')
  ) {
    return 'image';
  }
  return lower.endsWith('.doc') || lower.endsWith('.docx') ? 'word' : 'pdf';
}

function questionContent(record: JsonRecord): string {
  const base =
    firstNonEmptyString(
      record.stem,
      record.content,
      record.question,
      record.text,
      record.raw_text,
    ) ?? '';
  const subQuestions = Array.isArray(record.sub_questions)
    ? record.sub_questions
        .map((item, index) => {
          const text = subQuestionStem(item);
          return text ? `${index + 1}. ${text}` : '';
        })
        .filter(Boolean)
    : [];
  return [base, ...subQuestions].filter(Boolean).join('\n');
}

function questionAnswer(record: JsonRecord): string {
  return (
    firstNonEmptyString(
      record.answer,
      record.answer_text,
      record.correct_answer,
      record.correctAnswer,
      record.answers,
    ) ?? subQuestionJoinedField(record.sub_questions, ['answer', 'answer_text', 'correct_answer'])
  );
}

function subQuestionStem(value: unknown): string {
  const record = asRecord(value);
  if (!record) return firstNonEmptyString(value) ?? '';
  return (
    firstNonEmptyString(
      record.stem,
      record.content,
      record.question,
      record.text,
      record.prompt,
      record.title,
      record.raw_text,
    ) ?? ''
  );
}

function subQuestionJoinedField(value: unknown, keys: string[]): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) return '';
      const text = firstNonEmptyString(...keys.map((key) => record[key]));
      return text ? `${index + 1}. ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeOptions(value: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const match = item.trim().match(/^([A-Za-z])[\.\u3001\uff0e]?\s*(.*)$/);
        return {
          label: (match?.[1] ?? String.fromCharCode(65 + index)).toUpperCase(),
          text: (match?.[2] ?? item).trim(),
        };
      }
      const record = asRecord(item);
      if (!record) return null;
      return {
        label:
          firstNonEmptyString(record.label, record.key, record.option) ??
          String.fromCharCode(65 + index),
        text: firstNonEmptyString(record.text, record.content, record.value) ?? '',
      };
    })
    .filter((item): item is { label: string; text: string } => Boolean(item?.text));
}

function inferQuestionType(
  value: unknown,
  options: Array<{ label: string; text: string }>,
): 'choice' | 'fill_in' {
  const type = stringValue(value).toLowerCase();
  if (type.includes('填') || type.includes('fill')) return 'fill_in';
  if (type.includes('选择') || type.includes('choice')) return 'choice';
  return options.length >= 2 ? 'choice' : 'fill_in';
}

function normalizeRelatedKnowledgePoints(value: unknown): Array<{ id?: string; name?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { name: item.trim() };
      const record = asRecord(item);
      if (!record) return null;
      const name = firstNonEmptyString(record.name);
      if (!name) return null;
      return {
        id: firstNonEmptyString(record.id),
        name,
      };
    })
    .filter((item): item is { id?: string; name: string } => Boolean(item?.name));
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function normalizeSourceRef(value: unknown):
  | {
      page?: number | null;
      slide_no?: number | null;
      question_no?: string | null;
      text_snippet?: string | null;
    }
  | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const page = numberOrNull(record.page);
  const slideNo = numberOrNull(record.slide_no);
  const questionNo = firstNonEmptyString(record.question_no);
  const textSnippet = firstNonEmptyString(record.text_snippet);
  const ref: {
    page?: number;
    slide_no?: number;
    question_no?: string;
    text_snippet?: string;
  } = {};
  if (page != null) ref.page = page;
  if (slideNo != null) ref.slide_no = slideNo;
  if (questionNo) ref.question_no = questionNo;
  if (textSnippet) ref.text_snippet = textSnippet;
  return Object.keys(ref).length > 0 ? ref : undefined;
}

function sourceUnitsFromLearningResource(
  result: LearningResourceAnalysisParserResult,
): JsonRecord[] {
  const sourceRefs: Array<ReturnType<typeof normalizeSourceRef>> = [];
  for (const thread of result.knowledge_threads ?? []) {
    const threadRecord = asRecord(thread) ?? {};
    if (Array.isArray(threadRecord.source_refs)) {
      sourceRefs.push(...threadRecord.source_refs.map((ref) => normalizeSourceRef(ref)));
    }
    for (const [field] of LEARNING_MATERIAL_THREAD_FIELDS) {
      const items = Array.isArray(threadRecord[field]) ? threadRecord[field] : [];
      for (const item of items) {
        sourceRefs.push(normalizeSourceRef(asRecord(item)?.source_ref));
      }
    }
    const threadQuestions = Array.isArray(threadRecord.questions) ? threadRecord.questions : [];
    for (const question of threadQuestions) {
      sourceRefs.push(normalizeSourceRef(asRecord(question)?.source_ref));
    }
  }
  for (const item of result.unmapped_items ?? []) {
    sourceRefs.push(normalizeSourceRef(item.source_ref));
  }

  const seen = new Set<string>();
  const units: JsonRecord[] = [];
  for (const ref of sourceRefs) {
    if (!ref) continue;
    const key = [
      ref.page ?? '',
      ref.slide_no ?? '',
      ref.question_no ?? '',
      ref.text_snippet ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    units.push({
      unit_kind: ref.question_no ? 'question_region' : ref.slide_no ? 'slide' : 'page',
      page_no: ref.page ?? null,
      slide_no: ref.slide_no ?? null,
      question_no: ref.question_no ?? null,
      text_snippet: ref.text_snippet ?? null,
    });
  }
  return units;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => firstNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) continue;
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  return textFromValue(value) ?? '';
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

const TEXT_KEYS = [
  'text',
  'content',
  'stem',
  'question',
  'prompt',
  'title',
  'name',
  'value',
  'answer',
  'label',
];

function textFromValue(value: unknown, seen = new Set<object>()): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => textFromValue(item, seen)?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
    return text || null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (seen.has(record)) return null;
  seen.add(record);
  for (const key of TEXT_KEYS) {
    const text = textFromValue(record[key], seen)?.trim();
    if (text) return text;
  }
  return null;
}
