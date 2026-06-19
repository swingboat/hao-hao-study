import 'server-only';

import { getTextbookProgressScope, getTextbooksForStudentScope, prisma } from '@hao/db';
import {
  type LearningProgressData,
  type ProgressKnowledgePointSource,
  type ProgressTextbookOption,
  buildLearningProgress,
  resolveActiveTextbook,
  sortProgressItems,
} from './progress';
import type { CurrentStudent } from './student-data';

export interface LearningProgressPageData extends LearningProgressData {
  textbooks: ProgressTextbookOption[];
  activeTextbook: {
    textbook: ProgressTextbookOption;
    index: number;
  } | null;
}

export async function getLearningProgressData(
  student: CurrentStudent,
  selectedTextbookIndex?: string,
): Promise<LearningProgressPageData> {
  const unlockedKpIds = student.unlocked_kp_ids;
  if (unlockedKpIds.length === 0) {
    return withTextbooks(
      buildLearningProgress({
        knowledgePoints: [],
        masteryRows: [],
        attemptRows: [],
        openMistakeRows: [],
        dueReviewRows: [],
      }),
      [],
      null,
    );
  }

  const textbooks = normalizeTextbooks(
    await getTextbooksForStudentScope(prisma, {
      primary_subject_id: student.primary_subject_id,
      stage: student.stage,
      unlocked_kp_ids: unlockedKpIds,
    }),
  );
  const activeTextbook = resolveActiveTextbook(textbooks, selectedTextbookIndex);

  if (!activeTextbook) {
    return withTextbooks(
      buildLearningProgress({
        knowledgePoints: [],
        masteryRows: [],
        attemptRows: [],
        openMistakeRows: [],
        dueReviewRows: [],
      }),
      textbooks,
      activeTextbook,
    );
  }

  const scopeRows = normalizeTextbookScopeRows(
    await getTextbookProgressScope(prisma, {
      textbookId: activeTextbook.textbook.id,
      unlockedKpIds,
    }),
  );
  const knowledgePoints = scopeRows.map((row) => row.knowledgePoint);
  const allowedKpIds = knowledgePoints.map((kp) => kp.id);

  if (allowedKpIds.length === 0) {
    return withTextbooks(
      buildLearningProgress({
        knowledgePoints: [],
        masteryRows: [],
        attemptRows: [],
        openMistakeRows: [],
        dueReviewRows: [],
      }),
      textbooks,
      activeTextbook,
    );
  }

  const [masteryRows, attemptRows, openMistakeRows, dueReviewRows] = await Promise.all([
    prisma.knowledge_point_mastery.findMany({
      where: {
        student_id: student.id,
        kp_id: { in: allowedKpIds },
      },
      select: {
        kp_id: true,
        mastery_score: true,
        peak_mastery_score: true,
      },
    }),
    prisma.question_attempt.findMany({
      where: {
        student_id: student.id,
        question: {
          primary_kp_id: { in: allowedKpIds },
        },
      },
      select: {
        answered_at: true,
        question: {
          select: {
            primary_kp_id: true,
          },
        },
      },
    }),
    prisma.mistake_book_entry.findMany({
      where: {
        student_id: student.id,
        status: 'open',
        question: {
          primary_kp_id: { in: allowedKpIds },
        },
      },
      select: {
        question: {
          select: {
            primary_kp_id: true,
          },
        },
      },
    }),
    prisma.spaced_review.findMany({
      where: {
        student_id: student.id,
        kp_id: { in: allowedKpIds },
        next_review_at: { lte: new Date() },
      },
      select: {
        kp_id: true,
        next_review_at: true,
      },
    }),
  ]);

  const progress = buildLearningProgress({
    knowledgePoints,
    masteryRows,
    attemptRows: attemptRows.map((row) => ({
      kp_id: row.question.primary_kp_id,
      answered_at: row.answered_at,
    })),
    openMistakeRows: openMistakeRows.map((row) => ({
      kp_id: row.question.primary_kp_id,
    })),
    dueReviewRows,
  });

  return withTextbooks(
    {
      ...progress,
      items: sortProgressItems(progress.items),
    },
    textbooks,
    activeTextbook,
  );
}

function withTextbooks(
  progress: LearningProgressData,
  textbooks: ProgressTextbookOption[],
  activeTextbook: LearningProgressPageData['activeTextbook'],
): LearningProgressPageData {
  return {
    ...progress,
    textbooks,
    activeTextbook,
  };
}

function normalizeTextbooks(rows: unknown[]): ProgressTextbookOption[] {
  return rows.flatMap((row) => {
    const record = asRecord(row);
    const id = stringOrNull(record?.id);
    const title = stringOrNull(record?.title);
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        edition: stringOrNull(record?.edition),
        publisher: stringOrNull(record?.publisher),
        volume: stringOrNull(record?.volume),
      },
    ];
  });
}

function normalizeTextbookScopeRows(
  rows: unknown[],
): Array<{ knowledgePoint: ProgressKnowledgePointSource }> {
  return rows.flatMap((row) => {
    const record = asRecord(row);
    const kpRecord = asRecord(record?.knowledge_point);
    const id = stringOrNull(kpRecord?.id);
    const name = stringOrNull(kpRecord?.name);
    if (!id || !name) return [];
    const chapterRecord = asRecord(record?.chapter);
    return [
      {
        knowledgePoint: {
          id,
          name,
          chapter_no: stringOrNull(chapterRecord?.chapter_no) ?? stringOrNull(kpRecord?.chapter_no),
        },
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
