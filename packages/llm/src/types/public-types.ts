export type JsonObject = Record<string, any>;

export interface LlmTarget {
  id: string;
  provider: string;
  api_shape: string;
  model?: string | null;
  method?: string;
  path?: string;
  base_url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  aliases?: string[];
  capabilities?: string[];
  [key: string]: any;
}

export interface LlmConfig {
  base_url?: string;
  default_headers?: Record<string, string>;
  defaultLlmTargetId?: string;
  llmTargets?: LlmTarget[];
  defaultTargetId?: string;
  targets?: LlmTarget[];
  [key: string]: any;
}

export interface TargetConfig extends LlmConfig {}

export interface SourceFile {
  type?: "pdf" | "word" | "image" | string;
  name?: string;
  filename?: string;
  data?: string;
  path?: string;
  mimeType?: string;
  mime_type?: string;
}

export interface ParserProgressEvent {
  stage?: string;
  progress_percent?: number;
  page_number?: number;
  total_pages?: number;
  message?: string;
  cache_layer?: string;
  [key: string]: any;
}

export interface CommonParserOptions {
  concurrency?: number;
  maxRetries?: number;
  retryBackoffInitialMs?: number;
  retryBackoffMaxMs?: number;
  maxTokens?: number;
  maxPageTokens?: number;
  maxFinalTokens?: number;
  pageImageOutputDir?: string;
  temperature?: number;
  cache?: JsonObject;
  onProgress?: (event: ParserProgressEvent) => void;
  payloadLogPath?: string;
  payloadLogLimit?: number;
  renderDpi?: number;
  apiKey?: string;
  [key: string]: any;
}

export interface KnowledgePoint {
  id?: string;
  name: string;
  description?: string;
  formulas?: string[];
  examples?: string[];
  prerequisites?: string[];
  difficulty?: string;
  source_pages?: number[];
  chapter_number?: string;
  chapter_title?: string;
  section_number?: string;
  section_title?: string;
  source_name?: string;
  [key: string]: any;
}

export interface KnowledgeSection {
  id?: string;
  number?: string;
  title?: string;
  display_name?: string;
  source_pages?: number[];
  knowledge_points?: KnowledgePoint[];
  [key: string]: any;
}

export interface KnowledgeChapter {
  id?: string;
  number?: string;
  title?: string;
  display_name?: string;
  source_pages?: number[];
  sections?: KnowledgeSection[];
  knowledge_points?: KnowledgePoint[];
  [key: string]: any;
}

export interface RelatedKnowledgePoint {
  id?: string;
  name?: string;
  chapter?: string;
  section?: string;
  confidence?: number;
  reason?: string;
  [key: string]: any;
}

export interface Question {
  id?: string;
  number?: string;
  type?: string;
  stem?: string;
  options?: string[];
  answer?: string;
  analysis?: string;
  related_knowledge_points?: RelatedKnowledgePoint[];
  source_pages?: number[];
  [key: string]: any;
}

export interface ImageReference {
  kind?: "page_image" | string;
  reference_type?: "file_path" | string;
  page_number?: number;
  mime_type?: string;
  path?: string;
  [key: string]: any;
}

export interface LlmInfo {
  llm_target_id?: string;
  target_id?: string;
  provider?: string;
  model?: string | null;
  api_shape?: string;
}

export interface KnowledgePointsAnalysisResult {
  kind: "knowledge_points";
  status: "ok" | "partial" | "failed";
  source: {
    type: string;
    name: string;
    page_count?: number;
  };
  llm: LlmInfo;
  images?: ImageReference[];
  chapters: KnowledgeChapter[];
  knowledge_points: KnowledgePoint[];
  coverage?: JsonObject;
  diagnostics?: JsonObject;
  [key: string]: any;
}

export interface QuestionAnalysisResult {
  kind: "questions";
  status: "ok" | "partial" | "failed";
  source: {
    type: string;
    name: string;
    page_count?: number;
  };
  llm: LlmInfo;
  knowledge_source?: {
    count: number;
    source_type: string;
  };
  images?: ImageReference[];
  questions: Question[];
  diagnostics?: JsonObject;
  [key: string]: any;
}

export interface AnalyzeKnowledgePointsRequest extends CommonParserOptions {
  file?: SourceFile;
  pdf?: SourceFile;
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  llmTargetId?: string;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  targetId?: string;
}

export interface AnalyzeQuestionsRequest extends CommonParserOptions {
  file?: SourceFile;
  pdf?: SourceFile;
  word?: SourceFile;
  knowledge?: KnowledgePointsAnalysisResult | KnowledgePoint[] | Array<KnowledgePointsAnalysisResult | KnowledgePoint>;
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  llmTargetId?: string;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  targetId?: string;
  maxKnowledgeContextItems?: number;
}

export interface PageImage {
  pageNumber?: number;
  page_number?: number;
  mimeType?: string;
  mime_type?: string;
  data: string;
  path?: string;
  [key: string]: any;
}

export interface DocumentParseResult {
  document_type: string;
  llm_target_id?: string;
  target_id?: string;
  provider?: string;
  model?: string | null;
  api_shape?: string;
  ok?: boolean;
  http_status?: number | null;
  latency_ms?: number;
  usage?: JsonObject | null;
  text?: string;
  pages?: JsonObject[];
  images?: ImageReference[];
  raw_results?: any[];
  [key: string]: any;
}

export interface ParseImageRequest extends CommonParserOptions {
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  image: SourceFile;
  prompt?: string;
}

export interface ParsePdfRequest extends CommonParserOptions {
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  pdf: SourceFile;
  prompt?: string;
}

export interface ParseWordRequest extends CommonParserOptions {
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  word?: SourceFile;
  pages?: PageImage[];
  prompt?: string;
}

export interface ParseDocumentPagesRequest extends CommonParserOptions {
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  documentType?: string;
  pages: PageImage[];
  pagePrompt?: string | ((input: JsonObject) => string);
  finalPrompt?: string | ((input: JsonObject) => string);
  synthesize?: boolean;
  includePageImages?: boolean;
}

export interface LlmAttachment {
  type?: "image" | "pdf" | "document" | "file" | string;
  mimeType?: string;
  mime_type?: string;
  name?: string;
  filename?: string;
  data?: string;
  base64?: string;
  [key: string]: any;
}

export interface LlmMessage {
  role?: string;
  content?: any;
  [key: string]: any;
}

export interface LlmCallRequest {
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  input?: string;
  messages?: LlmMessage[];
  attachments?: LlmAttachment[];
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  payloadLogPath?: string;
  payloadLogLimit?: number;
  requestLabel?: string;
  [key: string]: any;
}

export interface LlmResult {
  ok: boolean;
  llm_target_id?: string;
  target_id: string;
  provider: string;
  model: string | null;
  api_shape: string;
  http_status: number | null;
  headers?: Record<string, string>;
  latency_ms: number;
  usage: JsonObject | null;
  text: string;
  raw: any;
  error_message?: string;
}

export interface BuiltLlmRequest {
  target_id: string;
  provider: string;
  model: string | null;
  api_shape: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

export interface FileSystemDocumentCacheOptions {
  rootDir: string;
  namespace?: string;
}

export interface DocumentCache {
  type?: string;
  rootDir?: string;
  namespace?: string;
  getJson(key: string): Promise<any>;
  setJson(key: string, value: any): Promise<void>;
}

export type AnalyzeKnowledgePoints = (request?: AnalyzeKnowledgePointsRequest) => Promise<KnowledgePointsAnalysisResult>;
export type AnalyzeQuestions = (request?: AnalyzeQuestionsRequest) => Promise<QuestionAnalysisResult>;
export type ParseImage = (request: ParseImageRequest) => Promise<DocumentParseResult>;
export type ParsePdf = (request: ParsePdfRequest) => Promise<DocumentParseResult>;
export type ParseWord = (request: ParseWordRequest) => Promise<DocumentParseResult>;
export type ParseDocumentPages = (request: ParseDocumentPagesRequest) => Promise<DocumentParseResult>;
export type CallLlm = (request: LlmCallRequest) => Promise<LlmResult>;
export type BuildLlmRequest = (request: LlmCallRequest) => BuiltLlmRequest;
