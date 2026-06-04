/**
 * @hao/llm — Webex LLM Proxy 抽象层（Tech Stack D5 / 运营端 PRD §7）
 *
 * 对外契约：callLLM(providerId, prompt, schema?) → { data, rawText, tokenUsage, latencyMs, requestPayload, retries }
 * caller 流程：拿到 result.requestPayload → redactAuthHeaders → 落 llm_parse_job
 *
 * 模块清单：
 *   - callLLM.ts                            统一入口（DB 查 provider + dispatch + retry + schema 校验）
 *   - providers/openai-chat.ts              OpenAI Chat Completions 协议
 *   - providers/google-generate-content.ts  Google generateContent 协议
 *   - providers/types.ts                    ProviderAdapter 接口
 *   - json-schema.ts                        极简 zod → JSON Schema（structured output 用）
 *   - redact.ts                             请求 body 脱敏（PARSE_JOB.request_payload 入库前必经）
 */
export {
  callLLM,
  extractJsonBlock,
  LLMHttpError,
  LLMSchemaError,
  type CallLLMOptions,
  type CallLLMResult,
} from './callLLM';
export { redactAuthHeaders } from './redact';
export { zodToJsonSchema } from './json-schema';
export type { ProviderAdapter } from './providers/types';

export const LLM_VERSION = '0.1.0';
