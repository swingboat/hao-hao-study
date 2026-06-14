import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { callLLM } from './callLLM';
import { rasterizePdf, type RasterizedPage } from './pdf/rasterize';
import { analyzeImageBatch } from './vision/analyze-image-batch';

export type EducationFileType = 'pdf' | 'word';

export interface EducationAnalysisFile {
  type?: EducationFileType | string;
  name?: string;
  filename?: string;
  data?: string;
  path?: string;
  mimeType?: string;
  mime_type?: string;
}

export interface EducationPageResult {
  page_number: number;
  ok?: boolean;
  text: string;
  usage?: unknown;
  latency_ms?: number;
  http_status?: number | null;
  error_message?: string;
}

export interface EducationDocumentResult {
  document_type?: string;
  target_id?: string;
  provider?: string;
  model?: string | null;
  api_shape?: string | null;
  ok?: boolean;
  latency_ms?: number;
  usage?: unknown;
  text?: string;
  pages?: EducationPageResult[];
  raw_results?: unknown[];
  parse_error?: string | null;
  uncertain_notes?: unknown;
}

export interface KnowledgePointAnalysisParserResult extends EducationDocumentResult {
  chapters?: unknown;
  knowledge_points?: unknown;
  coverage_summary?: unknown;
  target_knowledge_point_range?: string;
  fallback_used?: string;
  payload_log_path?: string;
}

export interface QuestionAnalysisParserResult extends EducationDocumentResult {
  question_count?: number;
  questions?: unknown;
}

export interface EducationParserRequest {
  providerId: string;
  file: Required<Pick<NormalizedAnalysisFile, 'type' | 'name'>> &
    Pick<NormalizedAnalysisFile, 'data' | 'path' | 'mimeType'>;
  concurrency?: number;
  maxPageTokens?: number;
  maxFinalTokens?: number;
  renderDpi?: number;
  onProgress?: (event: EducationProgressEvent) => void;
}

export interface QuestionParserRequest extends EducationParserRequest {
  knowledgeContext: string;
}

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

export interface AnalyzeKnowledgePointsOptions extends Omit<EducationParserRequest, 'file'> {
  file?: EducationAnalysisFile;
  pdf?: Omit<EducationAnalysisFile, 'type'>;
  parsePdfKnowledgePointsImpl?: (
    request: EducationParserRequest,
  ) => Promise<KnowledgePointAnalysisParserResult>;
}

export interface AnalyzeQuestionsOptions extends Omit<EducationParserRequest, 'file'> {
  file?: EducationAnalysisFile;
  pdf?: Omit<EducationAnalysisFile, 'type'>;
  word?: Omit<EducationAnalysisFile, 'type'>;
  knowledge?: unknown;
  maxKnowledgeContextItems?: number;
  parsePdfQuestionsImpl?: (request: QuestionParserRequest) => Promise<QuestionAnalysisParserResult>;
  parseWordQuestionsImpl?: (request: QuestionParserRequest) => Promise<QuestionAnalysisParserResult>;
}

interface NormalizedAnalysisFile {
  type: EducationFileType;
  name: string;
  data?: string;
  path?: string;
  mimeType?: string;
}

type JsonObject = Record<string, unknown>;

export async function analyzeKnowledgePoints(
  opts: AnalyzeKnowledgePointsOptions = { providerId: '' },
) {
  const providerId = requireProviderId(opts.providerId);
  const sourceFile = normalizeAnalysisFile({
    file: opts.file,
    pdf: opts.pdf,
    defaultType: 'pdf',
    allowedTypes: ['pdf'],
  });
  const parser = opts.parsePdfKnowledgePointsImpl ?? parsePdfKnowledgePoints;
  const parserResult = await parser({
    providerId,
    file: fileToParserDocument(sourceFile),
    concurrency: opts.concurrency,
    maxPageTokens: opts.maxPageTokens,
    maxFinalTokens: opts.maxFinalTokens,
    renderDpi: opts.renderDpi,
    onProgress: opts.onProgress,
  });
  return buildKnowledgeAnalysisResult({ result: parserResult, file: sourceFile, providerId });
}

export async function analyzeQuestions(opts: AnalyzeQuestionsOptions = { providerId: '' }) {
  const providerId = requireProviderId(opts.providerId);
  const sourceFile = normalizeAnalysisFile({
    file: opts.file,
    pdf: opts.pdf,
    word: opts.word,
    defaultType: opts.word ? 'word' : 'pdf',
    allowedTypes: ['pdf', 'word'],
  });
  const knowledgeSource = normalizeKnowledgeSource(opts.knowledge);
  const knowledgeContext = buildQuestionKnowledgeContext({
    points: knowledgeSource.points,
    maxItems: opts.maxKnowledgeContextItems ?? 180,
  });
  const parser = sourceFile.type === 'word'
    ? (opts.parseWordQuestionsImpl ?? parseWordQuestions)
    : (opts.parsePdfQuestionsImpl ?? parsePdfQuestions);
  const parserResult = await parser({
    providerId,
    file: fileToParserDocument(sourceFile),
    concurrency: opts.concurrency,
    maxPageTokens: opts.maxPageTokens,
    maxFinalTokens: opts.maxFinalTokens,
    renderDpi: opts.renderDpi,
    onProgress: opts.onProgress,
    knowledgeContext,
  });
  return buildQuestionAnalysisResult({
    result: parserResult,
    file: sourceFile,
    providerId,
    knowledgeSource,
  });
}

async function parsePdfKnowledgePoints(
  request: EducationParserRequest,
): Promise<KnowledgePointAnalysisParserResult> {
  const documentResult = await parsePdfPages({
    ...request,
    pagePrompt: ({ pageNumber, totalPages }) => buildKnowledgePagePrompt({ pageNumber, totalPages }),
    finalPrompt: ({ pageResults }) => buildKnowledgeFinalPrompt({ pageResults }),
  });
  const parsed = parseKnowledgePointsJson(documentResult.text ?? '');
  return {
    ...documentResult,
    knowledge_point_count: parsed.knowledge_points.length,
    chapters: parsed.chapters,
    knowledge_points: parsed.knowledge_points,
    coverage_summary: parsed.coverage_summary,
    target_knowledge_point_range: DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE,
    uncertain_notes: parsed.uncertain_notes,
    parse_error: parsed.error,
    fallback_used: undefined,
  } as KnowledgePointAnalysisParserResult & { knowledge_point_count: number };
}

async function parsePdfQuestions(request: QuestionParserRequest): Promise<QuestionAnalysisParserResult> {
  const documentResult = await parsePdfPages({
    ...request,
    pagePrompt: ({ pageNumber, totalPages }) =>
      appendKnowledgeContext(buildQuestionPagePrompt({ pageNumber, totalPages }), request.knowledgeContext),
    finalPrompt: ({ pageResults }) =>
      appendKnowledgeContext(buildQuestionFinalPrompt({ pageResults }), request.knowledgeContext),
  });
  const parsed = parseQuestionsJson(documentResult.text ?? '');
  return {
    ...documentResult,
    question_count: parsed.questions.length,
    questions: parsed.questions,
    parse_error: parsed.error,
  };
}

async function parseWordQuestions(request: QuestionParserRequest): Promise<QuestionAnalysisParserResult> {
  const pdfFile = await convertWordToPdf(request.file);
  try {
    const documentResult = await parsePdfPages({
      ...request,
      file: pdfFile,
      documentType: 'word',
      pagePrompt: ({ pageNumber, totalPages }) =>
        appendKnowledgeContext(buildQuestionPagePrompt({ pageNumber, totalPages }), request.knowledgeContext),
      finalPrompt: ({ pageResults }) =>
        appendKnowledgeContext(buildQuestionFinalPrompt({ pageResults }), request.knowledgeContext),
    });
    const parsed = parseQuestionsJson(documentResult.text ?? '');
    return {
      ...documentResult,
      document_type: 'word',
      question_count: parsed.questions.length,
      questions: parsed.questions,
      parse_error: parsed.error,
    };
  } finally {
    await pdfFile.cleanup();
  }
}

interface ParsePagesOptions extends EducationParserRequest {
  documentType?: EducationFileType;
  pagePrompt: (ctx: { pageNumber: number; totalPages: number }) => string;
  finalPrompt: (ctx: { pageResults: EducationPageResult[] }) => string;
}

async function parsePdfPages(opts: ParsePagesOptions): Promise<EducationDocumentResult> {
  const documentType = opts.documentType ?? 'pdf';
  opts.onProgress?.({
    stage: 'pdf_to_pages',
    progress_percent: documentType === 'word' ? 25 : 10,
    message: '正在渲染 PDF 页面',
  });
  const { pages, cleanup } = await renderFileToPages(opts.file, opts.renderDpi ?? 180);
  try {
    opts.onProgress?.({
      stage: 'pdf_to_pages_done',
      progress_percent: 30,
      message: `已渲染 ${pages.length} 页`,
      total_pages: pages.length,
    });
    return parseRenderedPages({ ...opts, documentType, pages });
  } finally {
    await cleanup();
  }
}

async function parseRenderedPages(
  opts: ParsePagesOptions & { documentType: EducationFileType; pages: RasterizedPage[] },
): Promise<EducationDocumentResult> {
  const pageResults = await mapConcurrent(
    opts.pages,
    normalizeConcurrency(opts.concurrency ?? 2),
    async (page, index) => {
      opts.onProgress?.({
        stage: 'page_started',
        progress_percent: progressForPages(index, opts.pages.length),
        page_number: page.page,
        total_pages: opts.pages.length,
        message: `正在解析第 ${page.page}/${opts.pages.length} 页`,
      });
      try {
        const response = await analyzeImageBatch({
          providerId: opts.providerId,
          images: [{ bytes: page.png, format: 'png', name: `page-${String(page.page).padStart(3, '0')}` }],
          prompt: opts.pagePrompt({ pageNumber: page.page, totalPages: opts.pages.length }),
          maxOutputTokens: opts.maxPageTokens,
        });
        opts.onProgress?.({
          stage: 'page_done',
          progress_percent: progressForPages(index + 1, opts.pages.length),
          page_number: page.page,
          total_pages: opts.pages.length,
          message: `第 ${page.page}/${opts.pages.length} 页解析完成`,
        });
        return {
          page_number: page.page,
          ok: true,
          text: response.text,
          usage: tokenUsageToCommon(response.tokenUsage),
          latency_ms: response.latencyMs,
        } satisfies EducationPageResult;
      } catch (err) {
        return {
          page_number: page.page,
          ok: false,
          text: '',
          usage: null,
          error_message: errorMessage(err),
        } satisfies EducationPageResult;
      }
    },
  );

  opts.onProgress?.({
    stage: 'synthesis_started',
    progress_percent: 90,
    total_pages: opts.pages.length,
    message: '正在汇总逐页解析结果',
  });
  const finalResponse = await callLLM({
    providerId: opts.providerId,
    prompt: opts.finalPrompt({ pageResults }),
    maxOutputTokens: opts.maxFinalTokens,
  });
  opts.onProgress?.({
    stage: 'synthesis_done',
    progress_percent: 95,
    total_pages: opts.pages.length,
    message: '汇总解析完成',
  });

  return {
    document_type: opts.documentType,
    target_id: opts.providerId,
    provider: opts.providerId,
    model: null,
    api_shape: null,
    ok: pageResults.every((page) => page.ok !== false),
    latency_ms: sumNumbers([...pageResults.map((page) => page.latency_ms), finalResponse.latencyMs]),
    usage: summarizeUsage({
      pageUsages: pageResults.map((page) => page.usage),
      finalUsage: tokenUsageToCommon(finalResponse.tokenUsage),
    }),
    text: finalResponse.rawText,
    pages: pageResults,
    raw_results: [],
  };
}

async function renderFileToPages(file: NormalizedAnalysisFile, dpi: number) {
  const local = await fileToLocalPath(file);
  try {
    const pages = await rasterizePdf(local.path, { dpi });
    return {
      pages,
      cleanup: local.cleanup,
    };
  } catch (err) {
    await local.cleanup();
    throw err;
  }
}

async function fileToLocalPath(file: Pick<NormalizedAnalysisFile, 'type' | 'name' | 'data' | 'path'>) {
  if (file.path) return { path: file.path, cleanup: async () => {} };
  if (!file.data) throw new Error('file.data or file.path is required');
  const dir = await mkdtemp(path.join(tmpdir(), 'hao-llm-education-'));
  const localPath = path.join(dir, sanitizeFileName(file.name));
  await writeFile(localPath, Buffer.from(stripDataUrl(file.data), 'base64'));
  return {
    path: localPath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function convertWordToPdf(
  file: Pick<NormalizedAnalysisFile, 'type' | 'name' | 'data' | 'path'>,
): Promise<NormalizedAnalysisFile & { cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hao-llm-word-to-pdf-'));
  await mkdir(dir, { recursive: true });
  const sourcePath = file.path ?? path.join(dir, sanitizeFileName(file.name));
  try {
    if (!file.path) {
      if (!file.data) throw new Error('file.data or file.path is required');
      await writeFile(sourcePath, Buffer.from(stripDataUrl(file.data), 'base64'));
    }
    const command = await firstWorkingCommand([
      'soffice',
      'libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ]);
    await runCommand(command, ['--headless', '--convert-to', 'pdf', '--outdir', dir, sourcePath]);
    const pdfPath = await findFirstPdf(dir);
    return {
      type: 'pdf',
      name: path.basename(pdfPath),
      path: pdfPath,
      mimeType: 'application/pdf',
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

const DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE = '100-180';

function buildKnowledgePagePrompt({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) {
  return [
    `请分析这本教材第 ${pageNumber}/${totalPages} 页图片。`,
    '目标是识别本页出现的教材结构、章节线索和原子教学点，不要把练习题当作知识点主体。',
    '请输出 JSON，不要输出 Markdown：',
    '{',
    `  "page_number": ${pageNumber},`,
    '  "chapter_title": "本页所属章/节；无法判断则为空字符串",',
    '  "section_title": "本页所属小节；无法判断则为空字符串",',
    '  "knowledge_points": [',
    '    {',
    '      "name": "知识点名称",',
    '      "description": "知识点解释，尽量贴近教材表述",',
    '      "formulas": ["相关公式、符号或数学表达式"],',
    '      "examples": ["教材中的例题、情境或应用说明"],',
    '      "prerequisites": ["理解该知识点需要的前置知识"],',
    '      "difficulty": "基础/中等/较难/未知",',
    `      "source_pages": [${pageNumber}]`,
    '    }',
    '  ],',
    '  "uncertain_notes": []',
    '}',
  ].join('\n');
}

function buildKnowledgeFinalPrompt({ pageResults }: { pageResults: EducationPageResult[] }) {
  const inputCandidateCount = countPageKnowledgePointCandidates(pageResults);
  const pageText = pageResults
    .map((page) => [`第 ${page.page_number} 页：`, page.text].join('\n'))
    .join('\n\n---\n\n');
  return [
    '下面是一本教材逐页视觉解析得到的知识点候选。',
    '请基于这些页面结果，合并重复项，校正章节归属，并输出整本教材的结构化知识点 JSON。',
    `粒度目标：对一本完整高中数学教材，${DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE} 个知识点更正常。`,
    `本次逐页输入中约有 ${inputCandidateCount} 个知识点候选。除非确实重复或不是教学点，否则应保留非重复候选。`,
    '只输出 JSON，不要输出 Markdown。',
    'JSON 格式：',
    '{',
    '  "coverage_summary": {',
    `    "input_candidate_count": ${inputCandidateCount},`,
    '    "output_knowledge_point_count": 0,',
    `    "expected_range": "${DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE}",`,
    '    "coverage_notes": []',
    '  },',
    '  "chapters": [],',
    '  "knowledge_points": [],',
    '  "uncertain_notes": []',
    '}',
    '',
    pageText,
  ].join('\n');
}

function buildQuestionPagePrompt({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) {
  return [
    `请解析这份试题文档第 ${pageNumber}/${totalPages} 页图片。`,
    '目标是识别本页出现的所有试题，包括跨页题目的未完部分。',
    ...buildQuestionAcceptanceRuleLines(),
    `source_pages 必须填写当前实际页码 ${pageNumber}，不要默认写 1。`,
    '请输出 JSON，不要输出 Markdown：',
    '{',
    `  "page_number": ${pageNumber},`,
    '  "questions": [',
    '    {',
    '      "number": "1",',
    '      "type": "选择题/填空题/解答题/材料题/未知",',
    '      "stem": "题干文本",',
    '      "options": ["A. ...", "B. ..."],',
    '      "sub_questions": [],',
    '      "answer": "页面可见的答案/参考答案；没有则为空字符串",',
    '      "analysis": "页面可见的解析/解题过程；没有则为空字符串",',
    '      "figures": [],',
    `      "source_pages": [${pageNumber}],`,
    '      "related_knowledge_points": []',
    '    }',
    '  ],',
    '  "uncertain_notes": []',
    '}',
  ].join('\n');
}

function buildQuestionFinalPrompt({ pageResults }: { pageResults: EducationPageResult[] }) {
  const pageText = pageResults
    .map((page) => [`第 ${page.page_number} 页：`, page.text].join('\n'))
    .join('\n\n---\n\n');
  return [
    '下面是一份试题文档逐页视觉解析结果。',
    '请合并跨页题目，去重，并输出整份试题文档的结构化试题 JSON。',
    ...buildQuestionAcceptanceRuleLines(),
    '保持题号顺序；合并跨页题目，不要重复；对无法确认的内容写入 uncertain_notes，不要编造。',
    '只输出 JSON，不要输出 Markdown。',
    'JSON 格式：',
    '{',
    '  "questions": [',
    '    {',
    '      "number": "1",',
    '      "type": "选择题/填空题/解答题/材料题/未知",',
    '      "stem": "题干文本",',
    '      "options": ["A. ...", "B. ..."],',
    '      "sub_questions": [],',
    '      "answer": "答案/参考答案；没有则为空字符串",',
    '      "analysis": "解析/解题过程；没有则为空字符串",',
    '      "figures": [],',
    '      "source_pages": [1],',
    '      "related_knowledge_points": []',
    '    }',
    '  ],',
    '  "uncertain_notes": []',
    '}',
    '',
    pageText,
  ].join('\n');
}

function buildQuestionAcceptanceRuleLines() {
  return [
    '试题最小准入标准：',
    '- 只有存在明确作答任务的内容才放入 questions，例如求值、计算、证明、选择、填空、回答、解答、补全、写出、判断、说明理由等；',
    '- 题号或“题型”标题本身不构成试题；材料题必须包含材料后的具体小问、作答要求或答案区，不能把单独的阅读材料/说明页当成题；',
    '- 题型讲解、知识点说明、方法总结、例题分类标题、课程推广、二维码/扫码页、广告图片、纯图片说明都不是试题，应忽略或写入 uncertain_notes；',
    '- 对边界不确定的内容宁可不放入 questions，不要为了连续题号而编造题目。',
  ];
}

function buildKnowledgeAnalysisResult({
  result,
  file,
  providerId,
}: {
  result: KnowledgePointAnalysisParserResult;
  file: NormalizedAnalysisFile;
  providerId: string;
}) {
  const pages = result.pages ?? [];
  const pointIds = createKnowledgePointIdAllocator();
  const chapters = normalizeBusinessChapters(result.chapters, pointIds);
  const nestedPoints = flattenKnowledgePointsFromChapters(chapters);
  const topLevelPoints = Array.isArray(result.knowledge_points) && result.knowledge_points.length
    ? result.knowledge_points.map((point) => normalizeBusinessKnowledgePoint(point, {}, pointIds))
    : nestedPoints;
  const knowledgePoints = mergeKnowledgePointLists([...nestedPoints, ...topLevelPoints]);
  const coverageSummary = toRecord(result.coverage_summary);
  const llm = llmInfo({ result, providerId });
  const status = analysisStatus({ result, count: knowledgePoints.length, pages });

  return omitUndefined({
    kind: 'knowledge_points' as const,
    status,
    source: {
      type: file.type,
      name: file.name,
      page_count: pages.length,
    },
    llm,
    chapters,
    knowledge_points: knowledgePoints,
    coverage: {
      input_candidate_count: numberOrDefault(coverageSummary.input_candidate_count, 0),
      output_knowledge_point_count: numberOrDefault(
        coverageSummary.output_knowledge_point_count,
        knowledgePoints.length,
      ),
      expected_range: stringOrUndefined(coverageSummary.expected_range) ?? result.target_knowledge_point_range,
      notes: normalizeStringArray(coverageSummary.coverage_notes ?? coverageSummary.notes),
    },
    diagnostics: {
      parse_error: result.parse_error ?? null,
      uncertain_notes: normalizeStringArray(result.uncertain_notes),
      page_results: pages.map(sanitizePageResult),
      payload_log_path: result.payload_log_path,
      fallback_used: result.fallback_used,
    },
    document_type: result.document_type ?? file.type,
    target_id: llm.target_id,
    provider: llm.provider,
    model: llm.model,
    api_shape: llm.api_shape,
    ok: status !== 'failed',
    knowledge_point_count: knowledgePoints.length,
    pages,
    parse_error: result.parse_error,
    usage: result.usage,
    latency_ms: result.latency_ms,
  });
}

function buildQuestionAnalysisResult({
  result,
  file,
  providerId,
  knowledgeSource,
}: {
  result: QuestionAnalysisParserResult;
  file: NormalizedAnalysisFile;
  providerId: string;
  knowledgeSource: KnowledgeSource;
}) {
  const pages = result.pages ?? [];
  const questions = Array.isArray(result.questions)
    ? result.questions.map((question, index) => normalizeBusinessQuestion(question, index))
    : [];
  const llm = llmInfo({ result, providerId });
  const status = analysisStatus({ result, count: questions.length, pages });

  return omitUndefined({
    kind: 'questions' as const,
    status,
    source: {
      type: file.type,
      name: file.name,
      page_count: pages.length,
    },
    llm,
    knowledge_source: {
      count: knowledgeSource.points.length,
      source_type: knowledgeSource.sourceType,
    },
    questions,
    diagnostics: {
      question_count: result.question_count ?? questions.length,
      parse_error: result.parse_error ?? null,
      uncertain_notes: normalizeStringArray(result.uncertain_notes),
      page_results: pages.map(sanitizePageResult),
    },
    document_type: result.document_type ?? file.type,
    target_id: llm.target_id,
    provider: llm.provider,
    model: llm.model,
    api_shape: llm.api_shape,
    ok: status !== 'failed',
    question_count: result.question_count ?? questions.length,
    pages,
    parse_error: result.parse_error,
    usage: result.usage,
    latency_ms: result.latency_ms,
  });
}

function normalizeBusinessChapters(value: unknown, pointIds: ReturnType<typeof createKnowledgePointIdAllocator>) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((chapter, chapterIndex) => {
      const chapterNumber = stringOrDefault(chapter.number, '');
      const chapterTitle = stringOrDefault(chapter.display_name ?? chapter.title, '');
      const chapterId = stringOrDefault(chapter.id, `ch-${chapterIndex + 1}`);
      return omitUndefined({
        ...chapter,
        id: chapterId,
        number: chapterNumber,
        title: stringOrDefault(chapter.title, ''),
        display_name: chapter.display_name == null
          ? [chapterNumber, chapter.title].filter(Boolean).join(' ')
          : String(chapter.display_name),
        source_pages: normalizePageArray(chapter.source_pages),
        sections: normalizeBusinessSections(chapter.sections, {
          chapterIndex,
          chapterNumber,
          chapterTitle,
          pointIds,
        }),
        knowledge_points: normalizePointArray(chapter.knowledge_points).map((point) =>
          normalizeBusinessKnowledgePoint(
            point,
            { chapter_number: chapterNumber, chapter_title: chapterTitle },
            pointIds,
          ),
        ),
      });
    });
}

function normalizeBusinessSections(
  value: unknown,
  ctx: {
    chapterIndex: number;
    chapterNumber: string;
    chapterTitle: string;
    pointIds: ReturnType<typeof createKnowledgePointIdAllocator>;
  },
) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((section, sectionIndex) => {
      const sectionNumber = stringOrDefault(section.number, '');
      const sectionTitle = stringOrDefault(section.display_name ?? section.title, '');
      return omitUndefined({
        ...section,
        id: stringOrDefault(section.id, `sec-${ctx.chapterIndex + 1}-${sectionIndex + 1}`),
        number: sectionNumber,
        title: stringOrDefault(section.title, ''),
        display_name: section.display_name == null
          ? [sectionNumber, section.title].filter(Boolean).join(' ')
          : String(section.display_name),
        source_pages: normalizePageArray(section.source_pages),
        knowledge_points: normalizePointArray(section.knowledge_points).map((point) =>
          normalizeBusinessKnowledgePoint(
            point,
            {
              chapter_number: ctx.chapterNumber,
              chapter_title: ctx.chapterTitle,
              section_number: sectionNumber,
              section_title: sectionTitle,
            },
            ctx.pointIds,
          ),
        ),
      });
    });
}

function normalizeBusinessKnowledgePoint(
  point: unknown,
  context: JsonObject,
  pointIds: ReturnType<typeof createKnowledgePointIdAllocator>,
) {
  const record = isRecord(point) ? point : {};
  const normalized = omitUndefined({
    ...record,
    name: stringOrDefault(record.name, ''),
    description: stringOrUndefined(record.description),
    formulas: normalizeStringArray(record.formulas),
    examples: normalizeStringArray(record.examples),
    prerequisites: normalizeStringArray(record.prerequisites),
    difficulty: stringOrUndefined(record.difficulty),
    source_pages: normalizePageArray(record.source_pages),
    chapter_number: record.chapter_number ?? context.chapter_number,
    chapter_title: record.chapter_title ?? context.chapter_title,
    section_number: record.section_number ?? context.section_number,
    section_title: record.section_title ?? context.section_title,
  });
  return {
    ...normalized,
    id: pointIds.idFor(normalized),
  };
}

function createKnowledgePointIdAllocator() {
  let nextId = 1;
  const byKey = new Map<string, string>();
  return {
    idFor(point: JsonObject) {
      if (point.id != null) {
        const id = String(point.id);
        byKey.set(knowledgePointKey(point), id);
        return id;
      }
      const key = knowledgePointKey(point);
      if (!byKey.has(key)) byKey.set(key, `kp-${nextId++}`);
      return byKey.get(key) ?? `kp-${nextId++}`;
    },
  };
}

function knowledgePointKey(point: JsonObject) {
  return [
    point.name ?? '',
    point.chapter_title ?? '',
    point.section_title ?? '',
    normalizePageArray(point.source_pages).join(','),
  ].join('|');
}

function flattenKnowledgePointsFromChapters(chapters: JsonObject[]) {
  return chapters.flatMap((chapter) => [
    ...normalizePointArray(chapter.sections).flatMap((section) =>
      isRecord(section) ? normalizePointArray(section.knowledge_points) : [],
    ),
    ...normalizePointArray(chapter.knowledge_points),
  ]);
}

function mergeKnowledgePointLists(points: JsonObject[]) {
  const byKey = new Map<string, JsonObject>();
  for (const point of points) {
    const key = [point.id ?? '', point.name ?? '', point.chapter_title ?? '', point.section_title ?? ''].join('|');
    if (!key || byKey.has(key)) continue;
    byKey.set(key, point);
  }
  return Array.from(byKey.values());
}

function normalizeBusinessQuestion(
  question: unknown,
  index: number,
): JsonObject & { id: string; related_knowledge_points: JsonObject[] } {
  const record = isRecord(question) ? question : {};
  return {
    ...record,
    id: record.id == null ? `q-${index + 1}` : String(record.id),
    related_knowledge_points: normalizeRelatedKnowledgePoints(record.related_knowledge_points),
  };
}

interface KnowledgeInputPoint {
  id: string;
  name: string;
  chapter_title?: string;
  section_title?: string;
  source_name?: string;
  description?: string;
  formulas?: string[];
}

interface KnowledgeSource {
  sourceType: 'generated' | 'knowledge_list' | 'knowledge_analysis_result' | 'knowledge_collection';
  points: KnowledgeInputPoint[];
}

function normalizeKnowledgeSource(knowledge: unknown): KnowledgeSource {
  if (!knowledge) return { sourceType: 'generated', points: [] };
  if (Array.isArray(knowledge)) {
    if (knowledge.some(isKnowledgeAnalysisSource)) {
      return {
        sourceType: 'knowledge_collection',
        points: mergeInputKnowledgePoints(knowledge.flatMap((source, index) => {
          if (isKnowledgeAnalysisSource(source)) {
            return normalizeKnowledgeSourceObject(source, { sourceIndex: index, prefixIds: true });
          }
          const point = normalizeKnowledgeInputPoint(source, index, { idPrefix: `ks${index + 1}-` });
          return point ? [point] : [];
        })),
      };
    }
    return {
      sourceType: 'knowledge_list',
      points: knowledge.map((point, index) => normalizeKnowledgeInputPoint(point, index)).filter(isKnowledgeInputPoint),
    };
  }
  if (isRecord(knowledge)) {
    return { sourceType: 'knowledge_analysis_result', points: normalizeKnowledgeSourceObject(knowledge) };
  }
  return { sourceType: 'generated', points: [] };
}

function isKnowledgeAnalysisSource(value: unknown) {
  return Boolean(
    isRecord(value) &&
      (value.kind === 'knowledge_points' || Array.isArray(value.knowledge_points) || Array.isArray(value.chapters)),
  );
}

function normalizeKnowledgeSourceObject(
  knowledge: JsonObject,
  { sourceIndex = 0, prefixIds = false }: { sourceIndex?: number; prefixIds?: boolean } = {},
) {
  const context = omitUndefined({
    idPrefix: prefixIds ? `ks${sourceIndex + 1}-` : undefined,
    source_name: knowledgeSourceName(knowledge),
  });
  const fromTopLevel = normalizePointArray(knowledge.knowledge_points)
    .map((point, index) => normalizeKnowledgeInputPoint(point, index, context))
    .filter(isKnowledgeInputPoint);
  const fromChapters = flattenInputKnowledgeFromChapters(knowledge.chapters, context);
  return mergeInputKnowledgePoints([...fromTopLevel, ...fromChapters]);
}

function flattenInputKnowledgeFromChapters(chapters: unknown, context: JsonObject = {}) {
  if (!Array.isArray(chapters)) return [];
  const points: KnowledgeInputPoint[] = [];
  for (const chapter of chapters.filter(isRecord)) {
    const chapterTitle = stringOrDefault(
      chapter.display_name,
      [chapter.number, chapter.title].filter(Boolean).join(' '),
    );
    for (const section of normalizePointArray(chapter.sections)) {
      if (!isRecord(section)) continue;
      const sectionTitle = stringOrDefault(
        section.display_name,
        [section.number, section.title].filter(Boolean).join(' '),
      );
      for (const point of normalizePointArray(section.knowledge_points)) {
        const normalized = normalizeKnowledgeInputPoint(point, points.length, {
          ...context,
          chapter_title: chapterTitle,
          section_title: sectionTitle,
        });
        if (normalized) points.push(normalized);
      }
    }
    for (const point of normalizePointArray(chapter.knowledge_points)) {
      const normalized = normalizeKnowledgeInputPoint(point, points.length, {
        ...context,
        chapter_title: chapterTitle,
      });
      if (normalized) points.push(normalized);
    }
  }
  return points;
}

function normalizeKnowledgeInputPoint(point: unknown, index: number, context: JsonObject = {}) {
  if (typeof point === 'string') {
    const name = point.trim();
    return name ? { id: `kp-input-${index + 1}`, name } : null;
  }
  if (!isRecord(point)) return null;
  const name = stringOrDefault(point.name, '').trim();
  if (!name) return null;
  const rawId = stringOrDefault(point.id, `kp-input-${index + 1}`);
  const idPrefix = typeof context.idPrefix === 'string' ? context.idPrefix : '';
  return omitUndefined({
    id: `${idPrefix}${rawId}`,
    name,
    chapter_title: point.chapter_title ?? point.chapterTitle ?? point.chapter ?? context.chapter_title,
    section_title: point.section_title ?? point.sectionTitle ?? point.section ?? context.section_title,
    source_name: point.source_name ?? point.sourceName ?? context.source_name,
    description: stringOrUndefined(point.description),
    formulas: normalizeStringArray(point.formulas),
  }) as KnowledgeInputPoint;
}

function buildQuestionKnowledgeContext({ points, maxItems }: { points: KnowledgeInputPoint[]; maxItems: number }) {
  if (!points.length) {
    return [
      '关联知识点要求：',
      '没有提供外部知识点库。解析每道试题时，请根据题干、选项、答案和解析判断本题涉及的知识点。',
      '每道题都应尽量输出 related_knowledge_points，格式为：',
      '[{"name":"知识点名称","chapter":"章名称","section":"节名称","confidence":0.0到1.0,"reason":"关联理由"}]',
      '请根据每道题内容生成简洁、可复用的知识点名称；如果确实无法判断，related_knowledge_points 输出空数组。',
    ].join('\n');
  }
  const renderedPoints = points.slice(0, maxItems).map((point, index) =>
    [
      `${index + 1}. id=${point.id}`,
      `name=${point.name}`,
      point.chapter_title ? `chapter=${point.chapter_title}` : '',
      point.section_title ? `section=${point.section_title}` : '',
      point.source_name ? `source=${point.source_name}` : '',
      point.description ? `description=${point.description}` : '',
      point.formulas?.length ? `formulas=${point.formulas.join('；')}` : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  return [
    '关联知识点要求：',
    '下面是可用于匹配试题的知识点库。解析每道试题时，请根据题干、选项、答案和解析判断关联知识点。',
    '每道题都应尽量输出 related_knowledge_points，格式为：',
    '[{"id":"知识点 id","name":"知识点名称","chapter":"章名称","section":"节名称","confidence":0.0到1.0,"reason":"关联理由"}]',
    '只能引用下方知识点库里的 id；如果确实无法判断，related_knowledge_points 输出空数组。',
    '',
    renderedPoints.join('\n'),
  ].join('\n');
}

function appendKnowledgeContext(prompt: string, knowledgeContext: string) {
  return [prompt, '', knowledgeContext].join('\n');
}

function parseKnowledgePointsJson(text: string) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      chapters: [],
      knowledge_points: [],
      coverage_summary: { output_knowledge_point_count: 0 },
      uncertain_notes: [],
      error: 'No JSON object found in model output.',
    };
  }
  try {
    const parsed = JSON.parse(candidate) as JsonObject;
    const chapters = normalizeParsedChapters(parsed.chapters);
    const nestedPoints = chapters.flatMap((chapter) => [
      ...normalizePointArray(chapter.sections).flatMap((section) =>
        isRecord(section) ? normalizePointArray(section.knowledge_points) : [],
      ),
      ...normalizePointArray(chapter.knowledge_points),
    ]);
    const topLevelPoints = normalizeParsedKnowledgePoints(parsed.knowledge_points, {});
    const knowledgePoints = mergeKnowledgePointLists([...nestedPoints, ...topLevelPoints]);
    return {
      chapters,
      knowledge_points: knowledgePoints,
      coverage_summary: {
        ...toRecord(parsed.coverage_summary),
        output_knowledge_point_count: knowledgePoints.length,
      },
      uncertain_notes: normalizeStringArray(parsed.uncertain_notes),
      error: null,
    };
  } catch (err) {
    return {
      chapters: [],
      knowledge_points: [],
      coverage_summary: { output_knowledge_point_count: 0 },
      uncertain_notes: [],
      error: errorMessage(err),
    };
  }
}

function normalizeParsedChapters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((chapter) => ({
    ...chapter,
    source_pages: normalizePageArray(chapter.source_pages ?? chapter.pages),
    sections: normalizeParsedSections(chapter.sections, {
      chapterNumber: stringOrDefault(chapter.number, ''),
      chapterTitle: stringOrDefault(chapter.display_name ?? chapter.title, ''),
    }),
    knowledge_points: normalizeParsedKnowledgePoints(chapter.knowledge_points, {
      chapter_number: chapter.number,
      chapter_title: chapter.display_name ?? chapter.title,
    }),
  }));
}

function normalizeParsedSections(value: unknown, context: JsonObject) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((section) => ({
    ...section,
    source_pages: normalizePageArray(section.source_pages ?? section.pages),
    knowledge_points: normalizeParsedKnowledgePoints(section.knowledge_points, {
      chapter_number: context.chapterNumber,
      chapter_title: context.chapterTitle,
      section_number: section.number,
      section_title: section.display_name ?? section.title,
    }),
  }));
}

function normalizeParsedKnowledgePoints(value: unknown, context: JsonObject) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((point) =>
      omitUndefined({
        ...point,
        chapter_number: point.chapter_number ?? context.chapter_number,
        chapter_title: point.chapter_title ?? context.chapter_title,
        section_number: point.section_number ?? context.section_number,
        section_title: point.section_title ?? context.section_title,
        name: stringOrDefault(point.name, ''),
        description: stringOrDefault(point.description, ''),
        formulas: normalizeStringArray(point.formulas ?? point.formulae),
        examples: normalizeStringArray(point.examples),
        prerequisites: normalizeStringArray(point.prerequisites ?? point.preconditions),
        difficulty: stringOrDefault(point.difficulty, '未知'),
        source_pages: normalizePageArray(point.source_pages ?? point.pages),
      }),
    )
    .filter((point) => Boolean(point.name || point.description));
}

function parseQuestionsJson(text: string) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return { questions: [], error: 'No JSON object found in model output.' };
  try {
    const parsed = JSON.parse(candidate) as JsonObject;
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.map(normalizeQuestion).filter(isLikelyQuestion)
      : [];
    return { questions, error: null };
  } catch (err) {
    return { questions: [], error: errorMessage(err) };
  }
}

function normalizeQuestion(question: unknown) {
  const record = isRecord(question) ? question : {};
  return omitUndefined({
    number: stringOrDefault(record.number, ''),
    type: stringOrDefault(record.type, '未知'),
    stem: stringOrDefault(record.stem, ''),
    options: normalizeStringArray(record.options),
    sub_questions: Array.isArray(record.sub_questions) ? record.sub_questions : undefined,
    answer: stringOrUndefined(record.answer),
    analysis: stringOrUndefined(record.analysis ?? record.explanation ?? record.solution),
    source_pages: normalizePageArray(record.source_pages),
    related_knowledge_points: normalizeRelatedKnowledgePoints(record.related_knowledge_points),
    figures: Array.isArray(record.figures) ? record.figures : undefined,
    tables: Array.isArray(record.tables) ? record.tables : undefined,
    raw_text: stringOrUndefined(record.raw_text),
  });
}

function isLikelyQuestion(question: JsonObject) {
  return Boolean(
    stringOrDefault(question.stem, '').trim() ||
      normalizeStringArray(question.options).length ||
      normalizePointArray(question.sub_questions).length ||
      stringOrDefault(question.answer, '').trim() ||
      stringOrDefault(question.analysis, '').trim(),
  );
}

function normalizeRelatedKnowledgePoints(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const points: JsonObject[] = [];
  for (const point of value) {
    if (typeof point === 'string') {
      const name = point.trim();
      if (name) points.push({ name });
      continue;
    }
    if (!isRecord(point)) continue;
    const normalized = omitUndefined({
      id: stringOrUndefined(point.id),
      name: stringOrUndefined(point.name),
      chapter: point.chapter == null && point.chapter_title == null && point.chapterTitle == null
        ? undefined
        : String(point.chapter ?? point.chapter_title ?? point.chapterTitle),
      section: point.section == null && point.section_title == null && point.sectionTitle == null
        ? undefined
        : String(point.section ?? point.section_title ?? point.sectionTitle),
      confidence: numberOrUndefined(point.confidence),
      reason: stringOrUndefined(point.reason),
    });
    if (Object.keys(normalized).length > 0) points.push(normalized);
  }
  return points;
}

function extractJsonCandidate(text: string) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function countPageKnowledgePointCandidates(pageResults: EducationPageResult[]) {
  let total = 0;
  for (const page of pageResults) {
    const parsed = parseKnowledgePointsJson(page.text);
    total += parsed.knowledge_points.length;
  }
  return total;
}

function normalizeAnalysisFile({
  file,
  pdf,
  word,
  defaultType,
  allowedTypes,
}: {
  file?: EducationAnalysisFile;
  pdf?: Omit<EducationAnalysisFile, 'type'>;
  word?: Omit<EducationAnalysisFile, 'type'>;
  defaultType: EducationFileType;
  allowedTypes: EducationFileType[];
}): NormalizedAnalysisFile {
  const input =
    file ??
    (pdf ? { ...pdf, type: 'pdf' } : undefined) ??
    (word ? { ...word, type: 'word' } : undefined);
  if (!input) throw new Error('file is required');
  const type = normalizeFileType(input.type ?? defaultType);
  if (!allowedTypes.includes(type)) throw new Error(`Unsupported file type: ${type}`);
  const normalized = omitUndefined({
    type,
    name: String(input.name ?? input.filename ?? defaultFileName(type)),
    data: input.data == null ? undefined : stripDataUrl(input.data),
    path: input.path,
    mimeType: input.mimeType ?? input.mime_type,
  }) as NormalizedAnalysisFile;
  if (!normalized.data && !normalized.path) throw new Error('file.data or file.path is required');
  return normalized;
}

function normalizeFileType(value: unknown): EducationFileType {
  const type = String(value ?? '').toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('word') || type.includes('docx')) return 'word';
  if (type === 'pdf' || type === 'word') return type;
  return type as EducationFileType;
}

function fileToParserDocument(file: NormalizedAnalysisFile) {
  return omitUndefined({
    type: file.type,
    name: file.name,
    data: file.data,
    path: file.path,
    mimeType: file.mimeType,
  }) as EducationParserRequest['file'];
}

function requireProviderId(providerId: string | undefined) {
  const value = String(providerId ?? '').trim();
  if (!value) throw new Error('providerId is required');
  return value;
}

function llmInfo({ result, providerId }: { result: EducationDocumentResult; providerId: string }) {
  return {
    target_id: result.target_id ?? providerId,
    provider: result.provider ?? providerId,
    model: result.model ?? null,
    api_shape: result.api_shape ?? null,
  };
}

function analysisStatus({
  result,
  count,
  pages,
}: {
  result: EducationDocumentResult;
  count: number;
  pages: EducationPageResult[];
}) {
  const hasFailedPages = pages.some((page) => page.ok === false);
  if (result.ok === false && count === 0) return 'failed' as const;
  if (result.parse_error && count === 0) return 'failed' as const;
  if (result.ok === false || result.parse_error || hasFailedPages) return 'partial' as const;
  return 'ok' as const;
}

function sanitizePageResult(page: EducationPageResult) {
  return omitUndefined({
    page_number: page.page_number,
    ok: page.ok,
    text: page.text,
    usage: page.usage,
    latency_ms: page.latency_ms,
    http_status: page.http_status,
    error_message: page.error_message,
  });
}

function knowledgeSourceName(knowledge: JsonObject) {
  const source = isRecord(knowledge.source) ? knowledge.source : {};
  return (
    stringOrUndefined(source.name) ??
    stringOrUndefined(knowledge.source_name) ??
    stringOrUndefined(knowledge.sourceName) ??
    stringOrUndefined(knowledge.textbook_name) ??
    stringOrUndefined(knowledge.textbookName) ??
    ''
  );
}

function mergeInputKnowledgePoints(points: KnowledgeInputPoint[]) {
  const byKey = new Map<string, KnowledgeInputPoint>();
  for (const point of points) {
    const key = [point.id, point.name, point.chapter_title ?? '', point.section_title ?? ''].join('|');
    if (!byKey.has(key)) byKey.set(key, point);
  }
  return Array.from(byKey.values());
}

function isKnowledgeInputPoint(value: KnowledgeInputPoint | null): value is KnowledgeInputPoint {
  return value != null;
}

function normalizePointArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function normalizePageArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function stringOrDefault(value: unknown, defaultValue: string) {
  return value == null ? defaultValue : String(value);
}

function stringOrUndefined(value: unknown) {
  return value == null ? undefined : String(value);
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberOrDefault(value: unknown, defaultValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function tokenUsageToCommon(value: { input: number; output: number } | null) {
  if (!value) return null;
  return {
    prompt_tokens: value.input,
    completion_tokens: value.output,
    total_tokens: value.input + value.output,
  };
}

function summarizeUsage({ pageUsages, finalUsage }: { pageUsages: unknown[]; finalUsage: unknown }) {
  const pageTotal = sumUsageField(pageUsages, 'total_tokens');
  const finalTotal = isRecord(finalUsage) ? numberOrUndefined(finalUsage.total_tokens) : undefined;
  if (pageTotal == null && finalTotal == null) return null;
  return {
    page_total_tokens: pageTotal ?? null,
    final_total_tokens: finalTotal ?? null,
    total_tokens: sumNumbers([pageTotal, finalTotal]),
  };
}

function sumUsageField(usages: unknown[], field: string) {
  const values = usages
    .map((usage) => (isRecord(usage) ? numberOrUndefined(usage[field]) : undefined))
    .filter((value): value is number => value != null);
  return values.length ? sumNumbers(values) : undefined;
}

function sumNumbers(values: Array<number | undefined>) {
  return values.filter((value): value is number => Number.isFinite(value)).reduce((sum, value) => sum + value, 0);
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await worker(item, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function normalizeConcurrency(value: number) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`concurrency must be a positive integer, got ${value}`);
  return value;
}

function progressForPages(completedPages: number, totalPages: number) {
  if (!totalPages) return 30;
  return Math.round(30 + (Math.max(0, completedPages) / totalPages) * 55);
}

async function firstWorkingCommand(commands: string[]) {
  for (const command of commands) {
    if (await commandExists(command)) return command;
  }
  throw new Error(`Missing required command: ${commands.join(' or ')}`);
}

async function commandExists(command: string) {
  try {
    await runCommand(command, versionArgsFor(command));
    return true;
  } catch {
    return false;
  }
}

function versionArgsFor(command: string) {
  return path.basename(command) === 'pdftoppm' ? ['-v'] : ['--version'];
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

async function findFirstPdf(dir: string) {
  const files = (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.pdf')).sort();
  const first = files[0];
  if (!first) throw new Error(`No PDF was created in ${dir}`);
  return path.join(dir, first);
}

function defaultFileName(type: EducationFileType) {
  return type === 'word' ? 'document.docx' : 'document.pdf';
}

function sanitizeFileName(name: string) {
  return path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '-') || 'document';
}

function stripDataUrl(data: string) {
  const marker = ';base64,';
  const markerIndex = data.indexOf(marker);
  return markerIndex >= 0 ? data.slice(markerIndex + marker.length) : data;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function toRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function omitUndefined<T extends JsonObject>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)) as T;
}
