/**
 * Provider 协议适配器共享类型
 *
 * 适配器把 callLLM 的统一入参 → 各 provider 真实 HTTP 协议。每个适配器只关心
 * 一种 LLMProtocol（openai_chat / google_generate_content），互相不耦合。
 *
 * 模型族差异通过三组字段在 callLLM ↔ adapter 之间显式透传：
 *   - quirks                 行为开关（是否发 temperature / response_format、max_tokens 字段名…）
 *   - maxOutputTokens        provider 实测可达的输出 token 上限（vs 文档值）
 *   - outputNormalizers      raw 文本后处理 key 列表
 *
 * 业务层始终只用 callLLM(providerId, prompt, schema?)，看不到 Gemini / Claude / GPT 的差异。
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
  /**
   * llm_provider.max_output_tokens — provider 实测可达输出 token 真值。
   * 优先级：本字段 > defaultParams.max_tokens > 不发。
   */
  maxOutputTokens?: number | null;
  /**
   * llm_provider.quirks — 模型族行为开关。已知键见 schema 注释。
   * adapter 见到未知键按 default 行为走（向前兼容）。
   */
  quirks?: Record<string, unknown>;
  /**
   * llm_provider.output_normalizers — raw 文本后处理 key 列表，仅作信息透传，
   * 真正执行在 adapter.postProcess。adapter 自己装请求时一般用不到。
   */
  outputNormalizers?: string[];
}

export interface BuildRequestResult {
  url: string;
  init: RequestInit;
  /**
   * 拷贝一份用于落库的 request body（同 init.body 但解开成对象，不含真实 token）。
   * caller 拿到后再调 redactAuthHeaders 兜底脱敏一次。
   */
  bodyForLog: object;
  /**
   * true = 适配器没用原生 structured output（如 OpenAI response_format），
   * 改为把 schema JSON shape 注入 prompt 末尾，靠 callLLM 后置 zod 校验兜底。
   * 仅供 callLLM 写调试日志 / 决策用，业务层无感。
   */
  schemaInPrompt?: boolean;
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
  /**
   * raw 文本后处理钩子，按 normalizers 顺序执行；可选，未实现等同 identity。
   * 已知 key 实现见 openai-chat.ts / google-generate-content.ts。
   */
  postProcess?(rawText: string, normalizers: string[]): string;
}
