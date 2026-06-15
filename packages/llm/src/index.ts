import {
  analyzeKnowledgePoints as analyzeKnowledgePointsImpl,
  analyzeQuestions as analyzeQuestionsImpl
} from "./business/education-analysis.ts";
import {
  buildFinalDocumentPrompt as buildFinalDocumentPromptImpl,
  buildImagePrompt as buildImagePromptImpl,
  buildPagePrompt as buildPagePromptImpl,
  buildPdfPrompt as buildPdfPromptImpl,
  buildWordPrompt as buildWordPromptImpl,
  convertWordToPdf as convertWordToPdfImpl,
  parseDocumentPages as parseDocumentPagesImpl,
  parseImage as parseImageImpl,
  parsePdf as parsePdfImpl,
  parsePdfDirect as parsePdfDirectImpl,
  parsePdfPages as parsePdfPagesImpl,
  parseWord as parseWordImpl,
  parseWordDirect as parseWordDirectImpl,
  parseWordPages as parseWordPagesImpl,
  renderPdfToPageImages as renderPdfToPageImagesImpl
} from "./documents/document-parser.ts";
import {
  buildLlmRequest as buildLlmRequestImpl,
  callLlm as callLlmImpl,
  extractLlmText as extractLlmTextImpl,
  extractLlmUsage as extractLlmUsageImpl
} from "./llm/llm-client.ts";
import {
  buildDisplayTextFormatterBrowserScript as buildDisplayTextFormatterBrowserScriptImpl,
  formatDisplayText as formatDisplayTextImpl,
  formatExamText as formatExamTextImpl,
  formatQuestionText as formatQuestionTextImpl
} from "./display/display-text-format.ts";
import { createFileSystemDocumentCache as createFileSystemDocumentCacheImpl } from "./documents/document-cache.ts";

import type {
  AnalyzeKnowledgePoints,
  AnalyzeQuestions,
  BuildLlmRequest,
  CallLlm,
  DocumentCache,
  FileSystemDocumentCacheOptions,
  ParseDocumentPages,
  ParseImage,
  ParsePdf,
  ParseWord
} from "./types/public-types.ts";

export type {
  AnalyzeKnowledgePointsRequest,
  AnalyzeQuestionsRequest,
  BuiltLlmRequest,
  CommonParserOptions,
  DocumentCache,
  DocumentParseResult,
  FileSystemDocumentCacheOptions,
  JsonObject,
  KnowledgeChapter,
  KnowledgePoint,
  KnowledgePointsAnalysisResult,
  KnowledgeSection,
  LlmConfig,
  LlmAttachment,
  LlmCallRequest,
  LlmInfo,
  LlmMessage,
  LlmResult,
  LlmTarget,
  PageImage,
  ParseDocumentPagesRequest,
  ParseImageRequest,
  ParsePdfRequest,
  ParseWordRequest,
  ParserProgressEvent,
  Question,
  QuestionAnalysisResult,
  RelatedKnowledgePoint,
  SourceFile,
  TargetConfig
} from "./types/public-types.ts";

export const analyzeKnowledgePoints = analyzeKnowledgePointsImpl as unknown as AnalyzeKnowledgePoints;
export const analyzeQuestions = analyzeQuestionsImpl as unknown as AnalyzeQuestions;

export const parseImage = parseImageImpl as unknown as ParseImage;
export const parsePdf = parsePdfImpl as unknown as ParsePdf;
export const parsePdfDirect = parsePdfDirectImpl as unknown as ParsePdf;
export const parsePdfPages = parsePdfPagesImpl as unknown as ParsePdf;
export const parseWord = parseWordImpl as unknown as ParseWord;
export const parseWordDirect = parseWordDirectImpl as unknown as ParseWord;
export const parseWordPages = parseWordPagesImpl as unknown as ParseWord;
export const parseDocumentPages = parseDocumentPagesImpl as unknown as ParseDocumentPages;

export const callLlm = callLlmImpl as unknown as CallLlm;
export const buildLlmRequest = buildLlmRequestImpl as unknown as BuildLlmRequest;
export const extractLlmText = extractLlmTextImpl as unknown as (body: any, apiShape?: string) => string;
export const extractLlmUsage = extractLlmUsageImpl as unknown as (body: any, apiShape?: string) => Record<string, any> | null;

export const formatDisplayText = formatDisplayTextImpl as (value: unknown) => string;
export const formatQuestionText = formatQuestionTextImpl as (value: unknown) => string;
export const formatExamText = formatExamTextImpl as (value: unknown) => string;
export const buildDisplayTextFormatterBrowserScript = buildDisplayTextFormatterBrowserScriptImpl as () => string;

export const buildImagePrompt = buildImagePromptImpl as () => string;
export const buildPdfPrompt = buildPdfPromptImpl as () => string;
export const buildWordPrompt = buildWordPromptImpl as () => string;
export const buildPagePrompt = buildPagePromptImpl as (input: { documentType?: string; pageNumber?: number }) => string;
export const buildFinalDocumentPrompt = buildFinalDocumentPromptImpl as (input: { documentType?: string; pageResults: any[] }) => string;

export const convertWordToPdf = convertWordToPdfImpl as (input: any) => Promise<any>;
export const renderPdfToPageImages = renderPdfToPageImagesImpl as (input: any) => Promise<any[]>;
export const createFileSystemDocumentCache = createFileSystemDocumentCacheImpl as (
  options: FileSystemDocumentCacheOptions
) => DocumentCache;
