/**
 * callLLM — Webex LLM Proxy 统一入口（Tech Stack §M2）
 *
 * 调用层契约（运营端 PRD §7）：callLLM(providerId, prompt, schema?) → 结构化结果
 *
 * 流程：
 *   1. prisma.llm_provider.findUnique(providerId, enabled=true)
 *   2. 取 token：process.env[provider.auth_env_var]
 *   3. 按 provider.protocol 选适配器（openai_chat / google_generate_content）
 *   4. 适配器 buildRequest → fetch → parseResponse 拿 rawText + tokenUsage
 *   5. schema 给定时：extractJsonBlock → schema.safeParse；失败 retry 1 次（加严格 JSON 提示）
 *   6. HTTP 5xx 也 retry 1 次；4xx 直接抛
 *
 * 不做的事：
 *   - 不写 llm_parse_job 表（caller 用 result.requestPayload 自行 redact 后落库）
 *   - 不实现成本估算（caller 用 tokenUsage × 单价表自己算）
 */
import { prisma } from '@hao/db';
import type { ZodTypeAny } from 'zod';
import { googleGenerateContentAdapter } from './providers/google-generate-content';
import { openaiChatAdapter } from './providers/openai-chat';
import type { ProviderAdapter } from './providers/types';

export interface CallLLMOptions {
  providerId: string;
  prompt: string;
  /** 期望 LLM 输出的 zod schema；非空时强制 structured output + 校验 */
  schema?: ZodTypeAny;
  /** schema/HTTP 失败重试次数；默认 1（PRD §5.1 T10 / Tech Stack §M2 风险表） */
  maxRetries?: number;
}

export interface CallLLMResult<T = unknown> {
  /** schema 给定时：T；否则：rawText 字符串 */
  data: T;
  rawText: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  provider: string;
  /**
   * 实际发出的 body（明文，含真实 token）。caller 必须先调
   * redactAuthHeaders 再写入 llm_parse_job.request_payload。
   */
  requestPayload: object;
  /** 重试次数（0 = 一次成功，1 = 重试 1 次后成功） */
  retries: number;
}

export class LLMHttpError extends Error {
  override readonly name = 'LLMHttpError';
  constructor(
    public readonly status: number,
    public readonly responseText: string,
  ) {
    super(`LLM HTTP ${status}: ${responseText.slice(0, 200)}`);
  }
}

export class LLMSchemaError extends Error {
  override readonly name = 'LLMSchemaError';
  constructor(
    public readonly rawText: string,
    public readonly zodIssues: unknown,
  ) {
    super(`LLM output schema mismatch: ${JSON.stringify(zodIssues).slice(0, 300)}`);
  }
}

function pickAdapter(protocol: string): ProviderAdapter {
  switch (protocol) {
    case 'openai_chat':
      return openaiChatAdapter;
    case 'google_generate_content':
      return googleGenerateContentAdapter;
    default:
      throw new Error(`Unknown LLM protocol: ${protocol}`);
  }
}

/**
 * 从 LLM 输出中抽 JSON 对象。容忍：
 *   - 纯 JSON
 *   - ```json ... ``` 代码块包裹
 *   - 前后混入解释性文字（取第一个 {...} 块）
 */
export function extractJsonBlock(text: string): unknown {
  // 1) ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  // 2) 第一个 { 到最后一个 }（非贪婪不行，因为可能多层嵌套；用首尾配对）
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  // 3) 整段就是 JSON
  return JSON.parse(text);
}

export async function callLLM<T = unknown>(opts: CallLLMOptions): Promise<CallLLMResult<T>> {
  const maxRetries = opts.maxRetries ?? 1;

  const provider = await prisma.llm_provider.findUnique({
    where: { id: opts.providerId },
  });
  if (!provider) throw new Error(`llm_provider not found: ${opts.providerId}`);
  if (!provider.enabled) throw new Error(`llm_provider disabled: ${opts.providerId}`);

  const token = process.env[provider.auth_env_var];
  if (!token) {
    throw new Error(
      `env var ${provider.auth_env_var} not set; required by provider ${opts.providerId}`,
    );
  }

  const adapter = pickAdapter(provider.protocol);
  const defaultParams = (provider.default_params ?? {}) as Record<string, unknown>;
  const quirks = (provider.quirks ?? {}) as Record<string, unknown>;
  const outputNormalizers = (provider.output_normalizers ?? []) as string[];
  const maxOutputTokens = provider.max_output_tokens ?? null;

  let attempt = 0;
  let lastErr: unknown;
  let promptForAttempt = opts.prompt;

  while (attempt <= maxRetries) {
    const { url, init, bodyForLog } = adapter.buildRequest({
      endpoint: provider.endpoint,
      model: provider.model,
      token,
      prompt: promptForAttempt,
      schema: opts.schema,
      defaultParams,
      maxOutputTokens,
      quirks,
      outputNormalizers,
    });

    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // 网络错误：等同 5xx 处理
      lastErr = err;
      attempt++;
      continue;
    }
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const text = await res.text();
      lastErr = new LLMHttpError(res.status, text);
      // 4xx 直接抛（除了 429 限速可重试，但 v0.1 简化：4xx 一律不 retry）
      if (res.status < 500 && res.status !== 429) throw lastErr;
      attempt++;
      continue;
    }

    const json = await res.json();
    const parsed0 = adapter.parseResponse(json);
    const rawText =
      adapter.postProcess && outputNormalizers.length > 0
        ? adapter.postProcess(parsed0.rawText, outputNormalizers)
        : parsed0.rawText;
    const tokenUsage = parsed0.tokenUsage;

    if (!opts.schema) {
      return {
        data: rawText as T,
        rawText,
        tokenUsage,
        latencyMs,
        provider: opts.providerId,
        requestPayload: bodyForLog,
        retries: attempt,
      };
    }

    // schema 校验
    let extracted: unknown;
    try {
      extracted = extractJsonBlock(rawText);
    } catch (err) {
      lastErr = new LLMSchemaError(rawText, [{ message: 'JSON parse failed', err: String(err) }]);
      attempt++;
      promptForAttempt = `${opts.prompt}\n\n请严格输出符合 schema 的 JSON，不要包含任何解释文字或 markdown 代码块标记。`;
      continue;
    }

    const parsed = opts.schema.safeParse(extracted);
    if (parsed.success) {
      return {
        data: parsed.data as T,
        rawText,
        tokenUsage,
        latencyMs,
        provider: opts.providerId,
        requestPayload: bodyForLog,
        retries: attempt,
      };
    }
    lastErr = new LLMSchemaError(rawText, parsed.error.issues);
    attempt++;
    promptForAttempt = `${opts.prompt}\n\n上一次输出未通过 schema 校验：${JSON.stringify(parsed.error.issues).slice(0, 500)}\n请严格按 schema 重新输出。`;
  }

  throw lastErr ?? new Error('callLLM exhausted retries with no recorded error');
}
