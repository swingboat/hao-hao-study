/**
 * analyzeImageBatch — L3 原语：一次 LLM 调用喂 N 张图。
 *
 * 与 analyzeImages（每张图一次调用）正交：本函数把多张图打包到**单次** callLLM
 * 的 attachments 数组里。openai_chat adapter 原生支持多 image_url content part，
 * 所以本层是薄包，主要价值是：
 *   1. 给 L0 (analyzeFile.pdf, pagesPerCall>1) 提供"多页一次看"能力 → 缓解跨页
 *      题被切的问题，同时减少 LLM 调用次数（429 友好）。
 *   2. 给 L2 (extractItemsFromPdf) 提供 chunk 级抽题原语 + structured output。
 *
 * 不做（caller 责任）：
 *   - 不分块：caller 自己决定哪几张图放一组
 *   - 不重试 / 不汇总跨调用 token：那是 caller 编排层的事
 *   - 不解析 _src_pages / _truncated 这类语义字段：那是 L2 的 prompt 契约
 */
import { callLLM, extractJsonBlock } from '../callLLM';
import type { Attachment } from '../providers/types';
import type { ZodTypeAny, z } from 'zod';

export interface AnalyzeImageBatchInputImage {
  /** 图片字节 */
  bytes: Buffer;
  /** 图片 MIME 子类型；caller 必须正确传，本层不嗅探 */
  format: 'png' | 'jpeg' | 'webp';
  /** 日志/调试用 name（建议形如 "page-001"）；不参与 LLM 协议 */
  name: string;
}

export interface AnalyzeImageBatchOptions<T = unknown> {
  /** llm_provider.id；必须是 protocol=openai_chat 且 capabilities.image=true 的 provider */
  providerId: string;
  /** 待打包的图片列表；建议 1-5 张（多了易撞 max_output_tokens） */
  images: AnalyzeImageBatchInputImage[];
  /** 业务 prompt（caller 自己负责约束 LLM 输出格式） */
  prompt: string;
  /** 给定时启用 structured output：返回 data 字段 */
  schema?: ZodTypeAny;
  maxOutputTokens?: number;
  /** callLLM 重试次数（429/5xx/schema 失败），默认 2 */
  maxRetries?: number;
}

export interface AnalyzeImageBatchResult<T = unknown> {
  /** LLM 原始输出文本（永远有） */
  text: string;
  /** 仅 schema 给定且解析成功才有；解析失败返 undefined + parseError */
  data?: T;
  parseError?: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  retries: number;
  /** 调试用：实际发出的请求 body（已含真实 token；caller 必须 redact 后入库） */
  requestPayload: object;
}

export async function analyzeImageBatch<T = unknown>(
  opts: AnalyzeImageBatchOptions<T>,
): Promise<AnalyzeImageBatchResult<T>> {
  if (opts.images.length === 0) {
    throw new Error('analyzeImageBatch: images must not be empty');
  }

  const attachments: Attachment[] = opts.images.map((img) => ({
    kind: 'image',
    format: img.format,
    name: img.name,
    base64: img.bytes.toString('base64'),
  }));

  const t0 = Date.now();
  const result = await callLLM({
    providerId: opts.providerId,
    prompt: opts.prompt,
    schema: opts.schema,
    attachments,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: opts.maxRetries ?? 2,
  });

  // schema 给定时 callLLM 已经做了 zod 校验，data 直接可用。
  // schema 未给定时我们不强制 JSON，但 caller 若 prompt 里要求了 JSON，可以
  // 自己用 extractJsonBlock 解析 result.rawText —— 这里不替 caller 决定。
  let data: T | undefined;
  let parseError: string | undefined;
  if (opts.schema) {
    data = result.data as T;
  }

  // 注：caller 可以根据 result.rawText 自己额外做语义解析（如 L2 找 _src_pages）。
  void extractJsonBlock; // 仅作为 callLLM 内部解析路径的引用，不在此层强用

  return {
    text: result.rawText,
    data,
    parseError,
    tokenUsage: result.tokenUsage,
    latencyMs: Date.now() - t0,
    retries: result.retries,
    requestPayload: result.requestPayload,
  };
}
