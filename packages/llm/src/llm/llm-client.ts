// @ts-nocheck
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { formatPayloadLog } from "./payload-log.ts";

export function buildLlmRequest({
  llmConfig,
  llmTarget,
  targetConfig = {},
  target,
  input,
  messages,
  attachments = [],
  maxTokens,
  temperature,
  apiKey = process.env.LLM_PROXY_API_KEY,
  dryRun = false
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  assertTarget(resolvedLlmTarget);

  const normalizedMessages = normalizeMessages({ input, messages });
  const normalizedAttachments = attachments.map(normalizeAttachment);
  const body = buildBodyForApiShape({
    target: resolvedLlmTarget,
    input,
    messages: normalizedMessages,
    attachments: normalizedAttachments,
    maxTokens,
    temperature
  });

  return {
    llm_target_id: resolvedLlmTarget.id,
    target_id: resolvedLlmTarget.id,
    provider: resolvedLlmTarget.provider,
    model: resolvedLlmTarget.model ?? null,
    api_shape: resolvedLlmTarget.api_shape,
    method: resolvedLlmTarget.method ?? "POST",
    url: buildUrl(resolvedLlmTarget.base_url ?? resolvedLlmConfig.base_url, resolvedLlmTarget),
    headers: resolveHeaders({
      headers: {
        ...(resolvedLlmConfig.default_headers ?? {}),
        ...(resolvedLlmTarget.headers ?? {})
      },
      apiKey,
      dryRun
    }),
    body
  };
}

export async function callLlm({
  llmConfig,
  llmTarget,
  targetConfig = {},
  target,
  input,
  messages,
  attachments = [],
  maxTokens,
  temperature,
  apiKey = process.env.LLM_PROXY_API_KEY,
  fetchImpl = fetch,
  dryRun = false,
  now = () => Date.now(),
  payloadLogPath,
  payloadLogLimit = 20000,
  requestLabel
}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({ llmTarget, target });
  const request = buildLlmRequest({
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input,
    messages,
    attachments,
    maxTokens,
    temperature,
    apiKey,
    dryRun
  });

  const startedAt = now();
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? undefined : JSON.stringify(request.body)
    });
    const responseText = await response.text();
    const raw = parseMaybeJson(responseText);
    const httpStatus = response.status;
    const latencyMs = now() - startedAt;
    const responseHeaders = headersToObject(response.headers);
    await appendPayloadLog({
      payloadLogPath,
      requestLabel: requestLabel ?? resolvedLlmTarget.id,
      request,
      attempt: {
        index: 1,
        http_status: httpStatus,
        latency_ms: latencyMs,
        headers: responseHeaders,
        body: raw
      },
      limit: payloadLogLimit
    });

    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      llm_target_id: resolvedLlmTarget.id,
      target_id: resolvedLlmTarget.id,
      provider: resolvedLlmTarget.provider,
      model: resolvedLlmTarget.model ?? null,
      api_shape: resolvedLlmTarget.api_shape,
      http_status: httpStatus,
      headers: responseHeaders,
      latency_ms: latencyMs,
      usage: extractLlmUsage(raw, resolvedLlmTarget.api_shape),
      text: extractLlmText(raw, resolvedLlmTarget.api_shape),
      raw
    };
  } catch (error) {
    const latencyMs = now() - startedAt;
    await appendPayloadLog({
      payloadLogPath,
      requestLabel: requestLabel ?? resolvedLlmTarget.id,
      request,
      attempt: {
        index: 1,
        http_status: null,
        latency_ms: latencyMs,
        headers: {},
        body: null,
        error_message: error.message
      },
      limit: payloadLogLimit
    });
    return {
      ok: false,
      llm_target_id: resolvedLlmTarget.id,
      target_id: resolvedLlmTarget.id,
      provider: resolvedLlmTarget.provider,
      model: resolvedLlmTarget.model ?? null,
      api_shape: resolvedLlmTarget.api_shape,
      http_status: null,
      latency_ms: latencyMs,
      usage: null,
      text: "",
      raw: null,
      error_message: error.message
    };
  }
}

async function appendPayloadLog({ payloadLogPath, requestLabel, request, attempt, limit }) {
  if (!payloadLogPath) return;
  await mkdir(path.dirname(payloadLogPath), { recursive: true });
  const output = [
    `=== LLM CALL ${requestLabel} ===`,
    formatPayloadLog({ request, attempts: [attempt], limit })
  ].join("\n");
  await appendFile(payloadLogPath, `${output}\n\n`);
}

function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function") return Object.fromEntries(headers.entries());
  if (typeof headers.forEach === "function") {
    const entries = {};
    headers.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }
  return { ...headers };
}

export function extractLlmText(body, apiShape) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";

  if (apiShape === "openai-chat-completions" || apiShape === "azure-chat-completions") {
    if (!Array.isArray(body.choices)) return "";
    return joinText(body.choices.map((choice) => textFromContent(choice.message?.content ?? choice.text)));
  }

  if (apiShape === "openai-responses") {
    if (typeof body.output_text === "string") return body.output_text;
    if (!Array.isArray(body.output)) return "";
    return joinText(body.output.flatMap((item) => textFromContent(item.content ?? item.text ?? item)));
  }

  if (apiShape === "bedrock-converse") {
    if (!Array.isArray(body.output?.message?.content)) return "";
    return joinText(body.output.message.content.map((content) => content.text));
  }

  if (apiShape === "google-generate-content") {
    if (!Array.isArray(body.candidates)) return "";
    return joinText(body.candidates.flatMap((candidate) => (
      candidate.content?.parts?.map((part) => part.text) ?? []
    )));
  }

  const knownText = joinText([
    extractLlmText(body, "openai-chat-completions"),
    extractLlmText(body, "openai-responses"),
    extractLlmText(body, "bedrock-converse"),
    extractLlmText(body, "google-generate-content")
  ]);
  if (knownText) return knownText;

  return joinText(Object.values(body).map((value) => extractLlmText(value, apiShape)));
}

export function extractLlmUsage(body, apiShape) {
  if (!body || typeof body !== "object") return null;

  if (apiShape === "bedrock-converse" && body.usage) {
    return normalizeTokenUsage({
      promptTokens: body.usage.inputTokens,
      completionTokens: body.usage.outputTokens,
      totalTokens: body.usage.totalTokens,
      raw: body.usage
    });
  }

  if (body.usage && typeof body.usage === "object") {
    return normalizeTokenUsage({
      promptTokens: body.usage.prompt_tokens ?? body.usage.input_tokens,
      completionTokens: body.usage.completion_tokens ?? body.usage.output_tokens,
      totalTokens: body.usage.total_tokens,
      raw: body.usage
    });
  }

  if (apiShape === "google-generate-content" && body.usageMetadata) {
    return normalizeTokenUsage({
      promptTokens: body.usageMetadata.promptTokenCount,
      completionTokens: body.usageMetadata.candidatesTokenCount,
      totalTokens: body.usageMetadata.totalTokenCount,
      raw: body.usageMetadata
    });
  }

  return null;
}

function buildBodyForApiShape({ target, input, messages, attachments, maxTokens, temperature }) {
  if (target.api_shape === "openai-chat-completions") {
    return omitUndefined({
      model: target.model,
      messages: buildOpenAiChatMessages({ messages, attachments }),
      max_tokens: maxTokens,
      temperature
    });
  }

  if (target.api_shape === "azure-chat-completions") {
    return omitUndefined({
      messages: buildOpenAiChatMessages({ messages, attachments }),
      max_tokens: maxTokens,
      temperature
    });
  }

  if (target.api_shape === "openai-responses") {
    return omitUndefined({
      model: target.model,
      input: buildOpenAiResponsesInput({ messages, attachments }),
      max_output_tokens: maxTokens,
      temperature
    });
  }

  if (target.api_shape === "bedrock-converse") {
    return omitUndefined({
      messages: buildBedrockMessages({ messages, attachments }),
      inferenceConfig: omitUndefined({
        maxTokens,
        temperature
      })
    });
  }

  if (target.api_shape === "google-generate-content") {
    return omitUndefined({
      contents: buildGoogleContents({ messages, attachments }),
      generationConfig: omitUndefined({
        maxOutputTokens: maxTokens,
        temperature
      })
    });
  }

  if (target.api_shape === "openai-embeddings") {
    if (attachments.length > 0) {
      throw new Error("openai-embeddings targets do not support attachments");
    }
    return omitUndefined({
      model: target.model,
      input
    });
  }

  throw new Error(`Unsupported api_shape: ${target.api_shape}`);
}

function buildOpenAiChatMessages({ messages, attachments }) {
  const attachmentTargetIndex = findAttachmentTargetIndex(messages);
  return messages.map((message, index) => {
    const parts = openAiChatPartsFromContent(message.content);
    if (index === attachmentTargetIndex) {
      parts.push(...attachments.map(toOpenAiChatAttachmentPart));
    }

    return {
      role: message.role,
      content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts
    };
  });
}

function buildOpenAiResponsesInput({ messages, attachments }) {
  const attachmentTargetIndex = findAttachmentTargetIndex(messages);
  return messages.map((message, index) => {
    const content = openAiResponsePartsFromContent(message.content);
    if (index === attachmentTargetIndex) {
      content.push(...attachments.map(toOpenAiResponseAttachmentPart));
    }

    return {
      role: message.role,
      content
    };
  });
}

function buildBedrockMessages({ messages, attachments }) {
  const attachmentTargetIndex = findAttachmentTargetIndex(messages);
  return messages.map((message, index) => {
    const content = bedrockPartsFromContent(message.content);
    if (index === attachmentTargetIndex) {
      content.push(...attachments.map(toBedrockAttachmentPart));
    }

    return {
      role: bedrockRole(message.role),
      content
    };
  });
}

function buildGoogleContents({ messages, attachments }) {
  const attachmentTargetIndex = findAttachmentTargetIndex(messages);
  return messages.map((message, index) => {
    const parts = googlePartsFromContent(message.content);
    if (index === attachmentTargetIndex) {
      parts.push(...attachments.map(toGoogleAttachmentPart));
    }

    return {
      role: googleRole(message.role),
      parts
    };
  });
}

function normalizeMessages({ input, messages }) {
  if (messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array when provided");
    }
    return messages.map((message) => ({
      role: message.role ?? "user",
      content: message.content ?? ""
    }));
  }

  return [
    {
      role: "user",
      content: input == null ? "" : String(input)
    }
  ];
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    throw new Error("attachments must be objects");
  }

  const type = attachment.type ?? typeFromMimeType(attachment.mimeType ?? attachment.mime_type);
  const mimeType = attachment.mimeType ?? attachment.mime_type ?? defaultMimeType(type);
  const data = attachment.data ?? attachment.base64;
  if (!data) {
    throw new Error("attachment data must contain a base64 string");
  }

  return {
    ...attachment,
    type,
    mimeType,
    data,
    name: attachment.name ?? attachment.filename ?? defaultAttachmentName(type, mimeType),
    filename: attachment.filename ?? attachment.name ?? defaultAttachmentName(type, mimeType),
    format: attachment.format ?? formatFromMimeType(mimeType)
  };
}

function openAiChatPartsFromContent(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return { type: "text", text: part };
      if (part?.type === "input_text") return { type: "text", text: part.text ?? "" };
      if (part?.type === "input_image") {
        return { type: "image_url", image_url: { url: part.image_url } };
      }
      if (part?.text && !part.type) return { type: "text", text: part.text };
      return part;
    });
  }
  if (content?.text) return [{ type: "text", text: content.text }];
  return [{ type: "text", text: String(content ?? "") }];
}

function openAiResponsePartsFromContent(content) {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return { type: "input_text", text: part };
      if (part?.type === "text") return { type: "input_text", text: part.text ?? "" };
      if (part?.type === "image_url") {
        return { type: "input_image", image_url: part.image_url?.url ?? part.image_url };
      }
      if (part?.text && !part.type) return { type: "input_text", text: part.text };
      return part;
    });
  }
  if (content?.text) return [{ type: "input_text", text: content.text }];
  return [{ type: "input_text", text: String(content ?? "") }];
}

function bedrockPartsFromContent(content) {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return { text: part };
      if (part?.type === "text" || part?.type === "input_text") return { text: part.text ?? "" };
      return part;
    });
  }
  if (content?.text) return [{ text: content.text }];
  return [{ text: String(content ?? "") }];
}

function googlePartsFromContent(content) {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return { text: part };
      if (part?.type === "text" || part?.type === "input_text") return { text: part.text ?? "" };
      if (part?.inlineData) return part;
      return part;
    });
  }
  if (content?.text) return [{ text: content.text }];
  return [{ text: String(content ?? "") }];
}

function toOpenAiChatAttachmentPart(attachment) {
  if (isImageAttachment(attachment)) {
    return {
      type: "image_url",
      image_url: {
        url: dataUrlFor(attachment)
      }
    };
  }

  return {
    type: "file",
    file: {
      filename: attachment.filename,
      file_data: dataUrlFor(attachment)
    }
  };
}

function toOpenAiResponseAttachmentPart(attachment) {
  if (isImageAttachment(attachment)) {
    return {
      type: "input_image",
      image_url: dataUrlFor(attachment)
    };
  }

  return {
    type: "input_file",
    filename: attachment.filename,
    file_data: dataUrlFor(attachment)
  };
}

function toBedrockAttachmentPart(attachment) {
  if (isImageAttachment(attachment)) {
    return {
      image: {
        format: attachment.format,
        source: {
          bytes: stripDataUrl(attachment.data)
        }
      }
    };
  }

  return {
    document: {
      format: attachment.format,
      name: sanitizeBedrockDocumentName(attachment.name),
      source: {
        bytes: stripDataUrl(attachment.data)
      }
    }
  };
}

function toGoogleAttachmentPart(attachment) {
  return {
    inlineData: {
      mimeType: attachment.mimeType,
      data: stripDataUrl(attachment.data)
    }
  };
}

function findAttachmentTargetIndex(messages) {
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  return lastUserIndex >= 0 ? lastUserIndex : messages.length - 1;
}

function buildUrl(baseUrl, target) {
  if (!baseUrl && !/^https?:\/\//i.test(target.path)) {
    throw new Error(`base_url is required for target ${target.id}`);
  }
  const url = /^https?:\/\//i.test(target.path) ? new URL(target.path) : new URL(target.path, baseUrl);
  for (const [key, value] of Object.entries(target.query ?? {})) {
    if (value != null) url.searchParams.set(key, value);
  }
  return url.toString();
}

function resolveHeaders({ headers, apiKey, dryRun }) {
  const resolved = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      resolved[key] = value;
      continue;
    }

    if (value.includes("${LLM_PROXY_API_KEY}")) {
      if (apiKey) {
        resolved[key] = value.replaceAll("${LLM_PROXY_API_KEY}", apiKey);
      } else if (dryRun) {
        resolved[key] = value;
      } else {
        throw new Error("LLM_PROXY_API_KEY is required for this target");
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function extractTextFromResponsePart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.output_text === "string") return part.output_text;
  return "";
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return joinText(content.map(extractTextFromResponsePart));
  return extractTextFromResponsePart(content);
}

function normalizeTokenUsage({ promptTokens, completionTokens, totalTokens, raw }) {
  const prompt = numberOrNull(promptTokens);
  const completion = numberOrNull(completionTokens);
  const total = numberOrNull(totalTokens) ?? (
    prompt == null || completion == null ? null : prompt + completion
  );

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    raw
  };
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function omitUndefined(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => (
      nested !== undefined && !(nested && typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested).length === 0)
    ))
  );
}

function dataUrlFor(attachment) {
  if (String(attachment.data).startsWith("data:")) return attachment.data;
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

function stripDataUrl(data) {
  const value = String(data);
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
}

function isImageAttachment(attachment) {
  return attachment.type === "image" || attachment.mimeType.startsWith("image/");
}

function typeFromMimeType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document";
  return "file";
}

function defaultMimeType(type) {
  if (type === "image") return "image/png";
  if (type === "pdf" || type === "document") return "application/pdf";
  return "application/octet-stream";
}

function formatFromMimeType(mimeType = "") {
  const format = mimeType.split("/")[1]?.toLowerCase() ?? "bin";
  if (format === "jpg") return "jpeg";
  if (format === "plain") return "txt";
  return format;
}

function defaultAttachmentName(type, mimeType) {
  if (type === "image") return `image.${formatFromMimeType(mimeType)}`;
  if (type === "pdf" || mimeType === "application/pdf") return "document.pdf";
  return "attachment";
}

function sanitizeBedrockDocumentName(name) {
  const sanitized = String(name ?? "document").replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized || "document";
}

function bedrockRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function googleRole(role) {
  return role === "assistant" ? "model" : "user";
}

function joinText(values = []) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    return [value];
  }).filter((value) => typeof value === "string" && value.length > 0).join("\n");
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function resolveLlmConfig({ llmConfig, targetConfig }) {
  return llmConfig ?? targetConfig ?? {};
}

function resolveLlmTarget({ llmTarget, target }) {
  return llmTarget ?? target;
}

function assertTarget(llmTarget) {
  if (!llmTarget || typeof llmTarget !== "object") {
    throw new Error("llmTarget is required");
  }
  if (!llmTarget.id) throw new Error("llmTarget.id is required");
  if (!llmTarget.api_shape) throw new Error(`llmTarget.api_shape is required for ${llmTarget.id}`);
  if (!llmTarget.path) throw new Error(`llmTarget.path is required for ${llmTarget.id}`);
}
