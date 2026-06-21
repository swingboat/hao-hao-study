import type { subject } from '@hao/db';
import {
  type EducationAnalysisFile,
  type EducationProgressEvent,
  analyzeLearningResource,
} from '@hao/llm';
import {
  type AdminDocumentCache,
  createQuestionAnalysisCache,
  resolveQuestionAnalysisRuntime,
} from './question-analysis-runtime';

export const QUESTION_PROMPT_VERSION = 'learning_resource/common/analyzeLearningResource';

export interface QuestionProgressSnapshot {
  phase:
    | 'preparing'
    | 'rendering'
    | 'analyzing'
    | 'synthesizing'
    | 'persisting'
    | 'done'
    | 'failed';
  startedAt: string;
  lastEventAt: string;
  pageCount?: number;
  pagesDone: number;
  pagesFailed: number;
  tokenUsageSoFar: { input: number; output: number } | null;
  questionCount?: number;
  figureCount?: number;
  lastEvent: string;
  errorMessage?: string | null;
}

export interface QuestionPipelineOptions {
  providerId: string;
  file: EducationAnalysisFile;
  subject: subject;
  knowledge?: unknown;
  concurrency?: number;
  maxRetries?: number;
  cache?: AdminDocumentCache;
  onProgress?: (snap: QuestionProgressSnapshot) => void;
}

export type QuestionPipelineResult = Awaited<ReturnType<typeof analyzeLearningResource>>;
export type QuestionAnalyzeRequest = Parameters<typeof analyzeLearningResource>[0];

export async function runQuestionAnalysis(
  opts: QuestionPipelineOptions,
): Promise<QuestionPipelineResult> {
  const startedAt = new Date().toISOString();
  const onProgress = opts.onProgress ?? (() => {});
  let totalPages: number | undefined;
  let pagesDone = 0;
  const pagesFailed = 0;

  const emit = (
    patch: Partial<QuestionProgressSnapshot> & {
      phase: QuestionProgressSnapshot['phase'];
      lastEvent: string;
    },
  ) => {
    onProgress({
      startedAt,
      lastEventAt: new Date().toISOString(),
      pageCount: totalPages,
      pagesDone,
      pagesFailed,
      tokenUsageSoFar: null,
      ...patch,
    });
  };

  emit({ phase: 'preparing', lastEvent: 'started analyzeLearningResource' });

  const result = await analyzeLearningResource(
    buildQuestionAnalyzeRequest(opts, (event) => {
      const snapshot = progressToSnapshot(event);
      if (event.stage === 'pdf_to_pages_done') {
        totalPages = event.total_pages;
      }
      if (event.stage === 'page_done') {
        pagesDone += 1;
      }
      emit(snapshot);
    }),
  );

  emit({
    phase: 'done',
    questionCount: learningResourceQuestionCount(result),
    figureCount: learningResourceFigureCount(result),
    lastEvent: `done: ${learningResourceQuestionCount(result)} questions`,
  });

  return result;

  function progressToSnapshot(event: EducationProgressEvent): Partial<QuestionProgressSnapshot> & {
    phase: QuestionProgressSnapshot['phase'];
    lastEvent: string;
  } {
    switch (event.stage) {
      case 'word_to_pdf':
      case 'pdf_to_pages':
        return { phase: 'rendering', lastEvent: event.message };
      case 'pdf_to_pages_done':
        return {
          phase: 'analyzing',
          pageCount: event.total_pages,
          lastEvent: event.message,
        };
      case 'page_started':
        return {
          phase: 'analyzing',
          pageCount: event.total_pages,
          lastEvent: event.message,
        };
      case 'page_done':
        return {
          phase: 'analyzing',
          pageCount: event.total_pages,
          lastEvent: event.message,
        };
      case 'page_retry_wait':
        return {
          phase: 'analyzing',
          pageCount: event.total_pages,
          lastEvent: retryWaitMessage(event.retry_after_ms),
        };
      case 'synthesis_started':
      case 'synthesis_done':
        return {
          phase: 'synthesizing',
          pageCount: event.total_pages,
          lastEvent: event.message,
        };
    }
  }
}

function retryWaitMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `遇到限流/临时错误，等待 ${seconds} 秒后重试`;
}

export function buildQuestionAnalyzeRequest(
  opts: QuestionPipelineOptions,
  onProgress: (event: EducationProgressEvent) => void,
): QuestionAnalyzeRequest {
  const runtime = resolveQuestionAnalysisRuntime();
  return {
    providerId: opts.providerId,
    file: opts.file,
    subjectName: opts.subject.name,
    knowledge: opts.knowledge,
    concurrency: opts.concurrency ?? runtime.concurrency,
    maxRetries: opts.maxRetries ?? runtime.maxRetries,
    cache: opts.cache ?? createQuestionAnalysisCache(),
    onProgress,
  };
}

function learningResourceQuestionCount(result: QuestionPipelineResult): number {
  return (result.knowledge_threads ?? []).reduce(
    (sum, thread) => sum + (Array.isArray(thread.questions) ? thread.questions.length : 0),
    0,
  );
}

function learningResourceFigureCount(result: QuestionPipelineResult): number {
  return (result.knowledge_threads ?? []).reduce((sum, thread) => {
    if (!Array.isArray(thread.questions)) return sum;
    return (
      sum +
      thread.questions.reduce((questionSum, question) => {
        const figures = (question as { figures?: unknown }).figures;
        return questionSum + (Array.isArray(figures) ? figures.length : 0);
      }, 0)
    );
  }, 0);
}
