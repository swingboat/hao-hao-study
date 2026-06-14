/**
 * @hao/llm — Webex LLM Proxy 抽象层（Tech Stack D5 / 运营端 PRD §7）
 *
 * 对外契约：
 *   - callLLM(providerId, prompt, schema?, attachments?) → { data, rawText, tokenUsage,
 *     latencyMs, requestPayload, retries }
 *   - analyzePdf({providerId, pdfPath, ...}) → 整本 PDF 分片解析（bedrock_converse 路径）
 *   - analyzeImages({providerId, images, ...}) → 图片 batch 视觉抽题（openai_chat 路径，
 *     默认 webex-gemini-3.1-pro；含 figure bbox）
 *   - cropFiguresToStorage({...}) → bbox 裁切 + 落 ObjectStore + derived_asset 候选
 *   - rasterizePdf(pdfPath, opts) → pdftoppm 渲染每页 PNG（与 analyzeImages 配套）
 *
 * caller 流程：拿到 result.requestPayload → redactAuthHeaders → 落 llm_parse_job
 *
 * 模块清单：
 *   - callLLM.ts                            统一入口（DB 查 provider + dispatch + retry + schema 校验 + 429 退避）
 *   - providers/openai-chat.ts              OpenAI Chat Completions 协议（支持 image attachment）
 *   - providers/google-generate-content.ts  Google generateContent 协议
 *   - providers/bedrock-converse.ts         AWS Bedrock Converse 协议（原生 PDF）—— @deprecated 429 频发，软弃用
 *   - providers/types.ts                    ProviderAdapter 接口 + Attachment 类型（pdf | image）
 *   - pdf/qpdf.ts                           qpdf 命令封装（页数 + 切片）
 *   - pdf/rasterize.ts                      pdftoppm 命令封装（PDF → 每页 PNG）
 *   - pdf/analyze-pdf.ts                    PDF 分片 + 循环 callLLM + 终审整合（bedrock_converse 路径）—— @deprecated 见文件头
 *   - vision/analyze-image-batch.ts         L3 原语：一次 callLLM 喂 N 张图（多 image_url）
 *   - vision/analyze-images.ts              图片 batch 视觉抽题（openai_chat 路径，Gemini vision）
 *   - vision/analyze-images-to-storage.ts   analyzeImages + cropFigures + token 汇总（PDF/image 共用）
 *   - vision/extract-questions-from-pdf.ts      L2 教材抽题：chunked + 完整性自检 + 边界重抽 + dedup
 *   - vision/crop-figures.ts                按 bbox 裁切 + 落 storage + derived_asset 候选
 *   - analyze-file.ts                       L0 文件解析公共层（傻瓜入口：file + prompt → text）
 *   - json-schema.ts                        极简 zod → JSON Schema（structured output 用）
 *   - redact.ts                             请求 body 脱敏（PARSE_JOB.request_payload 入库前必经）
 */
export {
  callLLM,
  extractJsonBlock,
  LLMHttpError,
  LLMSchemaError,
  parseRetryDelaySeconds,
  type Attachment,
  type CallLLMOptions,
  type CallLLMResult,
} from './callLLM';
export {
  /** @deprecated bedrock_converse 路径 429 频发已软弃用，新业务请走 analyzePdfWithVision */
  analyzePdf,
  type AnalyzePdfOptions,
  type AnalyzePdfResult,
  type AnalyzedChunk,
  type AnalyzeProgressEvent,
  type ChunkPromptCtx,
  type FinalPromptCtx,
} from './pdf/analyze-pdf';
export {
  buildPageRanges,
  extractPdfChunk,
  getPdfPageCount,
  QpdfFailedError,
  QpdfMissingError,
} from './pdf/qpdf';
export {
  rasterizePdf,
  PdftoppmFailedError,
  PdftoppmMissingError,
  type RasterizePdfOptions,
  type RasterizedPage,
} from './pdf/rasterize';
export {
  analyzeImages,
  type AnalyzeImagesOptions,
  type AnalyzeImagesPromptCtx,
  type AnalyzeImagesProgressEvent,
  type AnalyzeImagesResult,
  type AnalyzedImage,
  type AnalyzeImagesInputImage,
  type ExtractedQuestion,
  type ExtractedResource,
  type Figure,
} from './vision/analyze-images';
export {
  cropFiguresToStorage,
  type CropFiguresOptions,
  type CropFiguresResult,
  type CroppedFigure,
} from './vision/crop-figures';
export {
  analyzeImagesToStorage,
  type AnalyzeImagesToStorageOptions,
  type AnalyzeImagesToStorageEvent,
  type AnalyzeImagesToStorageResult,
} from './vision/analyze-images-to-storage';
export {
  analyzeImageBatch,
  type AnalyzeImageBatchInputImage,
  type AnalyzeImageBatchOptions,
  type AnalyzeImageBatchResult,
} from './vision/analyze-image-batch';
export {
  runConcurrentPool,
  callWithSplitFallback,
  type ConcurrentPoolOpts,
  type PoolResult,
  type CallWithSplitFallbackOpts,
  type CallWithSplitFallbackResult,
} from './pdf-vision';
export {
  extractQuestionsFromPdf,
  type ExtractQuestionsFromPdfOptions,
  type ExtractQuestionsFromPdfResult,
  type ExtractQuestionsProgressEvent,
} from './vision/extract-questions-from-pdf';
export {
  analyzeFile,
  type AnalyzeFileBaseOptions,
  type AnalyzeFileImageOptions,
  type AnalyzeFileImageResult,
  type AnalyzeFilePdfOptions,
  type AnalyzeFilePdfResult,
  type AnalyzeFilePdfPageGroup,
} from './analyze-file';
export {
  analyzePdfWithVision,
  type AnalyzePdfWithVisionOptions,
  type AnalyzePdfWithVisionResult,
  type AnalyzePdfWithVisionEvent,
} from './pdf/analyze-pdf-with-vision';
export {
  analyzeKnowledgePoints,
  analyzeQuestions,
  type AnalyzeKnowledgePointsOptions,
  type AnalyzeQuestionsOptions,
  type EducationAnalysisFile,
  type EducationDocumentResult,
  type EducationPageResult,
  type EducationProgressEvent,
  type KnowledgePointAnalysisParserResult,
  type QuestionAnalysisParserResult,
} from './education-analysis';
export { redactAuthHeaders } from './redact';
export { zodToJsonSchema } from './json-schema';
export type { ProviderAdapter } from './providers/types';

export const LLM_VERSION = '0.1.0';
