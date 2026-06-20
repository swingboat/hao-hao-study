'use server';

import { submitMistakeRedo } from '../../../../lib/mistake-redo';
import { requireCurrentStudent } from '../../../../lib/student-data';

export interface MistakeRedoFormState {
  status: 'idle' | 'checked' | 'error';
  message: string | null;
  isCorrect: boolean | null;
  studentAnswer: string;
  resolvedNow: boolean;
}

export async function submitMistakeRedoAction(
  _prevState: MistakeRedoFormState,
  formData: FormData,
): Promise<MistakeRedoFormState> {
  const student = await requireCurrentStudent();
  const questionId = String(formData.get('questionId') ?? '');
  const answer = String(formData.get('answer') ?? '');
  const result = await submitMistakeRedo(student, questionId, answer);

  return {
    status: result.ok ? 'checked' : 'error',
    message: result.message,
    isCorrect: result.isCorrect,
    studentAnswer: result.studentAnswer,
    resolvedNow: result.resolvedNow,
  };
}
