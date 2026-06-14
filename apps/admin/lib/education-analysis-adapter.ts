export type TokenUsage = { input: number; output: number } | null;

type JsonRecord = Record<string, unknown>;

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
  const content = questionContent(record);
  const options = normalizeOptions(record.options);
  const related = normalizeRelatedKnowledgePoints(
    record.related_knowledge_points ?? record.kp_hints,
  );
  const sourcePages = normalizeNumberArray(record.source_pages ?? record.pages);
  const questionNo = firstNonEmptyString(record.number, record.question_no, record.id);
  return {
    content,
    question_type: inferQuestionType(record.type ?? record.question_type, options),
    options,
    answer: firstNonEmptyString(record.answer) ?? '',
    solution_text:
      firstNonEmptyString(record.analysis, record.solution_text, record.solution) ?? '',
    difficulty: numberOrNull(record.difficulty) ?? 3,
    kp_hints: related.map((kp) => kp.name).filter((name): name is string => Boolean(name)),
    source_hint: {
      page: sourcePages[0] ?? null,
      question_no: questionNo,
    },
    figures: Array.isArray(record.figures) ? record.figures : [],
    related_knowledge_points: related,
    _subject_id: subjectId,
    _common_question_id: firstNonEmptyString(record.id),
    _common_question_type: firstNonEmptyString(record.type),
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

export function analysisFileTypeFromName(name: string | null | undefined): 'pdf' | 'word' {
  const lower = String(name ?? '').toLowerCase();
  return lower.endsWith('.doc') || lower.endsWith('.docx') ? 'word' : 'pdf';
}

function questionContent(record: JsonRecord): string {
  const base = firstNonEmptyString(record.stem, record.content, record.raw_text) ?? '';
  const subQuestions = Array.isArray(record.sub_questions)
    ? record.sub_questions
        .map((item, index) => `${index + 1}. ${stringValue(item)}`.trim())
        .filter(Boolean)
    : [];
  return [base, ...subQuestions].filter(Boolean).join('\n');
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

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}
