/**
 * Google generateContent 协议适配器
 *
 * 端点：POST {endpoint}（endpoint 已含 :generateContent）
 * 鉴权：Webex 代理用 Bearer，原生 Google 用 ?key=...；统一走 Authorization: Bearer
 * Body: { contents: [{ role, parts: [{text}] }], generationConfig: { temperature, maxOutputTokens, responseMimeType, responseSchema? } }
 * Response: { candidates: [{ content: { parts: [{text}] } }], usageMetadata: { promptTokenCount, candidatesTokenCount } }
 */
import { zodToJsonSchema } from '../json-schema';
import { applyNormalizers } from './openai-chat';
import type {
  BuildRequestArgs,
  BuildRequestResult,
  ParsedResponse,
  ProviderAdapter,
} from './types';

interface Quirks {
  supports_temperature?: boolean;
}

function buildRequest(args: BuildRequestArgs): BuildRequestResult {
  // google_generate_content 协议在 Webex proxy 上 v0.1 也仅走纯文本；遇到 PDF 附件
  // 直接拒绝，避免静默丢失（caller 应改用 bedrock_converse provider）。
  if (args.attachments && args.attachments.length > 0) {
    throw new Error(
      'attachments not supported by protocol google_generate_content; use a bedrock_converse provider for PDF',
    );
  }

  // Google 协议把 temperature / max_tokens 塞 generationConfig；这里把 default_params
  // 的 OpenAI 风味字段映射过来，让运营在 llm_provider.default_params 里继续用同套术语
  const dp = args.defaultParams;
  const quirks = (args.quirks ?? {}) as Quirks;
  const generationConfig: Record<string, unknown> = {};
  if (quirks.supports_temperature !== false && typeof dp.temperature === 'number') {
    generationConfig.temperature = dp.temperature;
  }
  // 优先用 provider.max_output_tokens 实测真值（vs 文档值）
  const limit =
    typeof args.maxOutputTokens === 'number'
      ? args.maxOutputTokens
      : typeof dp.max_tokens === 'number'
        ? (dp.max_tokens as number)
        : undefined;
  if (typeof limit === 'number') generationConfig.maxOutputTokens = limit;
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

export const googleGenerateContentAdapter: ProviderAdapter = {
  buildRequest,
  parseResponse,
  postProcess: (rawText, normalizers) => applyNormalizers(rawText, normalizers),
};
