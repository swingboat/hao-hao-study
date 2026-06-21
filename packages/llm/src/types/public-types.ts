export type JsonObject = Record<string, unknown>;

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
  [key: string]: unknown;
}

export interface LlmConfig {
  base_url?: string;
  default_headers?: Record<string, string>;
  defaultLlmTargetId?: string;
  llmTargets?: LlmTarget[];
  defaultTargetId?: string;
  targets?: LlmTarget[];
  [key: string]: unknown;
}

export interface TargetConfig extends LlmConfig {}

export interface SourceFile {
  type?: 'pdf' | 'word' | 'image' | string;
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
  [key: string]: unknown;
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
  [key: string]: unknown;
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
  [key: string]: unknown;
}

export interface KnowledgeSection {
  id?: string;
  number?: string;
  title?: string;
  display_name?: string;
  source_pages?: number[];
  knowledge_points?: KnowledgePoint[];
  [key: string]: unknown;
}

export interface KnowledgeChapter {
  id?: string;
  number?: string;
  title?: string;
  display_name?: string;
  source_pages?: number[];
  sections?: KnowledgeSection[];
  knowledge_points?: KnowledgePoint[];
  [key: string]: unknown;
}

export interface RelatedKnowledgePoint {
  id?: string;
  name?: string;
  chapter?: string;
  section?: string;
  confidence?: number;
  reason?: string;
  [key: string]: unknown;
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
  [key: string]: unknown;
}

export interface ImageReference {
  kind?: 'page_image' | string;
  reference_type?: 'file_path' | string;
  page_number?: number;
  mime_type?: string;
  path?: string;
  [key: string]: unknown;
}

export interface LlmInfo {
  llm_target_id?: string;
  target_id?: string;
  provider?: string;
  model?: string | null;
  api_shape?: string;
}

export interface AnalysisDiagnostics extends JsonObject {
  parse_error?: string | null;
}

export interface KnowledgePointsAnalysisResult {
  kind: 'knowledge_points';
  status: 'ok' | 'partial' | 'failed';
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
  diagnostics?: AnalysisDiagnostics;
  [key: string]: unknown;
}

export interface QuestionAnalysisResult {
  kind: 'questions';
  status: 'ok' | 'partial' | 'failed';
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
  diagnostics?: AnalysisDiagnostics;
  [key: string]: unknown;
}

export interface MixedLearningMaterialSourceDocument {
  source_type:
    | 'lesson_handout'
    | 'workbook'
    | 'question_pack'
    | 'exam_paper'
    | 'answer_book'
    | 'textbook'
    | 'mixed_material';
  title: string;
  subject_name: string;
  stage: 'primary' | 'junior' | 'senior';
  grade: string;
  provider: string;
  publisher: string;
  year: number | null;
  season: string;
  exam_name: string;
  paper_name: string;
  region: string;
  lesson_no: string;
  page_count: number;
  [key: string]: unknown;
}

export interface MixedLearningMaterialSourceUnit {
  unit_kind: 'page' | 'slide' | 'question_region' | 'explanation_region' | 'text_block';
  page_no: number;
  slide_no?: number;
  question_no?: string;
  bbox?: [number, number, number, number];
  text_snippet: string;
  [key: string]: unknown;
}

export interface MixedLearningMaterialKnowledgePoint {
  name: string;
  chapter_no: string | null;
  brief: string;
  [key: string]: unknown;
}

export interface MixedLearningMaterialSourceRef {
  page: number;
  slide_no?: number;
  question_no?: string;
  text_snippet?: string;
  [key: string]: unknown;
}

export interface MixedLearningMaterial {
  material_type:
    | 'method_card'
    | 'common_mistake'
    | 'question_type_summary'
    | 'exam_trend'
    | 'textbook_deep_dive'
    | 'solution_summary'
    | 'concept_explanation'
    | 'study_advice';
  title: string;
  content: string;
  student_summary: string;
  content_origin: 'source_extract' | 'model_summary';
  kp_hints: string[];
  source_ref: MixedLearningMaterialSourceRef;
  confidence: number;
  [key: string]: unknown;
}

export interface MixedLearningMaterialQuestion {
  content: string;
  question_type: 'choice' | 'fill_in' | 'short_answer' | 'solution' | 'proof' | 'unknown';
  options: Array<{
    label: string;
    text: string;
    [key: string]: unknown;
  }>;
  answer: string;
  solution_text: string;
  difficulty: number;
  kp_hints: string[];
  quality_status:
    | 'publishable'
    | 'missing_answer'
    | 'missing_solution'
    | 'incomplete_stem'
    | 'needs_human_review';
  source_ref: MixedLearningMaterialSourceRef;
  [key: string]: unknown;
}

export interface MixedLearningMaterialBatch {
  source_document: MixedLearningMaterialSourceDocument;
  source_units: MixedLearningMaterialSourceUnit[];
  knowledge_points: MixedLearningMaterialKnowledgePoint[];
  learning_materials: MixedLearningMaterial[];
  questions: MixedLearningMaterialQuestion[];
  knowledge_source?: {
    count: number;
    source_type: string;
  };
  llm?: LlmInfo;
  diagnostics?: JsonObject;
  [key: string]: unknown;
}

export interface LearningResourceThreadItem {
  title: string;
  content: string;
  content_origin: 'source_extract' | 'model_summary';
  source_ref: MixedLearningMaterialSourceRef;
  confidence: number;
  student_summary?: string;
  kp_hints?: string[];
  [key: string]: unknown;
}

export interface LearningResourceKnowledgeThread {
  knowledge_point: {
    id: string;
    name: string;
    chapter_no: string | null;
    brief: string;
    match_confidence: number;
    [key: string]: unknown;
  };
  concept_explanations: LearningResourceThreadItem[];
  method_cards: LearningResourceThreadItem[];
  common_mistakes: LearningResourceThreadItem[];
  question_type_summaries: LearningResourceThreadItem[];
  exam_trends: LearningResourceThreadItem[];
  textbook_deep_dives: LearningResourceThreadItem[];
  solution_summaries: LearningResourceThreadItem[];
  study_advice: LearningResourceThreadItem[];
  questions: MixedLearningMaterialQuestion[];
  source_refs: MixedLearningMaterialSourceRef[];
  [key: string]: unknown;
}

export interface LearningResourceUnmappedItem {
  item_type: 'learning_material' | 'question' | 'knowledge_point' | 'source_unit';
  reason:
    | 'no_matching_knowledge_point'
    | 'low_confidence'
    | 'ambiguous'
    | 'non_learning_content_filtered';
  title: string;
  content: string;
  source_ref: MixedLearningMaterialSourceRef;
  suggested_kp_hints: string[];
  [key: string]: unknown;
}

export interface LearningResourceAnalysisBatch {
  kind: 'learning_resource';
  source_document: MixedLearningMaterialSourceDocument;
  knowledge_threads: LearningResourceKnowledgeThread[];
  unmapped_items: LearningResourceUnmappedItem[];
  filtered_items_summary: {
    count: number;
    categories: string[];
    [key: string]: unknown;
  };
  diagnostics: {
    fallback_used: string | null;
    parse_error: unknown | null;
    validation_error: unknown | null;
    payload_log_path: string;
    [key: string]: unknown;
  };
  knowledge_source?: {
    count: number;
    source_type: string;
  };
  llm?: LlmInfo;
  [key: string]: unknown;
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
  knowledge?:
    | KnowledgePointsAnalysisResult
    | KnowledgePoint[]
    | Array<KnowledgePointsAnalysisResult | KnowledgePoint>;
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  llmTargetId?: string;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  targetId?: string;
  maxKnowledgeContextItems?: number;
}

export interface AnalyzeMixedLearningMaterialRequest extends CommonParserOptions {
  file?: SourceFile;
  pdf?: SourceFile;
  word?: SourceFile;
  image?: SourceFile;
  subjectName?: string;
  knowledge?:
    | KnowledgePointsAnalysisResult
    | KnowledgePoint[]
    | Array<KnowledgePointsAnalysisResult | KnowledgePoint>;
  llmConfig?: LlmConfig;
  llmTarget?: LlmTarget;
  llmTargetId?: string;
  targetConfig?: LlmConfig;
  target?: LlmTarget;
  targetId?: string;
  maxKnowledgeContextItems?: number;
}

export interface AnalyzeLearningResourceRequest extends AnalyzeMixedLearningMaterialRequest {}

export interface PageImage {
  pageNumber?: number;
  page_number?: number;
  mimeType?: string;
  mime_type?: string;
  data: string;
  path?: string;
  [key: string]: unknown;
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
  raw_results?: unknown[];
  [key: string]: unknown;
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
  type?: 'image' | 'pdf' | 'document' | 'file' | string;
  mimeType?: string;
  mime_type?: string;
  name?: string;
  filename?: string;
  data?: string;
  base64?: string;
  [key: string]: unknown;
}

export interface LlmMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
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
  [key: string]: unknown;
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
  raw: unknown;
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
  body: unknown;
}

export interface FileSystemDocumentCacheOptions {
  rootDir: string;
  namespace?: string;
}

export interface DocumentCache {
  type?: string;
  rootDir?: string;
  namespace?: string;
  getJson(key: string): Promise<unknown>;
  setJson(key: string, value: unknown): Promise<void>;
}

export type AnalyzeKnowledgePoints = (
  request?: AnalyzeKnowledgePointsRequest,
) => Promise<KnowledgePointsAnalysisResult>;
export type AnalyzeLearningResource = (
  request?: AnalyzeLearningResourceRequest,
) => Promise<LearningResourceAnalysisBatch>;
export type AnalyzeMixedLearningMaterial = (
  request?: AnalyzeMixedLearningMaterialRequest,
) => Promise<MixedLearningMaterialBatch>;
export type AnalyzeQuestions = (
  request?: AnalyzeQuestionsRequest,
) => Promise<QuestionAnalysisResult>;
export type ParseImage = (request: ParseImageRequest) => Promise<DocumentParseResult>;
export type ParsePdf = (request: ParsePdfRequest) => Promise<DocumentParseResult>;
export type ParseWord = (request: ParseWordRequest) => Promise<DocumentParseResult>;
export type ParseDocumentPages = (
  request: ParseDocumentPagesRequest,
) => Promise<DocumentParseResult>;
export type CallLlm = (request: LlmCallRequest) => Promise<LlmResult>;
export type BuildLlmRequest = (request: LlmCallRequest) => BuiltLlmRequest;
