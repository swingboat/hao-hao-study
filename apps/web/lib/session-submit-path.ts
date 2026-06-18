export function buildSessionSubmitPath(sessionId: string): string {
  return `/study/${encodeURIComponent(sessionId)}/submit`;
}

export function readSubmittedAnswers(formData: FormData): Map<string, string> {
  const answers = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('answer_')) continue;
    const questionId = key.slice('answer_'.length);
    if (!questionId) continue;
    answers.set(questionId, String(value ?? '').trim());
  }
  return answers;
}
