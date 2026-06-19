// @ts-nocheck
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { callLlm } from '../llm/llm-client.ts';
import { createDocumentCacheKey, sha256Text, stableStringify } from './document-cache.ts';

const DEFAULT_RETRY_BACKOFF_MS = 10_000;
const MAX_RETRY_BACKOFF_MS = 60_000;

export async function parseImage({
  llmConfig,
  llmTarget,
  targetConfig,
  target,
  image,
  prompt = buildImagePrompt(),
  maxTokens = 1200,
  cache,
  callLlmImpl = callLlm,
  payloadLogPath,
  payloadLogLimit,
  requestLabel,
  ...llmOptions
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  const normalizedImage = normalizeImage(image);
  const request = {
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input: prompt,
    attachments: [normalizedImage],
    maxTokens,
    ...llmOptions,
  };
  const response = await callLlmWithCache({
    cache,
    layer: 'image_llm',
    request,
    callLlmImpl,
    payloadLogPath,
    payloadLogLimit,
    requestLabel: requestLabel ?? 'image direct',
  });

  return resultFromSingleResponse({
    documentType: 'image',
    response,
  });
}

export async function parsePdf(options) {
  return parsePdfDirect(options);
}

export async function parsePdfDirect({
  llmConfig,
  llmTarget,
  targetConfig,
  target,
  pdf,
  prompt = buildPdfPrompt(),
  maxTokens = 1800,
  cache,
  callLlmImpl = callLlm,
  payloadLogPath,
  payloadLogLimit,
  requestLabel,
  ...llmOptions
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  const normalizedPdf = normalizePdf(pdf);
  const request = {
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input: prompt,
    attachments: [normalizedPdf],
    maxTokens,
    ...llmOptions,
  };
  const response = await callLlmWithCache({
    cache,
    layer: 'pdf_direct_llm',
    request,
    callLlmImpl,
    payloadLogPath,
    payloadLogLimit,
    requestLabel: requestLabel ?? 'pdf direct',
  });

  return resultFromSingleResponse({
    documentType: 'pdf',
    response,
  });
}

export async function parsePdfPages({
  pdf,
  renderPdfToPageImagesImpl = renderPdfToPageImages,
  renderDpi,
  pageImageOutputDir,
  cache,
  onProgress,
  ...options
}) {
  const normalizedPdf = normalizePdf(pdf);
  onProgress?.({
    stage: 'pdf_to_pages',
    progress_percent: 10,
    message: '正在渲染 PDF 页面',
  });
  const pages = await renderPageImages({
    cache,
    normalizedPdf,
    renderPdfToPageImagesImpl,
    renderDpi,
    pageImageOutputDir,
    onProgress,
  });
  onProgress?.({
    stage: 'pdf_to_pages_done',
    progress_percent: 30,
    message: `已渲染 ${pages.length} 页`,
    total_pages: pages.length,
  });
  return parseDocumentPages({
    ...options,
    cache,
    onProgress,
    documentType: 'pdf',
    pages,
  });
}

export async function parseWord(options) {
  return parseWordPages(options);
}

export async function parseWordDirect({
  llmConfig,
  llmTarget,
  targetConfig,
  target,
  word,
  prompt = buildWordPrompt(),
  maxTokens = 1800,
  cache,
  callLlmImpl = callLlm,
  payloadLogPath,
  payloadLogLimit,
  requestLabel,
  ...llmOptions
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  const normalizedWord = normalizeWord(word);
  const request = {
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input: prompt,
    attachments: [normalizedWord],
    maxTokens,
    ...llmOptions,
  };
  const response = await callLlmWithCache({
    cache,
    layer: 'word_direct_llm',
    request,
    callLlmImpl,
    payloadLogPath,
    payloadLogLimit,
    requestLabel: requestLabel ?? 'word direct',
  });

  return resultFromSingleResponse({
    documentType: 'word',
    response,
  });
}

export async function parseWordPages({
  word,
  pages,
  convertWordToPdfImpl = convertWordToPdf,
  renderPdfToPageImagesImpl = renderPdfToPageImages,
  renderDpi,
  pageImageOutputDir,
  cache,
  onProgress,
  ...options
}) {
  if (pages) {
    return parseDocumentPages({
      ...options,
      cache,
      onProgress,
      documentType: 'word',
      pages,
    });
  }

  onProgress?.({
    stage: 'word_to_pdf',
    progress_percent: 5,
    message: '正在转换 Word 为 PDF',
  });
  const normalizedWord = normalizeWord(word);
  const pdf = await getOrCreateCachedJson({
    cache,
    layer: 'word_to_pdf',
    keyParts: {
      word_hash: await hashDocumentContent(normalizedWord),
      converter: 'libreoffice',
    },
    onHit: () =>
      emitCacheHit(onProgress, {
        cache_layer: 'word_to_pdf',
        progress_percent: 20,
        message: '命中 Word 转 PDF 缓存',
      }),
    producer: () => convertWordToPdfImpl(normalizedWord),
  });
  onProgress?.({
    stage: 'word_to_pdf_done',
    progress_percent: 20,
    message: 'Word 已转换为 PDF',
  });
  onProgress?.({
    stage: 'pdf_to_pages',
    progress_percent: 25,
    message: '正在渲染 PDF 页面',
  });
  const renderedPages = await renderPageImages({
    cache,
    normalizedPdf: pdf,
    renderPdfToPageImagesImpl,
    renderDpi,
    pageImageOutputDir,
    onProgress,
  });
  onProgress?.({
    stage: 'pdf_to_pages_done',
    progress_percent: 30,
    message: `已渲染 ${renderedPages.length} 页`,
    total_pages: renderedPages.length,
  });
  return parseDocumentPages({
    ...options,
    cache,
    onProgress,
    documentType: 'word',
    pages: renderedPages,
  });
}

export async function parseDocumentPages({
  llmConfig,
  llmTarget,
  targetConfig,
  target,
  documentType = 'document',
  pages,
  pagePrompt,
  finalPrompt,
  maxPageTokens,
  maxFinalTokens,
  synthesize = true,
  concurrency = 2,
  maxRetries = 2,
  retryBackoffInitialMs = DEFAULT_RETRY_BACKOFF_MS,
  retryBackoffMaxMs = MAX_RETRY_BACKOFF_MS,
  retrySleepImpl = sleep,
  includePageImages = false,
  onProgress,
  cache,
  callLlmImpl = callLlm,
  payloadLogPath,
  payloadLogLimit,
  ...llmOptions
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  const normalizedPages = normalizePages(pages);
  let completedPages = 0;
  const pageResults = await mapConcurrent(
    normalizedPages,
    normalizeConcurrency(concurrency),
    async (page) => {
      onProgress?.({
        stage: 'page_started',
        progress_percent: progressForPages(completedPages, normalizedPages.length),
        page_number: page.pageNumber,
        total_pages: normalizedPages.length,
        message: `正在解析第 ${page.pageNumber}/${normalizedPages.length} 页`,
      });
      const pageRequest = omitUndefined({
        llmConfig: resolvedLlmConfig,
        llmTarget: resolvedLlmTarget,
        targetConfig: resolvedLlmConfig,
        target: resolvedLlmTarget,
        input: resolvePagePrompt({
          pagePrompt,
          documentType,
          page,
          totalPages: normalizedPages.length,
        }),
        attachments: [
          {
            type: 'image',
            mimeType: page.mimeType,
            data: page.data,
          },
        ],
        maxTokens: maxPageTokens,
        ...llmOptions,
      });
      const response = await callPageWithRetries({
        maxRetries,
        retryBackoffInitialMs,
        retryBackoffMaxMs,
        sleepImpl: retrySleepImpl,
        onRetryWait: ({ attempt, nextAttempt, delayMs, delaySource, response }) => {
          onProgress?.({
            stage: 'page_retry_wait',
            progress_percent: progressForPages(completedPages, normalizedPages.length),
            page_number: page.pageNumber,
            total_pages: normalizedPages.length,
            http_status: response?.http_status ?? null,
            retry_after_ms: delayMs,
            retry_delay_ms: delayMs,
            retry_delay_source: delaySource,
            attempt,
            next_attempt: nextAttempt,
            message: `第 ${page.pageNumber}/${normalizedPages.length} 页解析遇到限流或临时错误，等待 ${Math.ceil(delayMs / 1000)} 秒后重试`,
          });
        },
        operation: () =>
          callLlmWithCache({
            cache,
            layer: 'page_llm',
            request: pageRequest,
            callLlmImpl,
            payloadLogPath,
            payloadLogLimit,
            requestLabel: `${documentType} page ${page.pageNumber}/${normalizedPages.length}`,
            onCacheHit: () =>
              emitCacheHit(onProgress, {
                cache_layer: 'page_llm',
                progress_percent: progressForPages(completedPages, normalizedPages.length),
                page_number: page.pageNumber,
                total_pages: normalizedPages.length,
                message: `命中第 ${page.pageNumber} 页 LLM 解析缓存`,
              }),
          }),
      });
      completedPages += 1;
      onProgress?.({
        stage: 'page_done',
        progress_percent: progressForPages(completedPages, normalizedPages.length),
        page_number: page.pageNumber,
        total_pages: normalizedPages.length,
        message: `第 ${page.pageNumber}/${normalizedPages.length} 页解析完成`,
      });

      return omitUndefined({
        page_number: page.pageNumber,
        ok: response.ok,
        http_status: response.http_status,
        latency_ms: response.latency_ms,
        usage: response.usage,
        text: response.text,
        raw: response.raw,
        source_image_ref: pageImageRefFromPage(page),
        source_image: includePageImages
          ? {
              mime_type: page.mimeType,
              data: page.data,
            }
          : undefined,
        error_message: response.error_message,
      });
    },
  );

  if (!synthesize) {
    return resultFromPageResponses({
      documentType,
      target: resolvedLlmTarget,
      pageResults,
      finalResponse: null,
    });
  }

  onProgress?.({
    stage: 'synthesis_started',
    progress_percent: 90,
    total_pages: normalizedPages.length,
    message: '正在汇总逐页解析结果',
  });
  const finalRequest = omitUndefined({
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input: resolveFinalPrompt({
      finalPrompt,
      documentType,
      pageResults,
    }),
    attachments: [],
    maxTokens: maxFinalTokens,
    ...llmOptions,
  });
  const finalResponse = await callLlmWithCache({
    cache,
    layer: 'final_llm',
    request: finalRequest,
    callLlmImpl,
    payloadLogPath,
    payloadLogLimit,
    requestLabel: `${documentType} final synthesis`,
    onCacheHit: () =>
      emitCacheHit(onProgress, {
        cache_layer: 'final_llm',
        progress_percent: 95,
        total_pages: normalizedPages.length,
        message: '命中最终汇总 LLM 缓存',
      }),
  });
  onProgress?.({
    stage: 'synthesis_done',
    progress_percent: 95,
    total_pages: normalizedPages.length,
    message: '汇总解析完成',
  });

  return resultFromPageResponses({
    documentType,
    target: resolvedLlmTarget,
    pageResults,
    finalResponse,
  });
}

export function buildImagePrompt() {
  return [
    '请解析这张图片。',
    '请保留可见文字、结构、表格、列表、关键数字和重要视觉信息。',
    '不要编造图片中没有的信息。',
  ].join('\n');
}

export function buildPdfPrompt() {
  return [
    '请解析这个 PDF 文档。',
    '请总结文档主题、结构、关键概念、表格/图表、重要数字和结论。',
    '如果有不确定或无法读取的部分，请明确说明。不要编造文档中没有的信息。',
  ].join('\n');
}

export function buildWordPrompt() {
  return [
    '请解析这个 Word 文档。',
    '请总结文档主题、结构、关键内容、表格/图形、重要数字和结论。',
    '如果有不确定或无法读取的部分，请明确说明。不要编造文档中没有的信息。',
  ].join('\n');
}

export function buildPagePrompt({ documentType = 'document', pageNumber }) {
  return [
    `请解析这个 ${displayDocumentType(documentType)}第 ${pageNumber} 页截图。`,
    '请保留页面标题、段落、表格、列表、页眉页脚、关键数字和可见标注。',
    '请按结构输出，避免遗漏。不要编造页面中没有的信息。',
  ].join('\n');
}

export async function convertWordToPdf({ name, data, path: inputPath, outputDir } = {}) {
  const workDir = outputDir ?? (await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-word-to-pdf-')));
  await mkdir(workDir, { recursive: true });
  const shouldCleanup = !outputDir;
  const sourcePath = inputPath ?? path.join(workDir, sanitizeFileName(name ?? 'document.docx'));

  try {
    if (!inputPath) {
      await writeFile(sourcePath, Buffer.from(data, 'base64'));
    }

    const command = await firstWorkingCommand([
      'soffice',
      'libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ]);
    await runCommand(command, [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      workDir,
      sourcePath,
    ]);

    const pdfPath = await findFirstPdf(workDir);
    const pdfData = (await readFile(pdfPath)).toString('base64');
    const result = omitUndefined({
      name: path.basename(pdfPath),
      mimeType: 'application/pdf',
      data: pdfData,
      path: outputDir ? pdfPath : undefined,
    });
    if (shouldCleanup) await rm(workDir, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (shouldCleanup) await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

export async function renderPdfToPageImages({
  name,
  data,
  path: inputPath,
  outputDir,
  dpi = 180,
} = {}) {
  const workDir = outputDir
    ? path.resolve(outputDir)
    : await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-pdf-pages-'));
  await mkdir(workDir, { recursive: true });
  const shouldCleanup = !outputDir;
  const sourcePath = inputPath ?? path.join(workDir, sanitizeFileName(name ?? 'document.pdf'));
  const outputPrefix = path.join(workDir, 'page');

  try {
    if (!inputPath) {
      await writeFile(sourcePath, Buffer.from(data, 'base64'));
    }

    const command = await firstWorkingCommand([
      'pdftoppm',
      '/opt/homebrew/bin/pdftoppm',
      '/usr/local/bin/pdftoppm',
    ]);
    await runCommand(command, ['-png', '-r', String(dpi), sourcePath, outputPrefix]);

    const files = (await readdir(workDir))
      .filter((file) => /^page-\d+\.png$/.test(file))
      .sort((left, right) => pageNumberFromRenderedFile(left) - pageNumberFromRenderedFile(right));

    const pages = await Promise.all(
      files.map(async (file, index) =>
        omitUndefined({
          pageNumber: index + 1,
          mimeType: 'image/png',
          data: (await readFile(path.join(workDir, file))).toString('base64'),
          path: outputDir ? path.join(workDir, file) : undefined,
        }),
      ),
    );
    if (shouldCleanup) await rm(workDir, { recursive: true, force: true });
    return pages;
  } catch (error) {
    if (shouldCleanup) await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

export function buildFinalDocumentPrompt({ documentType = 'document', pageResults }) {
  const pageText = pageResults
    .map((page) => [`第 ${page.page_number} 页：`, page.text].join('\n'))
    .join('\n\n---\n\n');

  return [
    `下面是 ${displayDocumentType(documentType)}逐页解析结果。`,
    '请基于这些页面结果生成完整文档解析。',
    '',
    '请输出：',
    '1. 一句话概括；',
    '2. 文档结构；',
    '3. 关键内容、表格、数字和结论；',
    '4. 需要保留的细节；',
    '5. 不确定或疑似识别不完整的部分。',
    '',
    pageText,
  ].join('\n');
}

function resultFromSingleResponse({ documentType, response }) {
  return {
    document_type: documentType,
    llm_target_id: response.llm_target_id ?? response.target_id,
    target_id: response.target_id,
    provider: response.provider,
    model: response.model,
    api_shape: response.api_shape,
    ok: response.ok,
    http_status: response.http_status,
    latency_ms: response.latency_ms,
    usage: response.usage,
    text: response.text,
    raw_results: [response.raw],
  };
}

function resultFromPageResponses({ documentType, target, pageResults, finalResponse }) {
  const rawResults = [
    ...pageResults.map((page) => page.raw),
    ...(finalResponse ? [finalResponse.raw] : []),
  ];
  const pageText = pageResults
    .map((page) => page.text)
    .filter(Boolean)
    .join('\n\n');
  const images = imageRefsFromPages(pageResults);
  const usage = summarizeUsage({
    pageUsages: pageResults.map((page) => page.usage),
    finalUsage: finalResponse?.usage ?? null,
  });

  return omitUndefined({
    document_type: documentType,
    llm_target_id: finalResponse?.llm_target_id ?? finalResponse?.target_id ?? target.id,
    target_id: finalResponse?.target_id ?? target.id,
    provider: finalResponse?.provider ?? target.provider,
    model: finalResponse?.model ?? target.model ?? null,
    api_shape: finalResponse?.api_shape ?? target.api_shape,
    ok: finalResponse
      ? finalResponse.ok && pageResults.every((page) => page.ok)
      : pageResults.every((page) => page.ok),
    http_status: finalResponse?.http_status ?? pageResults.at(-1)?.http_status ?? null,
    latency_ms: sumNumbers([
      ...pageResults.map((page) => page.latency_ms),
      finalResponse?.latency_ms,
    ]),
    usage,
    text: finalResponse?.text ?? pageText,
    pages: pageResults,
    images: images.length ? images : undefined,
    raw_results: rawResults,
  });
}

async function renderPageImages({
  cache,
  normalizedPdf,
  renderPdfToPageImagesImpl,
  renderDpi,
  pageImageOutputDir,
  onProgress,
}) {
  const renderInput = omitUndefined({
    ...normalizedPdf,
    dpi: renderDpi,
    outputDir: pageImageOutputDir,
  });

  if (pageImageOutputDir) {
    return renderPdfToPageImagesImpl(renderInput);
  }

  return getOrCreateCachedJson({
    cache,
    layer: 'pdf_to_images',
    keyParts: {
      pdf_hash: await hashDocumentContent(normalizedPdf),
      renderer: 'pdftoppm',
      dpi: renderDpi ?? 180,
    },
    onHit: () =>
      emitCacheHit(onProgress, {
        cache_layer: 'pdf_to_images',
        progress_percent: 30,
        message: '命中 PDF 渲染页面缓存',
      }),
    producer: () => renderPdfToPageImagesImpl(renderInput),
  });
}

function imageRefsFromPages(pages) {
  return pages.map((page) => page.source_image_ref ?? pageImageRefFromPage(page)).filter(Boolean);
}

function pageImageRefFromPage(page) {
  if (!page?.path) return undefined;
  return omitUndefined({
    kind: 'page_image',
    reference_type: 'file_path',
    page_number: page.page_number ?? page.pageNumber,
    mime_type: page.mime_type ?? page.mimeType ?? 'image/png',
    path: page.path,
  });
}

async function callLlmWithCache({
  cache,
  layer,
  request,
  callLlmImpl,
  payloadLogPath,
  payloadLogLimit,
  requestLabel,
  onCacheHit,
}) {
  const loggingOptions = omitUndefined({
    payloadLogPath,
    payloadLogLimit,
    requestLabel,
  });
  return getOrCreateCachedJson({
    cache,
    layer,
    keyParts: llmCacheKeyParts({ layer, request }),
    onHit: onCacheHit,
    producer: () =>
      callLlmImpl({
        ...request,
        ...loggingOptions,
      }),
    shouldCache: (response) => response?.ok !== false,
  });
}

async function getOrCreateCachedJson({
  cache,
  layer,
  keyParts,
  onHit,
  producer,
  shouldCache = () => true,
}) {
  if (!isDocumentCache(cache)) return producer();

  const key = createDocumentCacheKey({
    layer,
    ...keyParts,
  });
  const cached = await readCachedJson(cache, key);
  if (cached != null) {
    onHit?.();
    return cached;
  }

  const value = await producer();
  if (shouldCache(value)) {
    await writeCachedJson(cache, key, value);
  }
  return value;
}

async function readCachedJson(cache, key) {
  try {
    return await cache.getJson(key);
  } catch {
    return null;
  }
}

async function writeCachedJson(cache, key, value) {
  try {
    await cache.setJson(key, value);
  } catch {
    // Cache writes are an optimization and should not fail document parsing.
  }
}

function isDocumentCache(cache) {
  return cache && typeof cache.getJson === 'function' && typeof cache.setJson === 'function';
}

function llmCacheKeyParts({ layer, request }) {
  return {
    target: targetFingerprint(request.target),
    target_config: {
      base_url: request.targetConfig?.base_url ?? null,
    },
    input_hash: sha256Text(request.input),
    attachments: (request.attachments ?? []).map(attachmentFingerprint),
    max_tokens: request.maxTokens ?? null,
    options_hash: sha256Text(stableStringify(llmOptionFingerprint(request))),
    layer,
  };
}

function targetFingerprint(target) {
  return {
    id: target?.id ?? null,
    provider: target?.provider ?? null,
    api_shape: target?.api_shape ?? null,
    model: target?.model ?? null,
    method: target?.method ?? null,
    path: target?.path ?? null,
  };
}

function attachmentFingerprint(attachment) {
  return {
    type: attachment.type,
    mimeType: attachment.mimeType,
    name: attachment.name ?? null,
    data_hash: sha256Text(attachment.data),
  };
}

function llmOptionFingerprint(request) {
  const ignored = new Set([
    'llmConfig',
    'llmTarget',
    'targetConfig',
    'target',
    'input',
    'attachments',
    'maxTokens',
  ]);
  return Object.fromEntries(
    Object.entries(request)
      .filter(([key]) => !ignored.has(key))
      .map(([key, value]) => [key, cacheableJsonValue(value)]),
  );
}

function cacheableJsonValue(value) {
  if (typeof value === 'function') return '[function]';
  if (Array.isArray(value)) return value.map(cacheableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cacheableJsonValue(nested)]),
    );
  }
  return value;
}

async function hashDocumentContent(document) {
  if (document.data) return sha256Text(document.data);
  if (document.path) return sha256Text((await readFile(document.path)).toString('base64'));
  return sha256Text(stableStringify(document));
}

function emitCacheHit(onProgress, event) {
  onProgress?.({
    stage: 'cache_hit',
    ...event,
  });
}

function normalizeImage(image) {
  if (!image || typeof image !== 'object') {
    throw new Error('image is required');
  }
  if (!image.data) {
    throw new Error('image.data must contain base64 image data');
  }
  return {
    type: 'image',
    mimeType: image.mimeType ?? image.mime_type ?? 'image/png',
    data: image.data,
  };
}

function normalizePdf(pdf) {
  if (!pdf || typeof pdf !== 'object') {
    throw new Error('pdf is required');
  }
  if (!pdf.data) {
    throw new Error('pdf.data must contain base64 PDF data');
  }
  return {
    type: 'document',
    mimeType: 'application/pdf',
    name: pdf.name ?? pdf.filename ?? 'document.pdf',
    data: pdf.data,
  };
}

function normalizeWord(word) {
  if (!word || typeof word !== 'object') {
    throw new Error('word is required');
  }
  if (!word.data && !word.path) {
    throw new Error('word.data or word.path must contain Word document data');
  }
  return omitUndefined({
    type: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: word.name ?? word.filename ?? 'document.docx',
    data: word.data,
    path: word.path,
  });
}

function normalizePages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages must be a non-empty array');
  }

  return pages.map((page, index) => {
    if (!page || typeof page !== 'object') {
      throw new Error('each page must be an object');
    }
    if (!page.data) {
      throw new Error('each page must contain base64 image data');
    }
    return {
      pageNumber: page.pageNumber ?? page.page_number ?? index + 1,
      mimeType: page.mimeType ?? page.mime_type ?? 'image/png',
      data: page.data,
      path: page.path,
    };
  });
}

function summarizeUsage({ pageUsages, finalUsage }) {
  const pageTotal = sumUsageField(pageUsages, 'total_tokens');
  const finalTotal = numberOrNull(finalUsage?.total_tokens);
  if (pageTotal == null && finalTotal == null) return null;

  return {
    page_total_tokens: pageTotal,
    final_total_tokens: finalTotal,
    total_tokens: sumNumbers([pageTotal, finalTotal]),
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function callPageWithRetries({
  operation,
  maxRetries,
  retryBackoffInitialMs = DEFAULT_RETRY_BACKOFF_MS,
  retryBackoffMaxMs = MAX_RETRY_BACKOFF_MS,
  sleepImpl = sleep,
  onRetryWait,
}) {
  let attempt = 0;
  let lastResponse = null;
  while (attempt <= maxRetries) {
    try {
      const response = await operation();
      lastResponse = response;
      if (!isRetryableResponse(response)) return response;
    } catch (error) {
      lastResponse = {
        ok: false,
        http_status: null,
        latency_ms: null,
        usage: null,
        text: '',
        raw: null,
        error_message: error.message,
      };
    }
    if (attempt >= maxRetries) break;

    const retryDelay = resolveRetryDelay({
      response: lastResponse,
      attempt,
      retryBackoffInitialMs,
      retryBackoffMaxMs,
    });
    onRetryWait?.({
      attempt: attempt + 1,
      nextAttempt: attempt + 2,
      delayMs: retryDelay.delayMs,
      delaySource: retryDelay.source,
      response: lastResponse,
    });
    if (retryDelay.delayMs > 0) {
      await sleepImpl(retryDelay.delayMs);
    }
    attempt += 1;
  }
  return lastResponse;
}

function isRetryableResponse(response) {
  if (response?.ok) return false;
  return (
    response?.http_status == null || response.http_status === 429 || response.http_status >= 500
  );
}

function resolveRetryDelay({ response, attempt, retryBackoffInitialMs, retryBackoffMaxMs }) {
  const retryAfterMs = parseRetryAfterHeaderMs(getHeader(response?.headers, 'retry-after'));
  if (retryAfterMs != null) {
    return { delayMs: retryAfterMs, source: 'retry_after_header' };
  }

  const detailDelayMs = parseRetryAfterDetailMs(response);
  if (detailDelayMs != null) {
    return { delayMs: detailDelayMs, source: 'response_detail' };
  }

  const initial = normalizeDelayMs(retryBackoffInitialMs, DEFAULT_RETRY_BACKOFF_MS);
  const max = normalizeDelayMs(retryBackoffMaxMs, MAX_RETRY_BACKOFF_MS);
  return {
    delayMs: Math.min(initial * 2 ** Math.max(0, attempt), max),
    source: 'backoff',
  };
}

function parseRetryAfterHeaderMs(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric * 1000);
  }

  const timestamp = Date.parse(String(value));
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
}

function parseRetryAfterDetailMs(response) {
  const detailText = [
    response?.raw?.detail,
    response?.raw?.message,
    response?.raw?.error?.message,
    response?.error_message,
    response?.text,
  ]
    .filter((value) => value != null)
    .join('\n');
  const match = detailText.match(/retry after\s+([\d.]+)\s*(?:seconds?|s)?/i);
  if (!match) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds) * 1000;
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const entries = Object.entries(headers);
  const lowerName = name.toLowerCase();
  const match = entries.find(([key]) => key.toLowerCase() === lowerName);
  return match ? match[1] : null;
}

function normalizeDelayMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function resolvePagePrompt({ pagePrompt, documentType, page, totalPages }) {
  if (typeof pagePrompt === 'function') {
    return pagePrompt({
      documentType,
      pageNumber: page.pageNumber,
      page,
      totalPages,
    });
  }
  return (
    pagePrompt ??
    buildPagePrompt({
      documentType,
      pageNumber: page.pageNumber,
    })
  );
}

function resolveFinalPrompt({ finalPrompt, documentType, pageResults }) {
  if (typeof finalPrompt === 'function') {
    return finalPrompt({
      documentType,
      pageResults,
    });
  }
  return (
    finalPrompt ??
    buildFinalDocumentPrompt({
      documentType,
      pageResults,
    })
  );
}

function normalizeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`concurrency must be a positive integer, got ${value}`);
  }
  return parsed;
}

function progressForPages(completedPages, totalPages) {
  if (!totalPages) return 30;
  return Math.round(30 + (Math.max(0, completedPages) / totalPages) * 55);
}

function sumUsageField(usages, field) {
  const values = usages
    .map((usage) => numberOrNull(usage?.[field]))
    .filter((value) => value != null);
  if (values.length === 0) return null;
  return sumNumbers(values);
}

function sumNumbers(values) {
  return values
    .filter((value) => Number.isFinite(value))
    .reduce((total, value) => total + value, 0);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function resolveLlmConfig({ llmConfig, targetConfig }) {
  return llmConfig ?? targetConfig ?? {};
}

function resolveLlmTarget({ llmTarget, target }) {
  return llmTarget ?? target;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}

function displayDocumentType(documentType) {
  if (documentType === 'word') return 'Word 文档';
  if (documentType === 'pdf') return 'PDF 文档';
  if (documentType === 'question' || documentType === 'exam') return '试题文档';
  if (documentType === 'image') return '图片';
  return '文档';
}

async function firstWorkingCommand(commands) {
  for (const command of commands) {
    if (await commandExists(command)) return command;
  }
  throw new Error(`Missing required command: ${commands.join(' or ')}`);
}

async function commandExists(command) {
  try {
    await runCommand(command, versionArgsFor(command));
    return true;
  } catch {
    return false;
  }
}

function versionArgsFor(command) {
  if (path.basename(command) === 'pdftoppm') return ['-v'];
  return ['--version'];
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`.trim()));
      }
    });
  });
}

async function findFirstPdf(dir) {
  const files = (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.pdf')).sort();
  if (files.length === 0) {
    throw new Error(`No PDF was created in ${dir}`);
  }
  return path.join(dir, files[0]);
}

function pageNumberFromRenderedFile(file) {
  return Number(file.match(/^page-(\d+)\.png$/)?.[1] ?? 0);
}

function sanitizeFileName(name) {
  return path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '-') || 'document';
}
