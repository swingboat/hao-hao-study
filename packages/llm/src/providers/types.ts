/**
 * Provider 协议适配器共享类型
 *
 * 适配器把 callLLM 的统一入参 → 各 provider 真实 HTTP 协议。每个适配器只关心
 * 一种 LLMProtocol（openai_chat / google_generate_content），互相不耦合。
 */
import type { ZodTypeAny } from 'zod';

export interface BuildRequestArgs {
  endpoint: string;
  model: string;
  token: string;
  prompt: string;
  /** 给定时启用 structured output（OpenAI: response_format / Google: responseSchema） */
  schema?: ZodTypeAny;
  /** llm_provider.default_params（temperature / max_tokens 等） */
  defaultParams: Record<string, unknown>;
}

export interface BuildRequestResult {
  url: string;
  init: RequestInit;
  /**
   * 拷贝一份用于落库的 request body（同 init.body 但解开成对象，不含真实 token）。
   * caller 拿到后再调 redactAuthHeaders 兜底脱敏一次。
   */
  bodyForLog: object;
}

export interface ParsedResponse {
  /** LLM 输出的纯文本（多 chunk / multi-part 已拼起来） */
  rawText: string;
  /** Token 用量；provider 没返就是 null */
  tokenUsage: { input: number; output: number } | null;
}

export interface ProviderAdapter {
  buildRequest(args: BuildRequestArgs): BuildRequestResult;
  parseResponse(json: unknown): ParsedResponse;
}
