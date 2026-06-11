/**
 * callWithSplitFallback — analyzeImageBatch 的 split-on-recoverable-error 封装
 *
 * 多页 LLM 调用失败时（典型：Webex Gemini 输出 cap 撞顶导致 JSON 截断 → LLMSchemaError；
 * 或 proxy 偶发 5xx → LLMHttpError），自动拆成单页逐个跑，把成功页的 items 合成一份
 * "看起来像整片成功"的 result 返回。caller 拿到的 shape 与直接调 analyzeImageBatch
 * 完全一致（多 synthesized + subStats 两个 debug 字段）。
 *
 * 触发条件：
 *   - err.name === 'LLMSchemaError' 或 'LLMHttpError'（其它 error 类型不重试，直接抛）
 *   - images.length > 1（单页失败拆不出更小，不重试）
 *
 * 为什么按 err.name 字符串识别（不用 instanceof）：
 *   Next.js dev HMR 会把 @hao/llm 编译成多份独立模块（callLLM 内部 throw 的实例
 *   vs 本文件 import 的 class 不是同一份），instanceof 误返 false → split fallback
 *   被跳过。LLMHttpError / LLMSchemaError 都在构造里设了 override readonly name，
 *   按名字识别在 dev/prod 都稳。
 *
 *   实测：admin job 0ec05f32 chunk 18 (pages 35-36) 撞到本 bug —— 三次 500 后 callLLM
 *   抛 LLMHttpError，但 instanceof 返 false，被当成不可恢复，没走 split fallback。
 *
 * 失败语义：
 *   - 整片首调失败 + 不可恢复 / 单页 → throw 原 err（caller 自己处理）
 *   - 整片首调失败 + 可恢复 + 多页 → 拆单页：
 *       - 全员阵亡：throw new Error(`split fallback 全部失败: ${第一个 reason}`)
 *       - 部分成功：合 subResults 的 items 字段返回；失败页通过 onSubFailure 通知
 *
 * caller 责任：用 mergeText callback 决定如何把多个单页结果合成一片的 text。KP 的实现
 * 形如 `(subs) => JSON.stringify({items: subs.flatMap(r => extractJsonBlock(r.text)?.items ?? [])})`，
 * Items 那条线 schema 是 `{items, resources}`，要合两个数组 —— 由 caller 自己写。
 */
import type { ZodTypeAny } from 'zod';
import {
  type AnalyzeImageBatchInputImage,
  type AnalyzeImageBatchResult,
  analyzeImageBatch,
} from '../vision/analyze-image-batch';

export interface CallWithSplitFallbackOpts {
  providerId: string;
  /** 多页图，每页一张 PNG（>1 张才会触发 split fallback） */
  images: AnalyzeImageBatchInputImage[];
  /** images[i] 对应的页号；长度必须 = images.length。用于 perPagePrompt + onSubFailure 日志 */
  pageNumbers: number[];
  /** 整片调用的 prompt */
  prompt: string;
  /** split 触发后给单页用的 prompt builder。不传则单页复用整片 prompt（不推荐：单页 prompt 通常更精简） */
  perPagePrompt?: (page: number) => string;
  /** zod schema；同 analyzeImageBatch */
  schema: ZodTypeAny;
  maxOutputTokens?: number;
  /** 整片首调内部重试次数（KP 当前传 0 = fail-fast，让 split fallback 接管） */
  maxRetries?: number;
  /** split 触发后单页调用的 maxRetries；不传则继承 maxRetries */
  perPageMaxRetries?: number;
  /**
   * 用 subResults 拼合成 text。caller 决定 schema shape。
   * 不会传空数组（全员阵亡时函数已经 throw）。
   */
  mergeText: (subResults: Array<AnalyzeImageBatchResult<unknown>>) => string;
  /** split 被触发时调用一次。reason='schema' 即 LLMSchemaError，'http' 即 LLMHttpError。 */
  onSplit?: (reason: 'schema' | 'http', err: unknown) => void;
  /** 单页失败时调用。caller 通常拿来 console.warn。 */
  onSubFailure?: (page: number, reason: string) => void;
}

export interface CallWithSplitFallbackResult {
  /** LLM 文本（整片成功 → 直接 result.text；split 合成 → mergeText 输出） */
  text: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  /** split 时是 sub-calls 重试次数累加 */
  retries: number;
  /** 整片成功时是首调 payload；split 时是第一个成功子调用的 payload（审计 representative 够用） */
  requestPayload: object;
  /** 是否走了 split fallback */
  synthesized: boolean;
  /** synthesized=true 时记录子调用统计 */
  subStats?: { ok: number; failed: number };
}

function isLLMHttpError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'LLMHttpError';
}
function isLLMSchemaError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'LLMSchemaError';
}

export async function callWithSplitFallback(
  opts: CallWithSplitFallbackOpts,
): Promise<CallWithSplitFallbackResult> {
  if (opts.images.length !== opts.pageNumbers.length) {
    throw new Error(
      `callWithSplitFallback: images.length=${opts.images.length} != pageNumbers.length=${opts.pageNumbers.length}`,
    );
  }

  // ── 1) 整片首调 ─────────────────────────────────────────
  try {
    const r = await analyzeImageBatch({
      providerId: opts.providerId,
      images: opts.images,
      prompt: opts.prompt,
      schema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens,
      maxRetries: opts.maxRetries,
    });
    return {
      text: r.text,
      tokenUsage: r.tokenUsage,
      latencyMs: r.latencyMs,
      retries: r.retries,
      requestPayload: r.requestPayload,
      synthesized: false,
    };
  } catch (err) {
    const isSchema = isLLMSchemaError(err);
    const isHttp = isLLMHttpError(err);
    const recoverable = isSchema || isHttp;
    if (!recoverable || opts.images.length <= 1) throw err;

    // ── 2) split 触发：单页逐个跑 ─────────────────────────
    opts.onSplit?.(isSchema ? 'schema' : 'http', err);

    const subResults: Array<AnalyzeImageBatchResult<unknown>> = [];
    const subFailures: Array<{ page: number; reason: string }> = [];
    const perPageMaxRetries = opts.perPageMaxRetries ?? opts.maxRetries;

    for (let pi = 0; pi < opts.images.length; pi += 1) {
      // biome-ignore lint/style/noNonNullAssertion: index 由 for 循环守门
      const img = opts.images[pi]!;
      // biome-ignore lint/style/noNonNullAssertion: 长度上面已校验
      const page = opts.pageNumbers[pi]!;
      try {
        const r = await analyzeImageBatch({
          providerId: opts.providerId,
          images: [img],
          prompt: opts.perPagePrompt ? opts.perPagePrompt(page) : opts.prompt,
          schema: opts.schema,
          maxOutputTokens: opts.maxOutputTokens,
          maxRetries: perPageMaxRetries,
        });
        subResults.push(r);
      } catch (subErr) {
        const reason = subErr instanceof Error ? subErr.message : String(subErr);
        subFailures.push({ page, reason });
        opts.onSubFailure?.(page, reason);
      }
    }

    // 全员阵亡 → 抛第一个 reason
    if (subResults.length === 0) {
      const firstReason = subFailures[0]?.reason ?? '<unknown>';
      throw new Error(`split fallback 全部失败: ${firstReason}`);
    }

    // ── 3) 合成 result ────────────────────────────────────
    const totalIn = subResults.reduce((s, r) => s + (r.tokenUsage?.input ?? 0), 0);
    const totalOut = subResults.reduce((s, r) => s + (r.tokenUsage?.output ?? 0), 0);
    const totalLatency = subResults.reduce((s, r) => s + r.latencyMs, 0);
    const totalRetries = subResults.reduce((s, r) => s + r.retries, 0);

    return {
      text: opts.mergeText(subResults),
      tokenUsage: totalIn || totalOut ? { input: totalIn, output: totalOut } : null,
      latencyMs: totalLatency,
      retries: totalRetries,
      // 审计 representative：第一个成功的 sub 的 requestPayload 够用
      requestPayload: subResults[0]?.requestPayload ?? {},
      synthesized: true,
      subStats: { ok: subResults.length, failed: subFailures.length },
    };
  }
}
