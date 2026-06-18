import { type NextRequest, NextResponse } from 'next/server';
import { submitSessionAnswers } from '../../../../lib/session-submit';
import { readSubmittedAnswers } from '../../../../lib/session-submit-path';
import { getCurrentStudent } from '../../../../lib/student-data';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const [{ sessionId }, student, formData] = await Promise.all([
    params,
    getCurrentStudent(),
    request.formData(),
  ]);

  if (!student) {
    return NextResponse.redirect(new URL(`/login?next=/study/${sessionId}`, request.url), 303);
  }
  if (!student.parent_consent_at) {
    return NextResponse.redirect(new URL('/login?error=consent_required', request.url), 303);
  }

  const nextPath = await submitSessionAnswers(student, sessionId, readSubmittedAnswers(formData));
  return NextResponse.redirect(new URL(nextPath, request.url), 303);
}
