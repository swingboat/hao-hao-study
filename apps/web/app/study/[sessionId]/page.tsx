import { redirect } from 'next/navigation';
import { getAnswerSessionData, requireCurrentStudent } from '../../../lib/student-data';
import { AnswerForm } from './answer-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function StudySessionPage({ params }: PageProps) {
  const [{ sessionId }, student] = await Promise.all([params, requireCurrentStudent()]);
  const session = await getAnswerSessionData(student, sessionId);

  if (!session) redirect('/');
  if (session.questions.length === 0) redirect('/?notice=no-content');

  return (
    <main className="page-shell narrow-shell">
      <AnswerForm
        sessionId={session.id}
        startedAt={session.started_at.toISOString()}
        questions={session.questions}
      />
    </main>
  );
}
