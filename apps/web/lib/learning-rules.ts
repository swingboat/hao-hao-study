export type WebQuestionType = 'choice' | 'fill_in';

export interface NewPoolQuestion {
  id: string;
  primary_kp_id: string;
  difficulty: number;
  created_at: Date;
}

export function withUnlockedPrimaryKpFilter(unlockedKpIds: readonly string[]) {
  return {
    primary_kp_id: { in: [...unlockedKpIds] },
  };
}

export function selectNewPoolQuestions<T extends NewPoolQuestion>(
  questions: readonly T[],
  unlockedKpIds: readonly string[],
  limit: number,
): T[] {
  const unlocked = new Set(unlockedKpIds);
  const usedKp = new Set<string>();
  const selected: T[] = [];

  const sorted = [...questions].sort((a, b) => {
    const kpOrder = a.primary_kp_id.localeCompare(b.primary_kp_id);
    if (kpOrder !== 0) return kpOrder;
    const createdOrder = a.created_at.getTime() - b.created_at.getTime();
    if (createdOrder !== 0) return createdOrder;
    return a.difficulty - b.difficulty;
  });

  for (const question of sorted) {
    if (selected.length >= limit) break;
    if (!unlocked.has(question.primary_kp_id)) continue;
    if (usedKp.has(question.primary_kp_id)) continue;
    selected.push(question);
    usedKp.add(question.primary_kp_id);
  }

  return selected;
}

export function isAnswerCorrect(
  submittedAnswer: string,
  correctAnswer: string,
  questionType: WebQuestionType,
): boolean {
  if (questionType === 'choice') {
    return normalizeChoiceAnswer(submittedAnswer) === normalizeChoiceAnswer(correctAnswer);
  }
  return normalizeFillInAnswer(submittedAnswer) === normalizeFillInAnswer(correctAnswer);
}

export function getMasteryDelta(difficulty: number, isCorrect: boolean): number {
  if (difficulty <= 2) return isCorrect ? 0.05 : -0.15;
  if (difficulty === 3) return isCorrect ? 0.1 : -0.08;
  return isCorrect ? 0.15 : -0.03;
}

export function applyMasteryDelta(currentScore: number, delta: number): number {
  return clamp01(roundToTwoDecimals(currentScore + delta));
}

export function getMasteryBand(
  score: number,
): 'not_started' | 'needs_work' | 'learning' | 'mastered' {
  if (score < 0.2) return 'not_started';
  if (score < 0.5) return 'needs_work';
  if (score < 0.85) return 'learning';
  return 'mastered';
}

function normalizeChoiceAnswer(answer: string): string {
  return normalizeCommon(answer)
    .replace(/[^A-Z]/g, '')
    .split('')
    .sort()
    .join('');
}

function normalizeFillInAnswer(answer: string): string {
  return normalizeCommon(answer)
    .replace(/[，、；]/g, ',')
    .replace(/[;；]/g, ',')
    .replace(/\s+/g, '');
}

function normalizeCommon(value: string): string {
  return value.trim().normalize('NFKC').toUpperCase();
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
