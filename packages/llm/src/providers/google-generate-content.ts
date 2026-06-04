/**
 * Google generateContent 协议适配器
 *
 * 端点：POST {endpoint}（endpoint 已含 :generateContent）
 * 鉴权：Webex 代理用 Bearer，原生 Google 用 ?key=...；统一走 Authorization: Bearer
 * Body: { contents: [{ role, parts: [{text}] }], generationConfig: { temperature, maxOutputTokens, responseMimeType, responseSchema? } }
 * Response: { candidates: [{ content: { parts: [{text}] } }], usageMetadata: { promptTokenCount, candidatesTokenCount } }
 */
import { zodToJsonSchema } from '../json-schema';
import type { BuildRequestArgs, BuildRequestResult, ParsedResponse, ProviderAdapter } from './types';

function buildRequest(args: BuildRequestArgs): BuildRequestResult {
  // Google 协议把 temperature / max_tokens 塞 generationConfig；这里把 default_params
  // 的 OpenAI 风味字段映射过来，让运营在 llm_provider.default_params 里继续用同套术语
  const dp = args.defaultParams;
  const generationConfig: Record<string, unknown> = {};
  if (typeof dp.temperature === 'number') generationConfig.temperature = dp.temperature;
  if (typeof dp.max_tokens === 'number') generationConfig.maxOutputTokens = dp.max_tokens;
  if (typeof dp.top_p === 'number') generationConfig.topP = dp.top_p;

  if (args.schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = zodToJsonSchema(args.schema);
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
    generationConfig,
  };

  return {
    url: args.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify(body),
    },
    bodyForLog: body,
  };
}

interface GoogleGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function parseResponse(json: unknown): ParsedResponse {
  const r = json as GoogleGenerateContentResponse;
  const parts = r?.candidates?.[0]?.content?.parts ?? [];
  const rawText = parts.map((p) => p?.text ?? '').join('');
  const u = r?.usageMetadata;
  const tokenUsage =
    typeof u?.promptTokenCount === 'number' && typeof u?.candidatesTokenCount === 'number'
      ? { input: u.promptTokenCount, output: u.candidatesTokenCount }
      : null;
  return { rawText, tokenUsage };
}

export const googleGenerateContentAdapter: ProviderAdapter = { buildRequest, parseResponse };
