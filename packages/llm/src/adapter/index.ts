import {
  analyzeKnowledgePoints as analyzeKnowledgePointsCommon,
  analyzeLearningResource as analyzeLearningResourceCommon,
  analyzeMixedLearningMaterial as analyzeMixedLearningMaterialCommon,
  analyzeQuestions as analyzeQuestionsCommon,
} from '../business/education-analysis.ts';
import {
  generateQuestionAnswerDraft as generateQuestionAnswerDraftCommon,
  questionAnswerDraftSchema,
} from '../business/question-answer-draft.ts';
import {
  generateSessionReviewAdvice as generateSessionReviewAdviceCommon,
  sessionReviewAdviceSchema,
} from '../business/session-review-advice.ts';
import type {
  KnowledgePointsAnalysisResult,
  LearningResourceAnalysisBatch,
  LlmConfig,
  LlmTarget,
  MixedLearningMaterialBatch,
  QuestionAnalysisResult,
  QuestionAnswerDraftQuestion,
  QuestionAnswerDraftResult,
  SessionReviewAdviceResult,
  SourceFile,
} from '../types/public-types.ts';
import { resolveProviderTarget } from './provider-target';

export type {
  SessionReviewAdvice,
  SessionReviewAdviceFocusItem,
  SessionReviewAdviceResult,
} from '../types/public-types.ts';
export {
  formatDisplayText,
  formatExamText,
  formatQuestionText,
} from '../display/display-text-format.ts';
export {
  learningResourceAnalysisBatchSchema,
  mixedLearningMaterialBatchSchema,
} from '../business/mixed-learning-material-parser.ts';
export { questionAnswerDraftSchema, sessionReviewAdviceSchema };

interface AdapterCommonOptions {
  concurrency?: number;
  maxRetries?: number;
  maxTokens?: number;
  maxPageTokens?: number;
  maxFinalTokens?: number;
  pageImageOutputDir?: string;
  temperature?: number;
  cache?: Record<string, unknown>;
  onProgress?: (event: EducationProgressEvent) => void;
  payloadLogPath?: string;
  payloadLogLimit?: number;
  renderDpi?: number;
  apiKey?: string;
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  llmTargetId?: string;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  targetId?: string;
  [key: string]: unknown;
}

export type EducationAnalysisFile = SourceFile;
export type EducationProgressEvent =
  | { stage: 'pdf_to_pages'; progress_percent: number; message: string }
  | { stage: 'word_to_pdf'; progress_percent: number; message: string }
  | { stage: 'pdf_to_pages_done'; progress_percent: number; message: string; total_pages: number }
  | {
      stage: 'page_started' | 'page_done';
      progress_percent: number;
      page_number: number;
      total_pages: number;
      message: string;
    }
  | {
      stage: 'page_retry_wait';
      progress_percent: number;
      page_number: number;
      total_pages: number;
      message: string;
      http_status: number | null;
      retry_after_ms: number;
      retry_delay_ms: number;
      retry_delay_source: string;
      attempt: number;
      next_attempt: number;
    }
  | {
      stage: 'synthesis_started' | 'synthesis_done';
      progress_percent: number;
      message: string;
      total_pages: number;
    };

export interface AnalyzeKnowledgePointsOptions extends AdapterCommonOptions {
  providerId: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
}

export interface AnalyzeQuestionsOptions extends AdapterCommonOptions {
  providerId: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
  word?: EducationAnalysisFile;
  knowledge?: unknown;
  maxKnowledgeContextItems?: number;
}
export type KnowledgePointAnalysisParserResult = KnowledgePointsAnalysisResult;
export type LearningResourceAnalysisParserResult = LearningResourceAnalysisBatch;
export type MixedLearningMaterialAnalysisParserResult = MixedLearningMaterialBatch;
export type QuestionAnalysisParserResult = QuestionAnalysisResult;
export type SessionReviewAdviceParserResult = SessionReviewAdviceResult;
export type QuestionAnswerDraftParserResult = QuestionAnswerDraftResult;

export interface GenerateQuestionAnswerDraftOptions extends AdapterCommonOptions {
  providerId?: string;
  question: QuestionAnswerDraftQuestion;
  knowledge?: unknown;
}

export interface GenerateSessionReviewAdviceOptions extends AdapterCommonOptions {
  providerId?: string;
  input: Record<string, unknown>;
}

export interface AnalyzeLearningResourceOptions extends AdapterCommonOptions {
  providerId?: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
  word?: EducationAnalysisFile;
  image?: EducationAnalysisFile;
  subjectName?: string;
  knowledge?: unknown;
  maxKnowledgeContextItems?: number;
}

export interface AnalyzeMixedLearningMaterialOptions extends AdapterCommonOptions {
  providerId?: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
  word?: EducationAnalysisFile;
  image?: EducationAnalysisFile;
  subjectName?: string;
  knowledge?: unknown;
  maxKnowledgeContextItems?: number;
}

export async function analyzeKnowledgePoints(
  opts: AnalyzeKnowledgePointsOptions,
): Promise<KnowledgePointsAnalysisResult> {
  const { providerId, ...commonOptions } = opts;
  const provider = await resolveProviderTarget(providerId);
  return callCommonKnowledgeAnalysis({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

export async function analyzeQuestions(
  opts: AnalyzeQuestionsOptions,
): Promise<QuestionAnalysisResult> {
  const { providerId, ...commonOptions } = opts;
  const provider = await resolveProviderTarget(providerId);
  return callCommonQuestionAnalysis({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

export async function analyzeLearningResource(
  opts: AnalyzeLearningResourceOptions,
): Promise<LearningResourceAnalysisBatch> {
  const { providerId, ...commonOptions } = opts;
  if (!providerId) {
    return callCommonLearningResourceAnalysis(commonOptions);
  }

  const provider = await resolveProviderTarget(providerId);
  return callCommonLearningResourceAnalysis({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

export async function generateSessionReviewAdvice(
  opts: GenerateSessionReviewAdviceOptions,
): Promise<SessionReviewAdviceResult> {
  const { providerId, ...commonOptions } = opts;
  if (!providerId) {
    return callCommonSessionReviewAdvice(commonOptions);
  }

  const provider = await resolveProviderTarget(providerId);
  return callCommonSessionReviewAdvice({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

export async function generateQuestionAnswerDraft(
  opts: GenerateQuestionAnswerDraftOptions,
): Promise<QuestionAnswerDraftResult> {
  const { providerId, ...commonOptions } = opts;
  if (!providerId) {
    return callCommonQuestionAnswerDraft(commonOptions);
  }

  const provider = await resolveProviderTarget(providerId);
  return callCommonQuestionAnswerDraft({
    ...withQuestionAnswerDraftProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

export async function analyzeMixedLearningMaterial(
  opts: AnalyzeMixedLearningMaterialOptions,
): Promise<MixedLearningMaterialBatch> {
  const { providerId, ...commonOptions } = opts;
  if (!providerId) {
    return callCommonMixedLearningMaterialAnalysis(commonOptions);
  }

  const provider = await resolveProviderTarget(providerId);
  return callCommonMixedLearningMaterialAnalysis({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

const callCommonKnowledgeAnalysis = analyzeKnowledgePointsCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<KnowledgePointsAnalysisResult>;

const callCommonQuestionAnalysis = analyzeQuestionsCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<QuestionAnalysisResult>;

const callCommonLearningResourceAnalysis = analyzeLearningResourceCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<LearningResourceAnalysisBatch>;

const callCommonSessionReviewAdvice = generateSessionReviewAdviceCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<SessionReviewAdviceResult>;

const callCommonQuestionAnswerDraft = generateQuestionAnswerDraftCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<QuestionAnswerDraftResult>;

const callCommonMixedLearningMaterialAnalysis = analyzeMixedLearningMaterialCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<MixedLearningMaterialBatch>;

function withProviderDefaults<T extends Record<string, unknown>>(
  options: T,
  defaults: { temperature?: number; maxTokens?: number },
): T {
  return {
    ...options,
    temperature: options.temperature ?? defaults.temperature,
    maxPageTokens: options.maxPageTokens ?? defaults.maxTokens,
    maxFinalTokens: options.maxFinalTokens ?? defaults.maxTokens,
  };
}

function withQuestionAnswerDraftProviderDefaults<T extends Record<string, unknown>>(
  options: T,
  defaults: { temperature?: number; maxTokens?: number },
): T {
  const output = {
    ...options,
    temperature: options.temperature ?? defaults.temperature,
  };
  if (options.maxTokens !== undefined) {
    return {
      ...output,
      maxTokens: options.maxTokens,
    };
  }
  return output;
}

export const LLM_VERSION = '0.1.0';
