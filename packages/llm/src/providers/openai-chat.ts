/**
 * OpenAI Chat Completions 协议适配器
 *
 * 端点：POST {endpoint}
 * Body: { model, messages: [{role, content}], temperature?, max_tokens?, response_format? }
 * Response: { choices: [{ message: { content } }], usage: { prompt_tokens, completion_tokens } }
 *
 * v0.1 仅支持纯文本 prompt（vision/PDF 是 capability 位但运营端 MVP 还不用）。
 */
import { zodToJsonSchema } from '../json-schema';
import type { BuildRequestArgs, BuildRequestResult, ParsedResponse, ProviderAdapter } from './types';

function buildRequest(args: BuildRequestArgs): BuildRequestResult {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: 'user', content: args.prompt }],
    ...args.defaultParams,
  };

  if (args.schema) {
    // OpenAI structured output：response_format = { type: 'json_schema', json_schema: { name, schema, strict } }
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: true,
        schema: zodToJsonSchema(args.schema),
      },
    };
  }

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

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function parseResponse(json: unknown): ParsedResponse {
  const r = json as OpenAIChatResponse;
  const rawText = r?.choices?.[0]?.message?.content ?? '';
  const usage = r?.usage;
  const tokenUsage =
    typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number'
      ? { input: usage.prompt_tokens, output: usage.completion_tokens }
      : null;
  return { rawText, tokenUsage };
}

export const openaiChatAdapter: ProviderAdapter = { buildRequest, parseResponse };
