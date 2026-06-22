export interface LearningResourceJobOutcomeInput {
  ok?: unknown;
  diagnostics?: {
    parse_error?: unknown | null;
    validation_error?: unknown | null;
    fallback_used?: unknown | null;
  } | null;
}

export interface LearningResourceJobOutcome {
  status: 'succeeded' | 'failed';
  errorMessage: string | null;
}

export function learningResourceParseJobOutcome(
  result: LearningResourceJobOutcomeInput,
  stagingEntityCount: number,
): LearningResourceJobOutcome {
  const reason =
    result.diagnostics?.parse_error ??
    result.diagnostics?.validation_error ??
    (result.ok === false ? 'analyzeLearningResource returned failed' : null);
  const hasReviewableOutput = stagingEntityCount > 0;

  if (!reason || hasReviewableOutput) {
    return { status: 'succeeded', errorMessage: null };
  }

  return {
    status: 'failed',
    errorMessage: reasonToMessage(reason),
  };
}

function reasonToMessage(reason: unknown): string {
  return typeof reason === 'string' ? reason : JSON.stringify(reason).slice(0, 500);
}
