import type { GenerateQuestionAnswerDraftOptions, QuestionAnswerDraftParserResult } from '@hao/llm';
import { stripDuplicatedChoiceOptionsFromContent } from './question-content.ts';

export const DEFAULT_ANSWER_DRAFT_PROVIDER_ID = 'openai-chat-gemini-3-5-flash-global';

const ANSWER_DRAFT_PROVIDER_ALIASES = [
  DEFAULT_ANSWER_DRAFT_PROVIDER_ID,
  'openai-chat-gemini-3.5-flash-global',
  'openai-chat-gemini-3.5-flash',
];

export interface DraftQuestionPayload {
  content?: string;
  question_type?: 'choice' | 'fill_in' | string;
  options?: Array<{ label?: string; text?: string; content?: string; value?: string } | string>;
  answer?: string;
  solution_text?: string;
  kp_hints?: string[];
  quality_status?: string;
  source_ref?: Record<string, unknown>;
  image_description?: string;
  figures?: Record<string, unknown>[];
}

export interface BuildQuestionAnswerDraftRequestInput {
  providerId?: string | null;
  payload: DraftQuestionPayload;
  subjectName?: string | null;
  knowledge?: unknown;
}

type NormalizedQuestionOption = { label: string; text: string };
type AnswerDraftProviderCandidate = { id: string; model?: string | null };

export type GenerateQuestionAnswerDraftFn = (
  request: GenerateQuestionAnswerDraftOptions,
) => Promise<QuestionAnswerDraftParserResult>;

export function buildQuestionAnswerDraftRequest({
  providerId = DEFAULT_ANSWER_DRAFT_PROVIDER_ID,
  payload,
  subjectName,
  knowledge,
}: BuildQuestionAnswerDraftRequestInput): GenerateQuestionAnswerDraftOptions {
  const options = normalizeOptions(payload.options);
  const questionType = payload.question_type ?? 'unknown';
  const content =
    questionType === 'choice'
      ? stripDuplicatedChoiceOptionsFromContent(payload.content ?? '', options)
      : (payload.content ?? '').trim();

  const question: GenerateQuestionAnswerDraftOptions['question'] = {
    content,
    question_type: questionType,
    options,
    answer: payload.answer ?? '',
    solution_text: payload.solution_text ?? '',
    kp_hints: payload.kp_hints ?? [],
    subjectName: subjectName ?? undefined,
    source_ref: payload.source_ref,
  };
  if (payload.image_description?.trim()) {
    question.image_description = payload.image_description;
  }
  if (payload.figures && payload.figures.length > 0) {
    question.figures = payload.figures;
  }

  return {
    providerId: providerId?.trim() || DEFAULT_ANSWER_DRAFT_PROVIDER_ID,
    question,
    knowledge,
    maxTokens: null,
  } as unknown as GenerateQuestionAnswerDraftOptions;
}

export async function requestQuestionAnswerDraft({
  generateDraft,
  ...input
}: BuildQuestionAnswerDraftRequestInput & {
  generateDraft: GenerateQuestionAnswerDraftFn;
}): Promise<QuestionAnswerDraftParserResult> {
  return generateDraft(buildQuestionAnswerDraftRequest(input));
}

export function isMissingAnswerDraftCandidate(payload: DraftQuestionPayload): boolean {
  return (payload.answer ?? '').trim() === '' && payload.quality_status === 'missing_answer';
}

export function canApplyQuestionAnswerDraft(input: {
  answer?: string | null;
  warnings?: string[] | null;
}): boolean {
  return Boolean(input.answer?.trim()) && (input.warnings ?? []).length === 0;
}

export function selectAnswerDraftProvider<T extends AnswerDraftProviderCandidate>(
  providers: T[],
): T | null {
  return (
    providers.find((provider) => provider.id === DEFAULT_ANSWER_DRAFT_PROVIDER_ID) ??
    providers.find((provider) => ANSWER_DRAFT_PROVIDER_ALIASES.includes(provider.id)) ??
    providers.find((provider) => provider.model === 'google.gemini-3.5-flash-global') ??
    providers[0] ??
    null
  );
}

function normalizeOptions(value: DraftQuestionPayload['options']): NormalizedQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const match = item.trim().match(/^([A-Za-z])[\.\u3001\uff0e]?\s*(.*)$/);
        return {
          label: (match?.[1] ?? String.fromCharCode(65 + index)).toUpperCase(),
          text: (match?.[2] ?? item).trim(),
        };
      }
      return {
        label: item.label ?? String.fromCharCode(65 + index),
        text: item.text ?? item.content ?? item.value ?? '',
      };
    })
    .filter((item) => item.text.trim().length > 0);
}
