/**
 * OpenAI Chat Completions 协议适配器（同时承载 Webex Proxy 上的 Gemini / Claude / GPT）
 *
 * 端点：POST {endpoint}
 * Body: { model, messages: [{role, content}], temperature?, max_tokens?, response_format? }
 * Response: { choices: [{ message: { content } }], usage: { prompt_tokens, completion_tokens } }
 *
 * v0.1 仅支持纯文本 prompt（vision/PDF 是 capability 位但运营端 MVP 还不用）。
 *
 * 模型族差异通过 args.quirks 显式控制（不再硬编码模型名做分支）：
 *   - supports_temperature       false → 不发 temperature（Claude 4.7 拒收）
 *   - supports_response_format   false → 不发 response_format，把 schema JSON 注入 prompt
 *                                  尾，靠 callLLM 后置 zod 校验兜底（Webex proxy 给 Claude 4.7
 *                                  发 response_format 会注入 temperature 触发 400）
 *   - max_tokens_param_name      非 "max_tokens" 时按字段名发（GPT-5 / o-系用 max_completion_tokens）
 *
 * 输出文本规范化由 postProcess 按 normalizers 顺序执行，已知 key 见 schema 注释。
 */
import { zodToJsonSchema } from '../json-schema';
import type {
  BuildRequestArgs,
  BuildRequestResult,
  ParsedResponse,
  ProviderAdapter,
} from './types';

interface Quirks {
  supports_temperature?: boolean;
  supports_response_format?: boolean;
  max_tokens_param_name?: string;
}

function buildRequest(args: BuildRequestArgs): BuildRequestResult {
  // openai_chat 协议在 Webex proxy 上支持 image 多模态（OpenAI vision API 兼容格式），
  // 但不支持 PDF 附件（Webex proxy 给 Gemini 不收 PDF doc part；PDF 走 bedrock_converse）。
  const imageAttachments: Array<{ format: string; base64: string }> = [];
  if (args.attachments && args.attachments.length > 0) {
    for (const a of args.attachments) {
      if (a.kind === 'image') {
        imageAttachments.push({ format: a.format, base64: a.base64 });
      } else {
        throw new Error(
          `attachment kind '${a.kind}' not supported by protocol openai_chat; use a bedrock_converse provider for PDF`,
        );
      }
    }
  }

  const quirks = (args.quirks ?? {}) as Quirks;
  const dp = args.defaultParams as Record<string, unknown>;

  // 1) schema 处理路径：原生 response_format vs prompt 注入
  const useResponseFormat = !!args.schema && quirks.supports_response_format !== false;
  let promptText = args.prompt;
  if (args.schema && !useResponseFormat) {
    const jsonShape = JSON.stringify(zodToJsonSchema(args.schema));
    promptText = `${args.prompt}\n\n严格按以下 JSON Schema 输出（不要任何 markdown 包裹、不要解释、不要前后缀）：\n${jsonShape}`;
  }

  // 2) message content：纯文本 string 形式 vs 多模态 array 形式
  //    带图时必须 array；OpenAI 与 Webex proxy 都向前兼容
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  const content: string | ContentPart[] =
    imageAttachments.length === 0
      ? promptText
      : [
          { type: 'text', text: promptText } as ContentPart,
          ...imageAttachments.map(
            (img): ContentPart => ({
              type: 'image_url',
              image_url: { url: `data:image/${img.format};base64,${img.base64}` },
            }),
          ),
        ];

  const body: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: 'user', content }],
  };

  // 2) max_tokens 字段名翻译（GPT-5 系 / o-系：max_completion_tokens）
  const limit =
    typeof args.maxOutputTokens === 'number'
      ? args.maxOutputTokens
      : typeof dp.max_tokens === 'number'
        ? (dp.max_tokens as number)
        : undefined;
  if (typeof limit === 'number') {
    const key = quirks.max_tokens_param_name ?? 'max_tokens';
    body[key] = limit;
  }

  // 3) 透传其余 default_params（top_p 等），但温和绕过我们要按 quirks 控制的字段
  for (const [k, v] of Object.entries(dp)) {
    if (k === 'max_tokens' || k === 'temperature') continue;
    if (body[k] === undefined) body[k] = v;
  }

  // 4) temperature：默认带，被显式关掉则跳过（Claude 4.7）
  if (quirks.supports_temperature !== false && typeof dp.temperature === 'number') {
    body.temperature = dp.temperature;
  }

  // 5) response_format：默认带，关掉走 prompt 引导路径
  if (useResponseFormat) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: true,
        schema: zodToJsonSchema(args.schema!),
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
    schemaInPrompt: !!args.schema && !useResponseFormat,
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

/**
 * 已知 normalizer key（顺序敏感：先半角化再前缀，再做风格规范）
 *   - zh_punct_to_ascii                  全角点号 / 逗号 → 半角
 *   - prefix_chapter_with_section_sign   行首章节号 1.1 / 1.1.1 加 § 前缀
 *   - normalize_chapter_subsection       §1-1 / §1_1 → §1.1
 * 未知 key 静默跳过（向前兼容；调用层自己决定要不要警告）。
 */
export function applyNormalizers(rawText: string, normalizers: string[]): string {
  let s = rawText;
  for (const key of normalizers) {
    switch (key) {
      case 'zh_punct_to_ascii':
        s = s.replace(/．/g, '.').replace(/，/g, ',');
        break;
      case 'prefix_chapter_with_section_sign':
        s = s.replace(/^(\s*)(\d+(?:\.\d+)+)/gm, (_, lead, num) => `${lead}§${num}`);
        break;
      case 'normalize_chapter_subsection':
        s = s.replace(/§(\d+)[-_](\d+)/g, '§$1.$2');
        break;
      default:
        // 未知 key 不抛，向前兼容
        break;
    }
  }
  return s;
}

function postProcess(rawText: string, normalizers: string[]): string {
  return applyNormalizers(rawText, normalizers);
}

export const openaiChatAdapter: ProviderAdapter = { buildRequest, parseResponse, postProcess };
