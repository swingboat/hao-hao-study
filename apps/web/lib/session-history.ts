export interface SessionHistorySource {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  question_ids: readonly string[];
  question_attempts: readonly {
    is_correct: boolean;
  }[];
}

export interface SessionHistorySummary {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  accuracyPercent: number;
}

export function summarizeSessionHistory(source: SessionHistorySource): SessionHistorySummary {
  const answeredCount = source.question_attempts.length;
  const questionCount = source.question_ids.length || answeredCount;
  const correctCount = source.question_attempts.filter((attempt) => attempt.is_correct).length;
  const accuracyPercent =
    questionCount === 0 ? 0 : Math.round((correctCount / questionCount) * 100);

  return {
    id: source.id,
    started_at: source.started_at,
    ended_at: source.ended_at,
    questionCount,
    answeredCount,
    correctCount,
    accuracyPercent,
  };
}
