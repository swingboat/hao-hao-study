/**
 * @deprecated **整条 bedrock_converse 管线已软弃用**（详见 `pdf/analyze-pdf.ts`
 * 文件头）：Webex proxy 上 429 触发率过高，新业务 PDF 解析走 `analyzePdfWithVision`
 * （pdftoppm → openai_chat vision）。本 adapter 代码与测试保留，DB 里
 * Claude Opus 4.7 (bedrock_converse) provider 行禁用即可，**不要在新业务代码里
 * 选 protocol=bedrock_converse 的 provider**。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AWS Bedrock Converse 协议适配器（Webex proxy 上 Claude Opus 4.7 走此路径）
 *
 * 端点：POST {endpoint}（seed 写完整路径，含 `/bedrock/v1/model/<model>/converse`）
 * Body 形态:
 *   {
 *     messages: [{ role: 'user', content: [
 *       { text: <prompt> },
 *       { document: { format: 'pdf', name, source: { bytes: <base64> } } }
 *     ]}],
 *     inferenceConfig: { maxTokens, temperature? }
 *   }
 * Response:
 *   {
 *     output: { message: { content: [{ text }] } },
 *     usage: { inputTokens, outputTokens }
 *   }
 *
 * 与 openai_chat 适配器的差异：
 *   1. 原生支持 PDF document part（不需要 caller 先抽文本）。
 *   2. Converse 没有 response_format / responseSchema 这种 structured output 钩子；
 *      schema 处理统一走"prompt 注入 JSON Schema"路径，靠 callLLM 后置 zod 兜底。
 *      实测 Claude Opus 4.7 对 prompt-引导 JSON 服从性极高（探针 113/113 通过），
 *      与 openai_chat 那条 supports_response_format=false 的 Claude 路径同套路。
 *   3. usage 字段名是 inputTokens / outputTokens，不是 OpenAI 的 prompt_tokens /
 *      completion_tokens。
 *
 * quirks（与 openai-chat 同名复用，不要再造一套）：
 *   - supports_temperature       false → inferenceConfig 不带 temperature（Claude 4.7）
 *
 * 输出文本规范化由 postProcess 按 normalizers 顺序执行（复用 openai-chat 的实现）。
 */
import { zodToJsonSchema } from '../json-schema';
import { applyNormalizers } from './openai-chat';
import type {
  Attachment,
  BuildRequestArgs,
  BuildRequestResult,
  ParsedResponse,
  ProviderAdapter,
} from './types';

interface Quirks {
  supports_temperature?: boolean;
}

function buildContentParts(promptText: string, attachments?: Attachment[]) {
  const parts: Array<Record<string, unknown>> = [{ text: promptText }];
  for (const att of attachments ?? []) {
    if (att.kind !== 'pdf') {
      // bedrock_converse v0.1 仅消费 PDF；image 走 openai_chat 协议（Gemini vision）
      throw new Error(
        `attachment kind '${att.kind}' not supported by protocol bedrock_converse; image attachments should route to openai_chat provider (e.g. webex-gemini-3.1-pro)`,
      );
    }
    parts.push({
      document: {
        format: att.format,
        name: att.name,
        source: { bytes: att.base64 },
      },
    });
  }
  return parts;
}

function buildRequest(args: BuildRequestArgs): BuildRequestResult {
  const quirks = (args.quirks ?? {}) as Quirks;
  const dp = args.defaultParams as Record<string, unknown>;

  // 1) schema 处理：Converse 没有原生 response_format，统一走 prompt 注入路径
  let promptText = args.prompt;
  if (args.schema) {
    const jsonShape = JSON.stringify(zodToJsonSchema(args.schema));
    promptText = `${args.prompt}\n\n严格按以下 JSON Schema 输出（不要任何 markdown 包裹、不要解释、不要前后缀）：\n${jsonShape}`;
  }

  // 2) inferenceConfig 装载：maxTokens 优先级与 openai-chat 一致
  const inferenceConfig: Record<string, unknown> = {};
  const limit =
    typeof args.maxOutputTokens === 'number'
      ? args.maxOutputTokens
      : typeof dp.max_tokens === 'number'
        ? (dp.max_tokens as number)
        : undefined;
  if (typeof limit === 'number') inferenceConfig.maxTokens = limit;
  if (quirks.supports_temperature !== false && typeof dp.temperature === 'number') {
    inferenceConfig.temperature = dp.temperature;
  }
  if (typeof dp.top_p === 'number') inferenceConfig.topP = dp.top_p;

  const body: Record<string, unknown> = {
    messages: [
      {
        role: 'user',
        content: buildContentParts(promptText, args.attachments),
      },
    ],
    inferenceConfig,
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
    schemaInPrompt: !!args.schema,
  };
}

interface BedrockConverseResponse {
  output?: { message?: { content?: Array<{ text?: string }> } };
  usage?: { inputTokens?: number; outputTokens?: number };
}

function parseResponse(json: unknown): ParsedResponse {
  const r = json as BedrockConverseResponse;
  const parts = r?.output?.message?.content ?? [];
  const rawText = parts
    .map((p) => p?.text ?? '')
    .filter(Boolean)
    .join('\n');
  const u = r?.usage;
  const tokenUsage =
    typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number'
      ? { input: u.inputTokens, output: u.outputTokens }
      : null;
  return { rawText, tokenUsage };
}

function postProcess(rawText: string, normalizers: string[]): string {
  return applyNormalizers(rawText, normalizers);
}

export const bedrockConverseAdapter: ProviderAdapter = { buildRequest, parseResponse, postProcess };
