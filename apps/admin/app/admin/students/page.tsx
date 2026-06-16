import { prisma } from '@hao/db';
import { formatStudentRows } from '../../../lib/student-list';

export const dynamic = 'force-dynamic';

export default async function StudentsPage() {
  const students = await prisma.student.findMany({
    orderBy: [{ created_at: 'desc' }, { username: 'asc' }],
    select: {
      username: true,
      name: true,
      grade: true,
      target_exam: true,
      parent_consent_at: true,
      unlocked_kp_ids: true,
      created_at: true,
    },
  });
  const rows = formatStudentRows(students);

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">学生列表</h1>
        <p className="text-sm opacity-60 mt-1">F5.1 只读视图，按创建时间倒序显示。</p>
      </header>

      {rows.length === 0 ? (
        <section className="border rounded-lg p-8 text-center text-sm opacity-70">
          暂无学生记录。
        </section>
      ) : (
        <section className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/3 dark:bg-white/5 border-b">
              <tr className="text-left">
                <th className="p-2 font-medium">username</th>
                <th className="p-2 font-medium">name</th>
                <th className="p-2 font-medium">grade</th>
                <th className="p-2 font-medium">target_exam</th>
                <th className="p-2 font-medium">parent_consent_at</th>
                <th className="p-2 font-medium text-right">unlocked_kp_ids</th>
                <th className="p-2 font-medium">created_at</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((student) => (
                <tr key={student.username}>
                  <td className="p-2 font-mono text-xs">{student.username}</td>
                  <td className="p-2">{student.name}</td>
                  <td className="p-2 font-mono text-xs">{student.grade}</td>
                  <td className="p-2">{student.targetExam}</td>
                  <td className="p-2 tabular-nums">{student.parentConsentAt}</td>
                  <td className="p-2 text-right tabular-nums">{student.unlockedKpCount}</td>
                  <td className="p-2 tabular-nums">{student.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
