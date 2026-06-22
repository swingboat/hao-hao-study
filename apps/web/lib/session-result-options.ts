import type { QuestionType } from '@hao/db';

export interface SessionResultChoiceOption {
  label: string;
  text: string;
  isStudentAnswer: boolean;
  isCorrectAnswer: boolean;
}

export function buildSessionResultChoiceOptions(input: {
  questionType: QuestionType | string;
  options: readonly { label: string; text: string }[];
  studentAnswer: string;
  correctAnswer: string;
}): SessionResultChoiceOption[] {
  if (input.questionType !== 'choice') return [];

  const studentLabels = readAnswerLabels(input.studentAnswer);
  const correctLabels = readAnswerLabels(input.correctAnswer);

  return input.options.map((option) => {
    const label = normalizeOptionLabel(option.label);

    return {
      label: option.label,
      text: option.text,
      isStudentAnswer: studentLabels.has(label),
      isCorrectAnswer: correctLabels.has(label),
    };
  });
}

function readAnswerLabels(answer: string): Set<string> {
  return new Set(answer.trim().normalize('NFKC').toUpperCase().match(/[A-Z]/g) ?? []);
}

function normalizeOptionLabel(label: string): string {
  return label.trim().normalize('NFKC').toUpperCase();
}
