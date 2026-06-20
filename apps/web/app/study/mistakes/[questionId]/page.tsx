import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMistakeRedoData } from '../../../../lib/mistake-redo';
import { requireCurrentStudent } from '../../../../lib/student-data';
import { MistakeRedoForm } from './redo-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ questionId: string }>;
}

export default async function MistakeRedoPage({ params }: PageProps) {
  const [{ questionId }, student] = await Promise.all([params, requireCurrentStudent()]);
  const redo = await getMistakeRedoData(student, questionId);

  if (!redo) redirect('/study/mistakes');

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">错题重做</p>
          <h1 className="page-title">再攻克一次</h1>
          <p className="muted mt-2">
            这题已经累计做错 {redo.errorCount} 次，连续做对 2 次后会从错题复习中移除。
          </p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/study/mistakes">
            返回错题复习
          </Link>
        </div>
      </section>

      <MistakeRedoForm question={redo.question} />
    </main>
  );
}
