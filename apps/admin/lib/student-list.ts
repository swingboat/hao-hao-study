export interface StudentListRecord {
  username: string;
  name: string;
  grade: string;
  target_exam: string;
  parent_consent_at: Date | null;
  unlocked_kp_ids: string[];
  created_at: Date;
}

export interface StudentListRow {
  username: string;
  name: string;
  grade: string;
  targetExam: string;
  parentConsentAt: string;
  unlockedKpCount: number;
  createdAt: string;
}

export function formatStudentRows(students: StudentListRecord[]): StudentListRow[] {
  return students.map((student) => ({
    username: student.username,
    name: student.name,
    grade: student.grade,
    targetExam: student.target_exam,
    parentConsentAt: student.parent_consent_at ? formatDateTime(student.parent_consent_at) : '—',
    unlockedKpCount: student.unlocked_kp_ids.length,
    createdAt: formatDateTime(student.created_at),
  }));
}

function formatDateTime(value: Date): string {
  return value.toLocaleString('zh-CN', { hour12: false });
}
