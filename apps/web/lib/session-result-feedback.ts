export interface ResultFeedbackAttempt {
  questionId: string;
  isCorrect: boolean;
}

export interface ResolvedMistakeFeedback {
  resolvedCount: number;
  resolvedQuestionIds: Set<string>;
  headline: string | null;
}

export function buildResolvedMistakeFeedback({
  attempts,
  resolvedQuestionIds,
}: {
  attempts: readonly ResultFeedbackAttempt[];
  resolvedQuestionIds: readonly string[];
}): ResolvedMistakeFeedback {
  const attemptedCorrectQuestionIds = new Set(
    attempts.filter((attempt) => attempt.isCorrect).map((attempt) => attempt.questionId),
  );
  const resolvedSet = new Set(
    resolvedQuestionIds.filter((questionId) => attemptedCorrectQuestionIds.has(questionId)),
  );
  const resolvedCount = resolvedSet.size;

  return {
    resolvedCount,
    resolvedQuestionIds: resolvedSet,
    headline: resolvedCount > 0 ? `本次攻克 ${resolvedCount} 道历史错题` : null,
  };
}
