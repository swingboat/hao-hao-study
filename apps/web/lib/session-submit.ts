import 'server-only';

import { prisma } from '@hao/db';
import {
  applyMasteryDelta,
  getMasteryDelta,
  isAnswerCorrect,
  withUnlockedPrimaryKpFilter,
} from './learning-rules';
import type { CurrentStudent } from './student-data';

export async function submitSessionAnswers(
  student: CurrentStudent,
  sessionId: string,
  answersByQuestionId: ReadonlyMap<string, string>,
): Promise<string> {
  if (!sessionId) return '/';

  const session = await prisma.learning_session.findFirst({
    where: { id: sessionId, student_id: student.id },
    select: {
      id: true,
      status: true,
      question_ids: true,
    },
  });
  if (!session) return '/';
  if (session.status === 'completed') return `/study/${session.id}/result`;
  if (session.status !== 'in_progress') return '/';

  const questions = await prisma.question.findMany({
    where: {
      id: { in: session.question_ids },
      ...withUnlockedPrimaryKpFilter(student.unlocked_kp_ids),
    },
    select: {
      id: true,
      answer: true,
      question_type: true,
      difficulty: true,
      primary_kp_id: true,
    },
  });
  if (questions.length !== session.question_ids.length) {
    throw new Error('Session 中存在未解锁或不存在的题目，已拒绝提交');
  }

  const order = new Map(session.question_ids.map((id, index) => [id, index]));
  const orderedQuestions = [...questions].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
  const now = new Date();
  const nextReviewAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const currentSession = await tx.learning_session.findFirst({
      where: { id: session.id, student_id: student.id },
      select: { status: true },
    });
    if (currentSession?.status !== 'in_progress') return;

    const attempts = orderedQuestions.map((question) => {
      const studentAnswer = answersByQuestionId.get(question.id) ?? '';
      return {
        session_id: session.id,
        student_id: student.id,
        question_id: question.id,
        student_answer: studentAnswer,
        is_correct: isAnswerCorrect(studentAnswer, question.answer, question.question_type),
        answered_at: now,
      };
    });

    await tx.question_attempt.createMany({ data: attempts });

    const masteryRows = await tx.knowledge_point_mastery.findMany({
      where: {
        student_id: student.id,
        kp_id: { in: orderedQuestions.map((question) => question.primary_kp_id) },
      },
      select: {
        kp_id: true,
        mastery_score: true,
        peak_mastery_score: true,
      },
    });
    const masteryByKp = new Map(masteryRows.map((row) => [row.kp_id, row]));

    for (const question of orderedQuestions) {
      const attempt = attempts.find((item) => item.question_id === question.id);
      if (!attempt) continue;

      const existingMastery = masteryByKp.get(question.primary_kp_id);
      const previousScore = existingMastery?.mastery_score ?? 0;
      const nextScore = applyMasteryDelta(
        previousScore,
        getMasteryDelta(question.difficulty, attempt.is_correct),
      );
      const nextPeak = Math.max(existingMastery?.peak_mastery_score ?? 0, nextScore);

      await tx.knowledge_point_mastery.upsert({
        where: {
          student_id_kp_id: {
            student_id: student.id,
            kp_id: question.primary_kp_id,
          },
        },
        create: {
          student_id: student.id,
          subject_id: student.primary_subject_id,
          kp_id: question.primary_kp_id,
          mastery_score: nextScore,
          peak_mastery_score: nextPeak,
          last_attempted_at: now,
        },
        update: {
          mastery_score: nextScore,
          peak_mastery_score: nextPeak,
          last_attempted_at: now,
        },
      });
      masteryByKp.set(question.primary_kp_id, {
        kp_id: question.primary_kp_id,
        mastery_score: nextScore,
        peak_mastery_score: nextPeak,
      });

      if (!attempt.is_correct || !existingMastery) {
        await tx.spaced_review.upsert({
          where: {
            student_id_kp_id: {
              student_id: student.id,
              kp_id: question.primary_kp_id,
            },
          },
          create: {
            student_id: student.id,
            kp_id: question.primary_kp_id,
            idx: 0,
            next_review_at: nextReviewAt,
          },
          update: {
            idx: 0,
            next_review_at: nextReviewAt,
          },
        });
      }

      if (!attempt.is_correct) {
        await tx.mistake_book_entry.upsert({
          where: {
            student_id_question_id: {
              student_id: student.id,
              question_id: question.id,
            },
          },
          create: {
            student_id: student.id,
            question_id: question.id,
            status: 'open',
            error_count: 1,
            consecutive_correct_count: 0,
          },
          update: {
            status: 'open',
            error_count: { increment: 1 },
            consecutive_correct_count: 0,
            resolved_at: null,
          },
        });
      } else {
        const mistake = await tx.mistake_book_entry.findUnique({
          where: {
            student_id_question_id: {
              student_id: student.id,
              question_id: question.id,
            },
          },
          select: {
            status: true,
            consecutive_correct_count: true,
          },
        });
        if (mistake?.status === 'open') {
          const consecutiveCorrectCount = mistake.consecutive_correct_count + 1;
          await tx.mistake_book_entry.update({
            where: {
              student_id_question_id: {
                student_id: student.id,
                question_id: question.id,
              },
            },
            data: {
              consecutive_correct_count: consecutiveCorrectCount,
              status: consecutiveCorrectCount >= 2 ? 'resolved' : 'open',
              resolved_at: consecutiveCorrectCount >= 2 ? now : null,
            },
          });
        }
      }
    }

    await tx.learning_session.update({
      where: { id: session.id },
      data: {
        status: 'completed',
        ended_at: now,
      },
    });
  });

  return `/study/${session.id}/result`;
}
