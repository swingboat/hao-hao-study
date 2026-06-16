import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStudentRows } from './student-list.ts';

test('formatStudentRows maps student records to read-only table rows', () => {
  const rows = formatStudentRows([
    {
      username: 'niki',
      name: 'Niki',
      grade: 'g11',
      target_exam: '高考 2027',
      parent_consent_at: null,
      unlocked_kp_ids: ['11111111-1111-1111-1111-111111111111'],
      created_at: new Date('2026-06-16T02:30:00.000Z'),
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.username, 'niki');
  assert.equal(rows[0]?.name, 'Niki');
  assert.equal(rows[0]?.grade, 'g11');
  assert.equal(rows[0]?.targetExam, '高考 2027');
  assert.equal(rows[0]?.parentConsentAt, '—');
  assert.equal(rows[0]?.unlockedKpCount, 1);
  assert.match(rows[0]?.createdAt ?? '', /^2026/);
});
