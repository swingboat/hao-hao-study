import { formatQuestionText } from '@hao/llm';

export function formatStudentDisplayText(value: unknown): string {
  return formatQuestionText(value);
}
