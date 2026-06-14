import type { subject } from '@hao/db';
import {
  type EducationAnalysisFile,
  type EducationProgressEvent,
  analyzeQuestions,
} from '@hao/llm';

export const QUESTION_PROMPT_VERSION = 'questions/common/analyzeQuestions';

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
  onProgress?: (snap: QuestionProgressSnapshot) => void;
}

export type QuestionPipelineResult = Awaited<ReturnType<typeof analyzeQuestions>>;

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

  emit({ phase: 'preparing', lastEvent: 'started analyzeQuestions' });

  const result = await analyzeQuestions({
    providerId: opts.providerId,
    file: opts.file,
    knowledge: opts.knowledge,
    onProgress: (event) => {
      const snapshot = progressToSnapshot(event);
      if (event.stage === 'pdf_to_pages_done') {
        totalPages = event.total_pages;
      }
      if (event.stage === 'page_done') {
        pagesDone += 1;
      }
      emit(snapshot);
    },
  });

  emit({
    phase: 'done',
    questionCount: result.questions.length,
    figureCount: result.questions.reduce((sum, question) => {
      const figures = (question as { figures?: unknown }).figures;
      return sum + (Array.isArray(figures) ? figures.length : 0);
    }, 0),
    lastEvent: `done: ${result.questions.length} questions`,
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
