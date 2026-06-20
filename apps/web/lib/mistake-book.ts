import {
  type QuestionContentPart,
  type QuestionFigureInput,
  buildQuestionContentParts,
  questionContentPartsToPlainText,
} from './question-content';
import type { CurrentStudent } from './student-data';

export const mistakeBookEmptyState = '当前没有需要回炉的错题，继续保持今天的复习节奏。';

export interface MistakeBookItem {
  questionId: string;
  knowledgePointName: string;
  questionSummary: string;
  questionContentParts: QuestionContentPart[];
  errorCount: number;
  lastPracticedAt: Date;
}

export interface MistakeBookGroup {
  knowledgePointName: string;
  itemCount: number;
  items: MistakeBookItem[];
}

export interface MistakeBookData {
  totalCount: number;
  groups: MistakeBookGroup[];
}

export interface MistakeQuestionPreview {
  questionSummary: string;
  contentParts: QuestionContentPart[];
}

interface MistakeEntryRow {
  question_id: string;
  error_count: number;
  created_at: Date;
  question: {
    content: string;
    primary_kp_id: string;
  };
}

export function groupMistakeBookItems(items: readonly MistakeBookItem[]): MistakeBookGroup[] {
  const groups = new Map<string, MistakeBookItem[]>();

  for (const item of items) {
    const current = groups.get(item.knowledgePointName) ?? [];
    current.push(item);
    groups.set(item.knowledgePointName, current);
  }

  return [...groups.entries()].map(([knowledgePointName, groupItems]) => ({
    knowledgePointName,
    itemCount: groupItems.length,
    items: [...groupItems].sort((a, b) => {
      const errorOrder = b.errorCount - a.errorCount;
      if (errorOrder !== 0) return errorOrder;
      return b.lastPracticedAt.getTime() - a.lastPracticedAt.getTime();
    }),
  }));
}

export function buildMistakeQuestionPreview(
  content: string,
  figures: readonly QuestionFigureInput[] = [],
): MistakeQuestionPreview {
  return buildMistakeQuestionPreviewFromParts(buildQuestionContentParts(content, figures));
}

export function buildMistakeQuestionPreviewFromParts(
  contentParts: readonly QuestionContentPart[],
): MistakeQuestionPreview {
  const normalized = questionContentPartsToPlainText(contentParts).replace(/\s+/g, ' ').trim();
  return {
    questionSummary: normalized.length <= 57 ? normalized : `${normalized.slice(0, 57)}...`,
    contentParts: [...contentParts],
  };
}

export function buildMistakeQuestionSummary(content: string): string {
  return buildMistakeQuestionPreview(content).questionSummary;
}

export async function getMistakeBookData(student: CurrentStudent): Promise<MistakeBookData> {
  if (student.unlocked_kp_ids.length === 0) return { totalCount: 0, groups: [] };

  const { prisma } = await import('@hao/db');
  const rows = await prisma.mistake_book_entry.findMany({
    where: {
      student_id: student.id,
      status: 'open',
      question: {
        primary_kp_id: { in: student.unlocked_kp_ids },
      },
    },
    select: {
      question_id: true,
      error_count: true,
      created_at: true,
      question: {
        select: {
          content: true,
          primary_kp_id: true,
        },
      },
    },
    orderBy: [{ error_count: 'desc' }, { created_at: 'asc' }],
  });

  const kpIds = [...new Set(rows.map((row) => row.question.primary_kp_id))];
  const questionIds = rows.map((row) => row.question_id);
  const { getQuestionsForStudent } = await import('./student-data');
  const [knowledgePoints, attempts, questions] = await Promise.all([
    prisma.knowledge_point.findMany({
      where: { id: { in: kpIds }, subject_id: student.primary_subject_id },
      select: { id: true, name: true },
    }),
    prisma.question_attempt.findMany({
      where: {
        student_id: student.id,
        question_id: { in: questionIds },
      },
      select: {
        question_id: true,
        answered_at: true,
      },
      orderBy: { answered_at: 'desc' },
    }),
    getQuestionsForStudent(student, questionIds),
  ]);

  const kpNameById = new Map(knowledgePoints.map((kp) => [kp.id, kp.name]));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const lastAttemptByQuestionId = new Map<string, Date>();
  for (const attempt of attempts) {
    if (!lastAttemptByQuestionId.has(attempt.question_id)) {
      lastAttemptByQuestionId.set(attempt.question_id, attempt.answered_at);
    }
  }

  const items = rows.flatMap((row: MistakeEntryRow) => {
    const knowledgePointName = kpNameById.get(row.question.primary_kp_id);
    if (!knowledgePointName) return [];
    const question = questionById.get(row.question_id);
    const preview = question
      ? buildMistakeQuestionPreviewFromParts(question.contentParts)
      : buildMistakeQuestionPreview(row.question.content);

    return [
      {
        questionId: row.question_id,
        knowledgePointName,
        questionSummary: preview.questionSummary,
        questionContentParts: preview.contentParts,
        errorCount: row.error_count,
        lastPracticedAt: lastAttemptByQuestionId.get(row.question_id) ?? row.created_at,
      },
    ];
  });

  return {
    totalCount: items.length,
    groups: groupMistakeBookItems(items),
  };
}
