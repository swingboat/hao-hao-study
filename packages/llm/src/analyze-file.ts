/**
 * analyzeFile — L0 文件解析公共层（傻瓜入口）
 *
 * 契约：file + prompt → text (+ 可选 schema 解析后的 data)。
 * 业务层不需要懂 rasterize / multi-page / image format / provider 选择。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 边界（重要，决定了 L0 不变成 L2）：
 *   - L0 **不**做 figure 裁切 / 落 storage（要这个走 L2 `analyzeImagesToStorage`）
 *   - L0 **不**做完整性自检 / 边界重抽 / dedup（要这个走 L2 `extractQuestionsFromPdf`）
 *   - L0 **不**发 progress 事件（要事件级控制走 L1 `analyzePdfWithVision`）
 *   - L0 **不**支持 PDF + schema 的多页合并（schema 模式下多页 PDF 抛错；
 *     真要结构化多页抽取请走 L2 extractQuestionsFromPdf）
 *
 * 跨页题问题：
 *   - PDF 默认 `pagesPerCall: 1`（每页独立调 LLM），跨页内容会被切断
 *   - 设 `pagesPerCall: 2|3` 让 LLM 一次看相邻多页 → 缓解但不能根治 chunk 边界
 *   - 教材抽题"不丢题"硬需求请走 L2 `extractQuestionsFromPdf`（带边界重抽）
 *
 * 弃用提醒：
 *   - bedrock_converse 原生 PDF 路径已软弃用（429 频发）；L0 PDF 路径**仅**走
 *     vision（pdftoppm → openai_chat image_url），无 mode 切换。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ZodTypeAny } from 'zod';

import {
  analyzeImageBatch,
  type AnalyzeImageBatchInputImage,
} from './vision/analyze-image-batch';
import { rasterizePdf } from './pdf/rasterize';

/** 默认 image provider —— vision OK + 1M context + Webex 上单价低 */
const DEFAULT_IMAGE_PROVIDER_ID = 'webex-gemini-3.1-pro';

// ────────── 公共选项 ──────────

export interface AnalyzeFileBaseOptions<T = unknown> {
  prompt: string;
  /** 默认 'webex-gemini-3.1-pro' */
  providerId?: string;
  /** 给定 → 走 structured output（image 直接 zod 校验；PDF + 多页时抛错） */
  schema?: ZodTypeAny;
  maxOutputTokens?: number;
  /** callLLM 重试次数，默认 2 */
  maxRetries?: number;
}

// ────────── image ──────────

export interface AnalyzeFileImageOptions<T = unknown> extends AnalyzeFileBaseOptions<T> {
  imagePath: string;
}

export interface AnalyzeFileImageResult<T = unknown> {
  text: string;
  /** schema 给定且解析成功才有 */
  data?: T;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  retries: number;
}

const IMAGE_FORMAT_BY_EXT: Record<string, 'png' | 'jpeg' | 'webp'> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
};

function inferImageFormat(imagePath: string): 'png' | 'jpeg' | 'webp' {
  const ext = path.extname(imagePath).toLowerCase();
  const fmt = IMAGE_FORMAT_BY_EXT[ext];
  if (!fmt) {
    throw new Error(
      `analyzeFile.image: unsupported image extension '${ext}'; expected one of ${Object.keys(IMAGE_FORMAT_BY_EXT).join(', ')}`,
    );
  }
  return fmt;
}

async function analyzeImage<T = unknown>(
  opts: AnalyzeFileImageOptions<T>,
): Promise<AnalyzeFileImageResult<T>> {
  const format = inferImageFormat(opts.imagePath);
  const bytes = await readFile(opts.imagePath);
  const name = path.basename(opts.imagePath, path.extname(opts.imagePath));

  const r = await analyzeImageBatch<T>({
    providerId: opts.providerId ?? DEFAULT_IMAGE_PROVIDER_ID,
    images: [{ bytes, format, name }],
    prompt: opts.prompt,
    schema: opts.schema,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: opts.maxRetries,
  });

  return {
    text: r.text,
    data: r.data,
    tokenUsage: r.tokenUsage,
    latencyMs: r.latencyMs,
    retries: r.retries,
  };
}

// ────────── pdf ──────────

export interface AnalyzeFilePdfOptions<T = unknown> extends AnalyzeFileBaseOptions<T> {
  pdfPath: string;
  /** 渲染 DPI；默认 150 */
  dpi?: number;
  /** 仅渲指定页范围（含端点） */
  firstPage?: number;
  lastPage?: number;
  /**
   * 一次 LLM 调用喂多少张连续页图；默认 1（每页独立）。
   * 设 2 或 3 可缓解跨页题被切断；代价是单次 output 变大、可能撞 max_tokens。
   * 真要"不丢题"请走 L2 extractQuestionsFromPdf。
   */
  pagesPerCall?: number;
  /** 两次 LLM 调用之间睡秒数；默认 8（避 Webex 429） */
  delayBetweenRequestsSeconds?: number;
}

export interface AnalyzeFilePdfPageGroup {
  /** 这次调用覆盖的页号列表（连续） */
  pages: number[];
  text: string;
  tokenUsage: { input: number; output: number } | null;
  /** 这次调用失败时填，text 为 ''，仍计入 perPage 让 caller 看到 */
  error?: string;
}

export interface AnalyzeFilePdfResult<T = unknown> {
  pageCount: number;
  /** 所有成功 group 的 text join（失败 group 跳过）；分隔符 '\n\n---\n\n' */
  text: string;
  /** 仅当 schema 给定且整本 PDF 只产生 1 个 group（≤ pagesPerCall）才有 */
  data?: T;
  perPage: AnalyzeFilePdfPageGroup[];
  tokenUsage: { input: number; output: number };
  latencyMs: number;
}

function chunkPages(pages: number[], pagesPerCall: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < pages.length; i += pagesPerCall) {
    groups.push(pages.slice(i, i + pagesPerCall));
  }
  return groups;
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function analyzePdf<T = unknown>(
  opts: AnalyzeFilePdfOptions<T>,
): Promise<AnalyzeFilePdfResult<T>> {
  const providerId = opts.providerId ?? DEFAULT_IMAGE_PROVIDER_ID;
  const pagesPerCall = opts.pagesPerCall ?? 1;
  const delayMs = (opts.delayBetweenRequestsSeconds ?? 8) * 1000;
  const dpi = opts.dpi ?? 150;

  // 1) 渲染
  const t0 = Date.now();
  const renderedPages = await rasterizePdf(opts.pdfPath, {
    dpi,
    firstPage: opts.firstPage,
    lastPage: opts.lastPage,
  });
  const pageNumbers = renderedPages.map((p) => p.page);
  const groups = chunkPages(pageNumbers, pagesPerCall);

  // 2) 分组调 LLM
  const perPage: AnalyzeFilePdfPageGroup[] = [];
  let tokTotalIn = 0;
  let tokTotalOut = 0;
  let firstGroupData: T | undefined;
  const wantSchema = !!opts.schema;
  if (wantSchema && groups.length > 1) {
    throw new Error(
      `analyzeFile.pdf: schema mode requires the whole PDF to fit in a single LLM call (got ${groups.length} groups with pagesPerCall=${pagesPerCall}); use L2 extractQuestionsFromPdf for multi-page structured extraction`,
    );
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const images: AnalyzeImageBatchInputImage[] = group.map((pageNo) => {
      const rp = renderedPages.find((r) => r.page === pageNo)!;
      return { bytes: rp.png, format: 'png', name: `page-${String(pageNo).padStart(3, '0')}` };
    });

    try {
      const r = await analyzeImageBatch<T>({
        providerId,
        images,
        prompt: opts.prompt,
        schema: opts.schema,
        maxOutputTokens: opts.maxOutputTokens,
        maxRetries: opts.maxRetries,
      });
      perPage.push({
        pages: group,
        text: r.text,
        tokenUsage: r.tokenUsage,
      });
      if (r.tokenUsage) {
        tokTotalIn += r.tokenUsage.input;
        tokTotalOut += r.tokenUsage.output;
      }
      if (gi === 0 && wantSchema) firstGroupData = r.data;
    } catch (err) {
      perPage.push({
        pages: group,
        text: '',
        tokenUsage: null,
        error: String(err).slice(0, 500),
      });
    }

    // 末组之后不睡
    if (gi < groups.length - 1 && delayMs > 0) {
      await SLEEP(delayMs);
    }
  }

  const text = perPage
    .filter((g) => !g.error)
    .map((g) => g.text)
    .join('\n\n---\n\n');

  return {
    pageCount: renderedPages.length,
    text,
    data: firstGroupData,
    perPage,
    tokenUsage: { input: tokTotalIn, output: tokTotalOut },
    latencyMs: Date.now() - t0,
  };
}

// ────────── 对外门面 ──────────

export const analyzeFile = {
  image: analyzeImage,
  pdf: analyzePdf,
};
