import type { MistakeStatus, QuestionType } from '@hao/db';
import { isAnswerCorrect } from './learning-rules';
import type { CurrentStudent, SessionQuestionView } from './student-data';

export interface MistakeReviewStateInput {
  errorCount: number;
  consecutiveCorrectCount: number;
  isCorrect: boolean;
}

export interface MistakeReviewState {
  status: MistakeStatus;
  errorCount: number;
  consecutiveCorrectCount: number;
  resolvedNow: boolean;
}

export interface MistakeRedoData {
  question: SessionQuestionView;
  errorCount: number;
  consecutiveCorrectCount: number;
}

export interface MistakeRedoSubmissionResult {
  ok: boolean;
  message: string;
  isCorrect: boolean | null;
  studentAnswer: string;
  resolvedNow: boolean;
  errorCount: number | null;
  consecutiveCorrectCount: number | null;
}

export function nextMistakeReviewState(input: MistakeReviewStateInput): MistakeReviewState {
  if (!input.isCorrect) {
    return {
      status: 'open',
      errorCount: input.errorCount + 1,
      consecutiveCorrectCount: 0,
      resolvedNow: false,
    };
  }

  const consecutiveCorrectCount = input.consecutiveCorrectCount + 1;

  return {
    status: consecutiveCorrectCount >= 2 ? 'resolved' : 'open',
    errorCount: input.errorCount,
    consecutiveCorrectCount,
    resolvedNow: consecutiveCorrectCount >= 2,
  };
}

export async function getMistakeRedoData(
  student: CurrentStudent,
  questionId: string,
): Promise<MistakeRedoData | null> {
  if (!questionId || student.unlocked_kp_ids.length === 0) return null;

  const { prisma } = await import('@hao/db');
  const entry = await prisma.mistake_book_entry.findFirst({
    where: {
      student_id: student.id,
      question_id: questionId,
      status: 'open',
      question: {
        primary_kp_id: { in: student.unlocked_kp_ids },
      },
    },
    select: {
      question_id: true,
      error_count: true,
      consecutive_correct_count: true,
    },
  });
  if (!entry) return null;

  const { getQuestionsForStudent } = await import('./student-data');
  const [question] = await getQuestionsForStudent(student, [entry.question_id]);
  if (!question) return null;

  return {
    question,
    errorCount: entry.error_count,
    consecutiveCorrectCount: entry.consecutive_correct_count,
  };
}

export async function submitMistakeRedo(
  student: CurrentStudent,
  questionId: string,
  rawStudentAnswer: string,
): Promise<MistakeRedoSubmissionResult> {
  const studentAnswer = rawStudentAnswer.trim();
  if (!questionId) return blockedResult(studentAnswer);

  const { prisma } = await import('@hao/db');
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const entry = await tx.mistake_book_entry.findFirst({
      where: {
        student_id: student.id,
        question_id: questionId,
        status: 'open',
        question: {
          primary_kp_id: { in: student.unlocked_kp_ids },
        },
      },
      select: {
        question_id: true,
        error_count: true,
        consecutive_correct_count: true,
        question: {
          select: {
            answer: true,
            question_type: true,
          },
        },
      },
    });

    if (!entry) return blockedResult(studentAnswer);

    const isCorrect = isAnswerCorrect(
      studentAnswer,
      entry.question.answer,
      entry.question.question_type as QuestionType,
    );
    const nextState = nextMistakeReviewState({
      errorCount: entry.error_count,
      consecutiveCorrectCount: entry.consecutive_correct_count,
      isCorrect,
    });

    await tx.mistake_book_entry.update({
      where: {
        student_id_question_id: {
          student_id: student.id,
          question_id: entry.question_id,
        },
      },
      data: {
        status: nextState.status,
        error_count: nextState.errorCount,
        consecutive_correct_count: nextState.consecutiveCorrectCount,
        resolved_at: nextState.resolvedNow ? now : null,
      },
    });

    return {
      ok: true,
      message: isCorrect
        ? nextState.resolvedNow
          ? '这道错题已攻克，已从错题复习中移除。'
          : '答对了，再连续做对一次就能攻克这道错题。'
        : '这题还需要再巩固，稍后会继续留在错题复习里。',
      isCorrect,
      studentAnswer,
      resolvedNow: nextState.resolvedNow,
      errorCount: nextState.errorCount,
      consecutiveCorrectCount: nextState.consecutiveCorrectCount,
    };
  });
}

function blockedResult(studentAnswer: string): MistakeRedoSubmissionResult {
  return {
    ok: false,
    message: '这道题暂时不在你的错题复习范围内。',
    isCorrect: null,
    studentAnswer,
    resolvedNow: false,
    errorCount: null,
    consecutiveCorrectCount: null,
  };
}
