/**
 * analyzePdf — 把整本 PDF 切成 N 页一段，逐段送 LLM（Bedrock Converse 协议带原生
 * PDF document part），最后再做一次终审整合。
 *
 * 参考实现：/Users/huyin/Study/LLMProxy/how-to-use-llm-proxy/examples/real-world/
 *           analyze-pdf-with-claude-opus-converse.mjs
 *
 * 关键约束：
 *   1. 大 PDF 必须分片：直接整本喂 LLM 会超 context（也会超 Webex proxy 的 inputTokens cap）。
 *   2. 两次 LLM 请求之间必须 sleep（默认 60s，与 example 一致），避开 Webex proxy 429。
 *      callLLM 自身收到 429 仍会按 Retry-After 退避兜底；本层的 delay 是预防式。
 *   3. 终审请求是纯文本（不带 PDF 附件），用 chunk 摘要做拼接 prompt。
 *
 * 调用方契约：
 *   - 不写 llm_parse_job 表（caller 自己决定每个 chunk 是单独一行 job 还是整本一行 job）；
 *     caller 拿 onProgress 事件 + 返回结构里的 requestPayload 自行 redact + 落库。
 *   - 任意一步抛错，函数会 try/finally 清掉临时切片目录。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { callLLM } from '../callLLM';
import { buildPageRanges, extractPdfChunk, getPdfPageCount } from './qpdf';

export interface ChunkPromptCtx {
  chunkIndex: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
}

export interface FinalPromptCtx {
  pdfPath: string;
  pageCount: number;
  chunkSummaries: Array<{
    chunkIndex: number;
    startPage: number;
    endPage: number;
    text: string;
  }>;
}

export type AnalyzeProgressEvent =
  | { type: 'plan'; pageCount: number; ranges: Array<{ start: number; end: number }> }
  | { type: 'chunk_start'; chunkIndex: number; startPage: number; endPage: number }
  | {
      type: 'chunk_done';
      chunkIndex: number;
      startPage: number;
      endPage: number;
      latencyMs: number;
      tokenUsage: { input: number; output: number } | null;
      retries: number;
    }
  | { type: 'sleep'; seconds: number; reason: 'between_requests' }
  | { type: 'final_start' }
  | {
      type: 'final_done';
      latencyMs: number;
      tokenUsage: { input: number; output: number } | null;
      retries: number;
    }
  | { type: 'error'; stage: 'plan' | 'chunk' | 'final'; error: unknown; chunkIndex?: number };

export interface AnalyzePdfOptions {
  /** llm_provider.id；必须是 protocol=bedrock_converse 且 capabilities.pdf=true 的 provider */
  providerId: string;
  /** 待解析 PDF 文件绝对路径 */
  pdfPath: string;
  /** 每片页数；默认 15（与 example 一致；大教材按需调小到 8-10） */
  chunkPages?: number;
  /**
   * 每两次 LLM 请求之间的 sleep 秒数；默认 60。
   * 适用范围：每个 chunk 后 + 最后一个 chunk 后（终审前）；终审之后不睡。
   * 设 0 关闭（仅用于测试 / 已知 provider 无 rate limit 的场景）。
   */
  delayBetweenRequestsSeconds?: number;
  /** 单 chunk 输出 token 上限（覆盖 provider.max_output_tokens / default_params.max_tokens），默认 1800 */
  maxChunkTokens?: number;
  /** 终审输出 token 上限，默认 3000 */
  maxFinalTokens?: number;
  /** 透传给 callLLM 的 maxRetries（429/5xx schema 等可重试条件），默认 2 */
  maxRetries?: number;
  /** 自定义 chunk 阶段 prompt（默认对齐 example） */
  chunkPromptBuilder?: (ctx: ChunkPromptCtx) => string;
  /** 自定义终审阶段 prompt（默认对齐 example） */
  finalPromptBuilder?: (ctx: FinalPromptCtx) => string;
  /** 进度回调（chunk_done / sleep / final_done…）；caller 用来落 llm_parse_job 状态机 */
  onProgress?: (event: AnalyzeProgressEvent) => void;
}

export interface AnalyzedChunk {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  text: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  retries: number;
  /** 已含真实 token 的 body；caller 必须先 redactAuthHeaders 再入库 */
  requestPayload: object;
}

export interface AnalyzePdfResult {
  pageCount: number;
  chunkPages: number;
  chunks: AnalyzedChunk[];
  final: {
    text: string;
    tokenUsage: { input: number; output: number } | null;
    latencyMs: number;
    retries: number;
    requestPayload: object;
  };
}

const DEFAULT_CHUNK_PAGES = 15;
const DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS = 60;
const DEFAULT_MAX_CHUNK_TOKENS = 1800;
const DEFAULT_MAX_FINAL_TOKENS = 3000;
const DEFAULT_MAX_RETRIES = 2;

function defaultChunkPrompt(ctx: ChunkPromptCtx): string {
  // 对齐 example::buildAnalyzeChunkBody，方便迁移老调用方
  return [
    `请阅读第 ${ctx.chunkIndex}/${ctx.totalChunks} 个 PDF 分片（原 PDF 第 ${ctx.startPage}-${ctx.endPage} 页）。`,
    '请用中文总结这个分片的内容，重点包括：',
    '1. 这部分主要讲什么；',
    '2. 出现了哪些关键概念、公式、图表或例题；',
    '3. 如果这是教材/讲义/论文/报告，请指出它在全文中的作用；',
    '4. 列出这个分片涉及的知识点，尽量按条目给出；',
    '5. 保留后续整合全文时需要知道的具体信息。',
    '回答要结构化，但不要编造 PDF 中没有的信息。',
  ].join('\n');
}

function defaultFinalPrompt(ctx: FinalPromptCtx): string {
  // 对齐 example::buildFinalSummaryBody
  const summaryText = ctx.chunkSummaries
    .map((s) => [`分片 ${s.chunkIndex}（第 ${s.startPage}-${s.endPage} 页）:`, s.text].join('\n'))
    .join('\n\n---\n\n');
  return [
    `下面是 PDF 文件 ${ctx.pdfPath} 按页分片后的分析结果。`,
    '请基于这些分片总结整个 PDF 到底讲了什么。',
    '',
    '请用中文输出：',
    '1. 一句话概括；',
    '2. 文档类型和适合读者；',
    '3. 主要章节/主题；',
    '4. 关键概念、公式、图表或例题；',
    '5. 知识点清单与数量统计：按章节列出知识点，并给出总数和各章节数量；',
    '6. 8-12 条快速了解要点；',
    '7. 如有不确定或某些页未覆盖，请明确说明。',
    '',
    summaryText,
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 分片解析整本 PDF。失败会发 error 事件后 throw；caller 必须 catch 并把 llm_parse_job
 * 状态置 failed。
 */
export async function analyzePdf(opts: AnalyzePdfOptions): Promise<AnalyzePdfResult> {
  const chunkPages = opts.chunkPages ?? DEFAULT_CHUNK_PAGES;
  const delaySeconds = opts.delayBetweenRequestsSeconds ?? DEFAULT_DELAY_BETWEEN_REQUESTS_SECONDS;
  const maxChunkTokens = opts.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const maxFinalTokens = opts.maxFinalTokens ?? DEFAULT_MAX_FINAL_TOKENS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const chunkPromptBuilder = opts.chunkPromptBuilder ?? defaultChunkPrompt;
  const finalPromptBuilder = opts.finalPromptBuilder ?? defaultFinalPrompt;
  const onProgress = opts.onProgress ?? (() => {});

  let pageCount: number;
  let ranges: Array<{ start: number; end: number }>;
  try {
    pageCount = await getPdfPageCount(opts.pdfPath);
    ranges = buildPageRanges(pageCount, chunkPages);
  } catch (err) {
    onProgress({ type: 'error', stage: 'plan', error: err });
    throw err;
  }
  onProgress({ type: 'plan', pageCount, ranges });

  const chunkDir = await mkdtemp(path.join(os.tmpdir(), 'hao-llm-pdf-chunks-'));
  const chunks: AnalyzedChunk[] = [];

  try {
    for (const [i, range] of ranges.entries()) {
      const chunkIndex = i + 1;
      const chunkFileName = `chunk-${String(chunkIndex).padStart(3, '0')}-pages-${range.start}-${range.end}.pdf`;
      const chunkPath = path.join(chunkDir, chunkFileName);

      onProgress({
        type: 'chunk_start',
        chunkIndex,
        startPage: range.start,
        endPage: range.end,
      });

      let analyzed: AnalyzedChunk;
      try {
        await extractPdfChunk({
          pdfPath: opts.pdfPath,
          chunkPath,
          startPage: range.start,
          endPage: range.end,
        });
        const base64 = (await readFile(chunkPath)).toString('base64');

        const result = await callLLM<string>({
          providerId: opts.providerId,
          prompt: chunkPromptBuilder({
            chunkIndex,
            totalChunks: ranges.length,
            startPage: range.start,
            endPage: range.end,
          }),
          attachments: [
            {
              kind: 'pdf',
              format: 'pdf',
              name: `pdf-chunk-${String(chunkIndex).padStart(3, '0')}-pages-${range.start}-${range.end}`,
              base64,
            },
          ],
          maxOutputTokens: maxChunkTokens,
          maxRetries,
        });

        if (!result.rawText.trim()) {
          throw new Error(`Chunk ${chunkIndex} returned empty text from LLM`);
        }

        analyzed = {
          chunkIndex,
          startPage: range.start,
          endPage: range.end,
          text: result.rawText,
          tokenUsage: result.tokenUsage,
          latencyMs: result.latencyMs,
          retries: result.retries,
          requestPayload: result.requestPayload,
        };
      } catch (err) {
        onProgress({ type: 'error', stage: 'chunk', error: err, chunkIndex });
        throw err;
      }

      chunks.push(analyzed);
      onProgress({
        type: 'chunk_done',
        chunkIndex,
        startPage: range.start,
        endPage: range.end,
        latencyMs: analyzed.latencyMs,
        tokenUsage: analyzed.tokenUsage,
        retries: analyzed.retries,
      });

      // 后面还有 chunk 或终审 → 睡，避开 429
      const moreRequestsAhead = true; // 终审一定还要再发一次
      if (delaySeconds > 0 && moreRequestsAhead) {
        onProgress({ type: 'sleep', seconds: delaySeconds, reason: 'between_requests' });
        await sleep(delaySeconds * 1000);
      }
    }

    // ── 终审 ───────────────────────────────────────────────
    onProgress({ type: 'final_start' });
    let finalResult: AnalyzePdfResult['final'];
    try {
      const result = await callLLM<string>({
        providerId: opts.providerId,
        prompt: finalPromptBuilder({
          pdfPath: opts.pdfPath,
          pageCount,
          chunkSummaries: chunks.map((c) => ({
            chunkIndex: c.chunkIndex,
            startPage: c.startPage,
            endPage: c.endPage,
            text: c.text,
          })),
        }),
        // 终审是纯文本聚合，不带 PDF 附件
        maxOutputTokens: maxFinalTokens,
        maxRetries,
      });

      if (!result.rawText.trim()) {
        throw new Error('Final synthesis returned empty text from LLM');
      }

      finalResult = {
        text: result.rawText,
        tokenUsage: result.tokenUsage,
        latencyMs: result.latencyMs,
        retries: result.retries,
        requestPayload: result.requestPayload,
      };
    } catch (err) {
      onProgress({ type: 'error', stage: 'final', error: err });
      throw err;
    }

    onProgress({
      type: 'final_done',
      latencyMs: finalResult.latencyMs,
      tokenUsage: finalResult.tokenUsage,
      retries: finalResult.retries,
    });

    return {
      pageCount,
      chunkPages,
      chunks,
      final: finalResult,
    };
  } finally {
    await rm(chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}
