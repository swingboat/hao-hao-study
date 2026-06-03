/**
 * @hao/llm — Webex LLM Proxy 抽象层（Tech Stack D5）
 *
 * 对外只暴露 callLLM(providerId, prompt, schema?)，内部按 provider
 * 协议（OpenAI Chat / Google generateContent）做协议适配。
 *
 * 模块计划（M2 阶段实现）：
 *   - callLLM.ts                       统一入口
 *   - providers/openai-chat.ts         Webex Provider 1（gemini-3.1-pro）
 *   - providers/google-generate-content.ts  Webex Provider 2（gemini-3-pro-image）
 *   - redact.ts                        请求/响应脱敏（PARSE_JOB.request_payload 入库前必经）
 *   - types.ts                         共享类型与 Provider registry
 *
 * 当前文件为骨架，签名先固定；实现待 M2 阶段。
 */

import { z } from 'zod';

export type ProviderId = 'webex-gemini-3.1-pro' | 'webex-gemini-3-pro-image';

export interface CallLLMOptions {
  providerId: ProviderId;
  /** 自然语言 prompt 或多模态 parts（图片/文件 URI） */
  prompt: string;
  /** 期望 LLM 输出的 zod schema；非空时会尝试 JSON 抽取 + 校验 */
  schema?: z.ZodTypeAny;
  /** 单次最大 retry 次数；默认 1 次 */
  maxRetries?: number;
}

export interface CallLLMResult<T = unknown> {
  data: T;
  rawText: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  provider: ProviderId;
}

export async function callLLM<T = unknown>(_opts: CallLLMOptions): Promise<CallLLMResult<T>> {
  throw new Error('callLLM not implemented yet — 待 M2 阶段实现（packages/llm）');
}

export const LLM_VERSION = '0.1.0-skeleton';
