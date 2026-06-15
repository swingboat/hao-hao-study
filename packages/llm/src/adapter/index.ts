import {
  analyzeKnowledgePoints as analyzeKnowledgePointsCommon,
  analyzeQuestions as analyzeQuestionsCommon,
} from '../business/education-analysis.ts';
import type {
  KnowledgePointsAnalysisResult,
  QuestionAnalysisResult,
  SourceFile,
} from '../types/public-types.ts';
import { resolveProviderTarget } from './provider-target';

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
  | { stage: 'synthesis_started' | 'synthesis_done'; progress_percent: number; message: string; total_pages: number };

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
export type QuestionAnalysisParserResult = QuestionAnalysisResult;

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

export async function analyzeQuestions(opts: AnalyzeQuestionsOptions): Promise<QuestionAnalysisResult> {
  const { providerId, ...commonOptions } = opts;
  const provider = await resolveProviderTarget(providerId);
  return callCommonQuestionAnalysis({
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

export const LLM_VERSION = '0.1.0';
