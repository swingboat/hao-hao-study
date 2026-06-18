'use server';

import { prisma } from '@hao/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  STUDENT_SESSION_COOKIE,
  STUDENT_SESSION_TTL_SEC,
  signStudentSession,
  verifyStudentPassword,
} from '../lib/auth';
import { submitSessionAnswers } from '../lib/session-submit';
import { readSubmittedAnswers } from '../lib/session-submit-path';
import { requireCurrentStudent } from '../lib/student-data';
import { getTodayPlannerDataForStudent } from '../lib/today-planner';

export interface LoginState {
  error: string | null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!username || !password) {
    return { error: '请填写账号和密码' };
  }

  const student = await prisma.student.findFirst({
    where: { username, soft_deleted_at: null },
    select: {
      id: true,
      password_hash: true,
      parent_consent_at: true,
    },
  });

  if (!student || !verifyStudentPassword(password, student.password_hash)) {
    return { error: '账号或密码错误' };
  }
  if (!student.parent_consent_at) {
    return { error: '账号尚未完成监护人同意确认，请联系老师处理' };
  }

  const jar = await cookies();
  jar.set(STUDENT_SESSION_COOKIE, signStudentSession(student.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: STUDENT_SESSION_TTL_SEC,
  });

  redirect(safeNextPath(next));
}

export async function startTodaySessionAction(): Promise<void> {
  const student = await requireCurrentStudent();

  const existing = await prisma.learning_session.findFirst({
    where: { student_id: student.id, status: 'in_progress' },
    orderBy: { started_at: 'desc' },
    select: { id: true },
  });
  if (existing) {
    redirect(`/study/${existing.id}`);
  }

  const planner = await getTodayPlannerDataForStudent(student, {
    answerableOnly: true,
    onlyUnattemptedQuestions: true,
  });
  if (!planner.sessionPlan) redirect('/?notice=practice-preparing');

  const session = await prisma.learning_session.create({
    data: {
      student_id: student.id,
      question_ids: planner.sessionPlan.questionIds,
      pool_sources: planner.sessionPlan.poolSources,
    },
    select: { id: true },
  });

  redirect(`/study/${session.id}`);
}

export async function submitSessionAction(formData: FormData): Promise<void> {
  const student = await requireCurrentStudent();
  const sessionId = String(formData.get('sessionId') ?? '');
  const nextPath = await submitSessionAnswers(student, sessionId, readSubmittedAnswers(formData));
  redirect(nextPath);
}

function safeNextPath(next: string): string {
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/admin')) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}
